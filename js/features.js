/*
 * Feature discovery: walk a IIIF Presentation or Web Annotation resource,
 * dereference what it references, and collect every navPlace (or annotation
 * body) that carries GeoJSON, flattened into Leaflet-ready Features.
 *
 * Rewritten from the legacy VIEWER.findAllFeatures/consumeForGeoJSON:
 *  - the "geoemtry" typo meant referenced Features were never dereferenced
 *  - the legacy property-inheritance passes re-collected the top-level
 *    navPlace, double-rendering collection- and manifest-level features;
 *    identity de-duplication fixes that
 *  - fetch and processing limits are enforced through ResourceResolver
 */

import { getId, getType, IIIF_RESOURCE_TYPES, ANNOTATION_TYPES } from './iiif.js'

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
   * Resolve a URI (or return the cached/inline object).  Caches under both the
   * request URI and the id the payload reports.
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
    this.cache.set(key, data)
    const resolvedId = getId(data)
    if (resolvedId && resolvedId !== key) this.cache.set(resolvedId.split('#')[0], data)
    return data
  }
}

function firstImageBodyId(node) {
  const page = node?.items?.[0]
  const anno = page?.items?.[0] ?? page
  const body = [].concat(anno?.body ?? anno?.['body'] ?? [])[0]
  return body?.id ?? body?.['@id'] ?? ''
}

/**
 * Fill in feature properties the producer left to the parent resource.
 * @param {Object} feature GeoJSON Feature (mutated properties)
 * @param {Object} owner the IIIF/Annotation resource the navPlace came from
 */
