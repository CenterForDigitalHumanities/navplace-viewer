/*
 * Feature discovery: walk a IIIF Presentation or Web Annotation resource,
 * dereference what it references, and collect every navPlace (or annotation
 * body) that carries GeoJSON, flattened into Leaflet-ready Features.
 *
 * Rewritten from the legacy VIEWER.findAllFeatures/consumeForGeoJSON:
 *  - the "geoemtry" typo meant referenced Features were never dereferenced
 *  - the legacy property-inheritance passes re-collected the top-level
 *    navPlace, double-rendering collection- and manifest-level features;
 *    each resource now contributes its navPlace once.  Different resources
 *    that note the same Feature each still show it.
 *  - fetch and processing limits are enforced through ResourceResolver
 *  - as in the legacy viewer, a Manifest with `structures` is mapped through
 *    its Ranges and its `items` are skipped.  A Canvas a Range references is
 *    fetched, or read from the Manifest's own Canvases when it can't be.
 */

import { normalize, getId, getType, getTargetId, IIIF_RESOURCE_TYPES, ANNOTATION_TYPES } from './iiif.js'

export const RECURSE_KEYS = ['items', 'structures']
export const DEFAULT_FIND_LIMIT = 1000

/**
 * Fetches and caches referenced resources, with a hard cap on the number of
 * network fetches so circular references cannot spin forever.
 */
export class ResourceResolver {
  /**
   * @param {Object} options
   * @param {Function} [options.fetcher] async (uri) => parsed JSON; defaults to fetch()
   * @param {Number} [options.fetchLimit]
   */
  constructor({ fetcher, fetchLimit = DEFAULT_FIND_LIMIT } = {}) {
    this.cache = new Map()
    this.fetchCount = 0
    this.fetchLimit = fetchLimit
    this._fetcher = fetcher ?? ((uri) => globalThis.fetch(uri, { cache: 'default' }).then((r) => r.json()))
  }

  get exhausted() {
    return this.fetchCount >= this.fetchLimit
  }

  /**
   * Resolve a URI (or return the cached/inline object).  Fetched payloads are
   * normalized like the top-level resource, so a referenced v2 Manifest is
   * read the same way.  Caches under both the request URI and the id the
   * payload reports.
   * @param {String|Object} uriOrObject
   * @returns {Promise<Object|null>}
   */
  async resolve(uriOrObject) {
    if (uriOrObject && typeof uriOrObject === 'object') return uriOrObject
    if (typeof uriOrObject !== 'string' || !uriOrObject) return null
    const key = uriOrObject.split('#')[0]
    if (this.cache.has(key)) return this.cache.get(key)
    if (this.exhausted) return null
    this.fetchCount += 1
    let data = null
    try {
      data = await this._fetcher(key)
    } catch (err) {
      this.cache.set(key, null)
      return null
    }
    if (!data || typeof data !== 'object') {
      this.cache.set(key, null)
      return null
    }
    data = normalize(data)
    this.cache.set(key, data)
    const resolvedId = getId(data)
    if (resolvedId && resolvedId !== key) this.cache.set(resolvedId.split('#')[0], data)
    return data
  }
}

/**
 * The first painted image of a Canvas, or of a Manifest's first Canvas.
 * @param {Object} node normalized Canvas or Manifest
 * @returns {String}
 */
function firstImageBodyId(node) {
  const canvas = getType(node) === 'Manifest' ? node.items?.[0] : node
  const anno = canvas?.items?.[0]?.items?.[0]
  const body = [].concat(anno?.body ?? [])[0]
  return getId(body)
}

/**
 * Fill in feature properties the producer left to the parent resource.
 * @param {Object} feature GeoJSON Feature (mutated properties)
 * @param {Object} owner the IIIF/Annotation resource the navPlace came from
 * @param {Object} [manifest] the Manifest that contains the owner, if any
 */
