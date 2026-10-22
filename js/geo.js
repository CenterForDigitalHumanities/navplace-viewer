/*
 * Geometry math: bounding boxes, zoom levels, and map centering.
 * Pure functions, no DOM, no Leaflet.
 *
 * Fixes carried over from the legacy app.js:
 *  - calculateZoom no longer divides by zero on axis-aligned lines and used
 *    the swapped width/height branches.
 *  - getBbox handles GeometryCollection and ignores empty coordinate lists.
 */

/**
 * Collect every navPlace instance in a resource, recursively.  Depth-limited
 * to keep pathological JSON fast.
 * @param {Object} geojson normalized resource
 * @param {Array} navplaces accumulator
 * @param {Number} depth current depth (start at 1)
 * @returns {Array} navPlace values found
 */
export function navplaceObject(geojson, navplaces = [], depth = 1) {
  if (typeof geojson !== 'object' || geojson === null) return undefined
  if (Object.prototype.hasOwnProperty.call(geojson, 'navPlace')) {
    navplaces.push(geojson.navPlace)
  }
  if (depth > 5) return undefined
  for (const key in geojson) {
    const value = geojson[key]
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'object' && entry !== null) navplaceObject(entry, navplaces, depth + 1)
      }
    } else if (typeof value === 'object' && value !== null) {
      navplaceObject(value, navplaces, depth + 1)
    }
  }
  return navplaces.filter((item) => item !== undefined)
}

function collectPositions(coords, lats, lngs) {
  if (!Array.isArray(coords) || !coords.length) return
  if (typeof coords[0] === 'number') {
    lngs.push(coords[0])
    lats.push(coords[1])
    return
  }
  for (const c of coords) collectPositions(c, lats, lngs)
}

/**
 * Minimum bounding box [swLng, swLat, neLng, neLat] around a GeoJSON
 * Feature, FeatureCollection, or bare geometry.  Returns undefined when the
 * object carries no coordinates.
 * @param {Object} navplaceObj
 * @returns {Array<Number>|undefined}
 */
export function getBbox(navplaceObj) {
  if (!navplaceObj || typeof navplaceObj !== 'object') return undefined
  const type = navplaceObj.type ?? navplaceObj['@type']
  if (type === 'FeatureCollection') {
    let swlat, swlon, nelat, nelon
    for (const feature of navplaceObj.features ?? []) {
      const bbox = getBbox(feature)
      if (!bbox) continue
      if (swlat === undefined || bbox[1] < swlat) swlat = bbox[1]
      if (swlon === undefined || bbox[0] < swlon) swlon = bbox[0]
      if (nelat === undefined || bbox[3] > nelat) nelat = bbox[3]
      if (nelon === undefined || bbox[2] > nelon) nelon = bbox[2]
    }
    if (swlat === undefined) return undefined
    return [swlon, swlat, nelon, nelat]
  }
  let geometry = navplaceObj
  if (type === 'Feature') {
    geometry = navplaceObj.geometry
    if (!geometry) return undefined
  }
  const lats = []
  const lngs = []
  if (geometry.type === 'GeometryCollection') {
    for (const g of geometry.geometries ?? []) {
      const sub = getBbox({ type: 'Feature', geometry: g })
      if (!sub) continue
      lats.push(sub[1], sub[3])
      lngs.push(sub[0], sub[2])
    }
  } else if (geometry.coordinates) {
    collectPositions(geometry.coordinates, lats, lngs)
  }
  if (!lats.length) return undefined
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)]
}

/**
 * A Leaflet zoom level that fits the bounding box, minimum 2.
 * A single point renders at zoom 8.
 * @param {Array<Number>} bbox [swLng, swLat, neLng, neLat]
 * @returns {Number}
 */
export function calculateZoom(bbox) {
  const boundsWidth = Math.abs(bbox[2] - bbox[0])
  const boundsHeight = Math.abs(bbox[3] - bbox[1])
  if (boundsWidth === 0 && boundsHeight === 0) return 8
  if (boundsWidth === 0) return Math.floor(Math.log2(256 / boundsHeight))
  if (boundsHeight === 0) return Math.floor(Math.log2(256 / boundsWidth))
  return Math.min(
    Math.floor(Math.log2(256 / boundsWidth)),
    Math.floor(Math.log2(256 / boundsHeight))
  )
}

/**
 * Center of a bounding box as [lat, lng].
 * @param {Array<Number>} bbox
 * @returns {Array<Number>}
 */
export function bboxCenter(bbox) {
  return [(bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2]
}

/**
 * Stable shareable key for a feature: its own id when it has one, otherwise
 * a positional key.  Used by ?focus= and popup binding.
 * @param {Object} feature
 * @param {Number} index position in the rendered feature list
 * @returns {String}
 */
export function featureKey(feature, index) {
  return feature?.id ?? feature?.['@id'] ?? `feature[${index}]`
}