function inheritProperties(feature, owner, manifest) {
  if (!feature.properties || typeof feature.properties !== 'object') feature.properties = {}
  const p = feature.properties
  const ownerType = getType(owner)
  p.__fromResource = p.__fromResource ?? ownerType
  if (!p.thumbnail?.length && owner.thumbnail?.length) p.thumbnail = owner.thumbnail
  else if (!p.thumbnail?.length && (ownerType === 'Canvas' || ownerType === 'Manifest')) {
    const img = firstImageBodyId(owner)
    if (img) p.thumbnail = [{ id: img }]
  }
  if (!p.thumbnail?.length && manifest?.thumbnail?.length) p.thumbnail = manifest.thumbnail
  for (const key of ['label', 'summary', 'requiredStatement', 'rights', 'navDate']) {
    if (p[key] === undefined && owner[key] !== undefined) p[key] = owner[key]
    if (p[key] === undefined && manifest && manifest !== owner && manifest[key] !== undefined) p[key] = manifest[key]
  }
  const ownerId = getId(owner)
  if (ownerType === 'Canvas' && !p.canvas) p.canvas = ownerId
  if (ownerType === 'Manifest' && !p.manifest) p.manifest = ownerId
  if (!p.manifest && manifest) p.manifest = getId(manifest)
  if (ownerType === 'Collection' && !p.collection) p.collection = ownerId
  if (ANNOTATION_TYPES.includes(ownerType)) {
    if (!p.anno) p.anno = ownerId
    if (!p.targeting) {
      const t0 = [].concat(owner.target ?? [])[0]
      p.targeting = typeof t0 === 'string' ? t0 : (t0 ? getId(t0) ?? '' : '')
    }
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
 * @returns {Promise<{features: Array, warnings: Array<String>, resource: Object}>}
 */
export async function discoverFeatures(resource, options = {}) {
  const supportedTypes = options.supportedTypes ?? IIIF_RESOURCE_TYPES
  const dig = options.dig !== false
  const resolve = options.resolve !== false
  const resolver = options.resolver ?? new ResourceResolver()
  const findLimit = options.findLimit ?? DEFAULT_FIND_LIMIT

  const warnings = []
  const topType = getType(resource)
  const property = ANNOTATION_TYPES.includes(topType) ? 'body' : 'navPlace'
  const instances = []
  const seen = new Set()
  let processed = 0

  const canFetch = () => {
    if (!resolve) return false
    if (resolver.exhausted) {
      warnings.push(`Resource fetch limit (${findLimit}) reached. Some referenced resources were not resolved.`)
      return false
    }
    return true
  }

  const record = (instance, owner, manifest) => {
    if (!instance || typeof instance !== 'object') return
    if (seen.has(instance)) return
    seen.add(instance)
    instances.push({ instance, owner, manifest })
  }

  async function walk(node, owner, manifest) {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        if (instances.length > findLimit) {
          warnings.push(`navPlace aggregation limit (${findLimit}) reached.`)
          return
        }
        let item = node[i]
        if (typeof item === 'string' && canFetch()) {
          item = await resolver.resolve(item)
          if (!item) continue
        }
        if (typeof item !== 'object' || item === null) continue
        const type = getType(item)
        if (!supportedTypes.includes(type)) continue
        const needsBody = ANNOTATION_TYPES.includes(type) ? !('body' in item) : !('items' in item)
        if (needsBody && canFetch()) {
          const resolved = await resolver.resolve(getId(item))
          if (resolved && ((ANNOTATION_TYPES.includes(type) && 'body' in resolved) || 'items' in resolved)) {
            item = resolved
          }
        }
        await walk(item, item, manifest)
      }
      return
    }
    if (typeof node !== 'object' || node === null) return
    processed += 1
    if (processed > findLimit) {
      warnings.push(`Resource processing limit (${findLimit}) reached. Check for circular references.`)
      return
    }
    const type = getType(node)
    if (!supportedTypes.includes(type)) return
    if (type === 'Manifest') manifest = node
    if (node[property] !== undefined) record(node[property], node, manifest)
    if (!dig) return
    for (const key of RECURSE_KEYS) {
      if (!Array.isArray(node[key])) continue
      await walk(node[key], node, manifest)
    }
  }

  await walk(resource, resource, getType(resource) === 'Manifest' ? resource : undefined)

  // Flatten FeatureCollections to individual Features and inherit metadata.
  const features = []
  const featureSeen = new Set()
  const pushFeature = (f, owner, manifest) => {
    const key = f.id ?? f['@id']
    if (key ? featureSeen.has(key) : featureSeen.has(f)) return
    featureSeen.add(key ?? f)
    inheritProperties(f, owner, manifest)
    features.push(f)
  }
  for (const { instance, owner, manifest } of instances) {
    if (features.length >= findLimit) {
      warnings.push(`Feature limit (${findLimit}) reached. Some geography was not rendered.`)
      break
    }
    const type = getType(instance)
    if (type === 'FeatureCollection') {
      let collection = instance
      if (!Array.isArray(collection.features) && canFetch()) {
        const resolved = await resolver.resolve(getId(collection))
        if (resolved && Array.isArray(resolved.features)) collection = resolved
      }
      if (!Array.isArray(collection.features)) continue
      for (const feature of collection.features) {
        if (features.length >= findLimit) {
          warnings.push(`Feature limit (${findLimit}) reached. Some geography was not rendered.`)
          break
        }
        if (!feature || typeof feature !== 'object') continue
        let f = feature
        if (!f.geometry && canFetch()) {
          const resolved = await resolver.resolve(getId(f))
          if (resolved && resolved.geometry) f = resolved
        }
        if (!f.geometry) continue
        pushFeature(f, owner, manifest)
      }
    } else if (type === 'Feature') {
      let f = instance
      if (!f.geometry && canFetch()) {
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

  return { features, warnings, resource }
}

/**
 * Ids "displayed" by the current render: the resource tree ids plus every
 * annotation target.  Used to match LDN notifications to what is on screen.
 * @param {Object} resource normalized top-level resource
 * @param {Array} features discovered features
 * @returns {Set<String>}
 */
export function displayedIds(resource, features) {
  const ids = new Set()
  const visit = (node, depth = 0) => {
    if (depth > 6 || !node || typeof node !== 'object') return
    const id = getId(node)
    if (id) ids.add(id)
    for (const target of [].concat(node.target ?? [])) {
      const tid = typeof target === 'string' ? target : getId(target)
      if (tid) ids.add(tid.split('#')[0])
    }
    for (const key of ['items', 'structures', 'members']) {
      for (const child of node[key] ?? []) visit(child, depth + 1)
    }
  }
  visit(resource)
  for (const f of features) {
    if (f.properties?.anno) ids.add(String(f.properties.anno).split('#')[0])
    if (f.properties?.targeting) {
      for (const target of [].concat(f.properties.targeting)) {
        const tid = typeof target === 'string' ? target : getId(target)
        if (tid) ids.add(tid.split('#')[0])
      }
    }
  }
  return ids
}