function inheritProperties(feature, owner, manifest) {
  if (!feature.properties || typeof feature.properties !== 'object') feature.properties = {}
  const p = feature.properties
  const ownerType = getType(owner)
  p.__fromResource = p.__fromResource ?? ownerType
  // A producer may write one thumbnail object instead of an array.
  if (p.thumbnail && typeof p.thumbnail === 'object' && !Array.isArray(p.thumbnail)) p.thumbnail = [p.thumbnail]
  if (!p.thumbnail?.length && owner.thumbnail?.length) p.thumbnail = owner.thumbnail
  else if (!p.thumbnail?.length && (ownerType === 'Canvas' || ownerType === 'Manifest')) {
    const img = firstImageBodyId(owner)
    if (img) p.thumbnail = [{ id: img }]
  }
  for (const key of ['label', 'summary', 'requiredStatement', 'rights', 'navDate']) {
    if (p[key] === undefined && owner[key] !== undefined) p[key] = owner[key]
  }
  // A label, summary, navDate, or thumbnail describes the Manifest itself, so a
  // child never takes it.  Rights and required statements cover all its content.
  for (const key of ['requiredStatement', 'rights']) {
    if (p[key] === undefined && manifest && manifest !== owner && manifest[key] !== undefined) p[key] = manifest[key]
  }
  const ownerId = getId(owner)
  if (ownerType === 'Canvas' && !p.canvas) p.canvas = ownerId
  if (ownerType === 'Manifest' && !p.manifest) p.manifest = ownerId
  if (!p.manifest && manifest) p.manifest = getId(manifest)
  if (ownerType === 'Collection' && !p.collection) p.collection = ownerId
  if (ANNOTATION_TYPES.includes(ownerType)) {
    if (!p.anno) p.anno = ownerId
    if (!p.targeting) p.targeting = getTargetId([].concat(owner.target ?? [])[0])
  }
}

/**
 * Recursively discover every navPlace/geometry body in a resource.
 * @param {Object} resource normalized (v3-shaped) top-level resource
 * @param {Object} options
 * @param {Array<String>} [options.supportedTypes] presentation or annotation types
 * @param {Boolean} [options.dig] recurse into items/structures (default true)
 * @param {Boolean} [options.resolve] dereference referenced resources (default true)
 * @param {ResourceResolver} [options.resolver]
 * @param {Number} [options.findLimit]
 * @returns {Promise<{features: Array, warnings: Array<String>}>}
 */
export async function discoverFeatures(resource, options = {}) {
  const supportedTypes = options.supportedTypes ?? IIIF_RESOURCE_TYPES
  const dig = options.dig !== false
  const resolve = options.resolve !== false
  const resolver = options.resolver ?? new ResourceResolver()
  const findLimit = options.findLimit ?? DEFAULT_FIND_LIMIT

  // A Set, so a limit that is hit many times is reported once.
  const warnings = new Set()
  const topType = getType(resource)
  const property = ANNOTATION_TYPES.includes(topType) ? 'body' : 'navPlace'
  const instances = []
  const seen = new Set()
  let processed = 0

  const fetchLimitReached = () => {
    if (!resolver.exhausted) return false
    warnings.add(`Resource fetch limit (${resolver.fetchLimit}) reached. Some referenced resources were not resolved.`)
    return true
  }
  const canFetch = () => resolve && !fetchLimitReached()
  // A referenced navPlace value or annotation body is the geography itself, so
  // it is dereferenced even with resolve=false (legacy parity).
  const canFetchGeography = () => !fetchLimitReached()

  // One entry per resource: a resource reached twice (embedded and resolved,
  // or listed by two parents) is not drawn twice.
  const record = (instance, owner, manifest) => {
    if (!instance || typeof instance !== 'object') return
    const key = getId(owner) || owner
    if (seen.has(key)) return
    seen.add(key)
    instances.push({ instance, owner, manifest })
  }

  // A Range lists Canvases by reference.  One that cannot be fetched (or with
  // resolve=false) is read from the Canvases the Manifest itself contains.
  const canvasInManifest = (ref, manifest) => {
    const id = (typeof ref === 'string' ? ref : getId(ref)).split('#')[0]
    if (!id || !Array.isArray(manifest?.items)) return null
    return manifest.items.find((c) => c && typeof c === 'object' && getId(c).split('#')[0] === id) ?? null
  }

  // depth 0 is the top-level resource; dig=false stops after its direct children.
  async function walk(node, owner, manifest, depth = 0) {
    if (Array.isArray(node)) {
      const inRange = getType(owner) === 'Range'
      for (let i = 0; i < node.length; i++) {
        if (instances.length > findLimit) {
          warnings.add(`navPlace aggregation limit (${findLimit}) reached.`)
          return
        }
        let item = node[i]
        if (typeof item === 'string') {
          const ref = item
          item = canFetch() ? await resolver.resolve(ref) : null
          if (!item && inRange) item = canvasInManifest(ref, manifest)
          if (!item) continue
        }
        if (typeof item !== 'object' || item === null) continue
        const type = getType(item)
        if (!supportedTypes.includes(type)) continue
        const needsBody = ANNOTATION_TYPES.includes(type) ? !('body' in item) : !('items' in item)
        if (needsBody) {
          const resolved = canFetch() ? await resolver.resolve(getId(item)) : null
          if (resolved && ((ANNOTATION_TYPES.includes(type) && 'body' in resolved) || 'items' in resolved)) {
            item = resolved
          } else if (inRange) {
            item = canvasInManifest(item, manifest) ?? item
          }
        }
        await walk(item, item, manifest, depth)
      }
      return
    }
    if (typeof node !== 'object' || node === null) return
    processed += 1
    if (processed > findLimit) {
      warnings.add(`Resource processing limit (${findLimit}) reached. Check for circular references.`)
      return
    }
    const type = getType(node)
    if (!supportedTypes.includes(type)) return
    if (type === 'Manifest') manifest = node
    if (node[property] !== undefined) record(node[property], node, manifest)
    if (!dig && depth >= 1) return
    for (const key of RECURSE_KEYS) {
      if (!Array.isArray(node[key])) continue
      // Legacy rule: a Manifest with structures is mapped through its Ranges.
      if (type === 'Manifest' && key === 'items' && node.structures?.length) continue
      // A Manifest's Ranges stand in for its Canvases, so they do not count as a level for dig=false.
      await walk(node[key], node, manifest, type === 'Manifest' && key === 'structures' ? depth : depth + 1)
    }
  }

  await walk(resource, resource, getType(resource) === 'Manifest' ? resource : undefined)

  // Flatten FeatureCollections to individual Features and inherit metadata.
  // Every resource shows all of its Features, so the limits above cap
  // resources, never Features.  Each resource gets its own copy, because two
  // resources may share one referenced Feature or FeatureCollection.
  const features = []
  const pushFeature = (f, owner, manifest) => {
    const copy = { ...f, properties: f.properties && typeof f.properties === 'object' ? { ...f.properties } : {} }
    inheritProperties(copy, owner, manifest)
    features.push(copy)
  }
  for (const { instance, owner, manifest } of instances) {
    const type = getType(instance)
    if (type === 'FeatureCollection') {
      let collection = instance
      if (!Array.isArray(collection.features) && canFetchGeography()) {
        const resolved = await resolver.resolve(getId(collection))
        if (resolved && Array.isArray(resolved.features)) collection = resolved
      }
      if (!Array.isArray(collection.features)) continue
      for (const feature of collection.features) {
        if (!feature || typeof feature !== 'object') continue
        let f = feature
        if (!f.geometry && canFetchGeography()) {
          const resolved = await resolver.resolve(getId(f))
          if (resolved && resolved.geometry) f = resolved
        }
        if (!f.geometry) continue
        pushFeature(f, owner, manifest)
      }
    } else if (type === 'Feature') {
      let f = instance
      if (!f.geometry && canFetchGeography()) {
        const resolved = await resolver.resolve(getId(f))
        if (resolved && resolved.geometry) f = resolved
      }
      if (!f.geometry) continue
      pushFeature(f, owner, manifest)
    } else if (Array.isArray(instance.coordinates)) {
      // A bare GeoJSON geometry used directly as an annotation body.
      pushFeature({ type: 'Feature', geometry: instance, properties: instance.properties ?? {} }, owner, manifest)
    }
  }

  return { features, warnings: [...warnings] }
}

/**
 * Ids "displayed" by the current render: the resource tree ids, the trees of
 * the resources fetched while discovering features, plus every annotation
 * target.  Used to match LDN notifications to what is on screen.
 * @param {Object} resource normalized top-level resource
 * @param {Array} features discovered features
 * @param {Iterable<Object>} [resolved] normalized resources the resolver fetched
 * @returns {Set<String>}
 */
export function displayedIds(resource, features, resolved = []) {
  const ids = new Set()
  const visit = (node, depth = 0) => {
    if (depth > 6 || !node || typeof node !== 'object') return
    const id = getId(node)
    if (id) ids.add(id)
    for (const target of [].concat(node.target ?? [])) {
      const tid = getTargetId(target)
      if (tid) ids.add(tid.split('#')[0])
    }
    for (const key of ['items', 'structures', 'members']) {
      for (const child of node[key] ?? []) visit(child, depth + 1)
    }
  }
  visit(resource)
  for (const node of resolved) visit(node)
  for (const f of features) {
    if (f.properties?.anno) ids.add(String(f.properties.anno).split('#')[0])
    if (f.properties?.targeting) {
      for (const target of [].concat(f.properties.targeting)) {
        const tid = getTargetId(target)
        if (tid) ids.add(tid.split('#')[0])
      }
    }
  }
  return ids
}
