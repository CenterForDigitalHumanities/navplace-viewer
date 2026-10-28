/*
 * IIIF Presentation API 2/3/4 recognition and normalization.
 *
 * The viewer consumes whatever version the geolocator (or any producer)
 * emitted.  detectVersion mirrors public/js/iiif.js in the geolocator so the
 * two companion apps speak one dialect (issue #55).  normalize() is a
 * boundary adapter: fetched resources are rewritten into a v3-shaped model
 * (bare types, `id`, language maps, `[{id}]` thumbnails, `items`) so the
 * feature-discovery core stays single-pass.  GeoJSON `geometry`,
 * `coordinates`, and `properties` are copied as they are.
 */

import { toLanguageMap } from './utils.js'

export const CONTEXTS = {
  navPlace: 'http://iiif.io/api/extension/navplace/context.json',
  geojson: 'http://geojson.org/geojson-ld/geojson-context.jsonld'
}

export const IIIF_RESOURCE_TYPES = ['Collection', 'Manifest', 'Range', 'Canvas']
export const ANNOTATION_TYPES = ['AnnotationPage', 'Annotation']

/**
 * The IIIF Presentation API version a resource declares via its @context.
 * @param {Object} resource
 * @returns {Number|null} 2, 3, 4, or null
 */
export function detectVersion(resource) {
  const contexts = [].concat(resource?.['@context'] ?? [])
  for (const ctx of contexts) {
    if (typeof ctx !== 'string') continue
    if (/iiif\.io\/api\/presentation\/2/.test(ctx)) return 2
    if (/iiif\.io\/api\/presentation\/3/.test(ctx)) return 3
    if (/iiif\.io\/api\/presentation\/4/.test(ctx)) return 4
  }
  return null
}

/**
 * The identifier of a resource in any JSON-LD flavor.
 * @param {Object} resource
 * @returns {String}
 */
export function getId(resource) {
  return resource?.['@id'] ?? resource?.id ?? ''
}

/**
 * The declared type of a resource with any JSON-LD prefix stripped:
 * `sc:Canvas` -> `Canvas`, `oa:Annotation` -> `Annotation`.
 * @param {Object} resource
 * @returns {String}
 */
export function getType(resource) {
  const raw = resource?.type ?? resource?.['@type'] ?? ''
  const first = [].concat(raw)[0] ?? ''
  return String(first).replace(/^(sc|oa|ldp|geojson):/, '')
}

/**
 * The id of an annotation target: a URI string, a resource with an id, or a
 * SpecificResource, whose `source` is the targeted resource.
 * @param {String|Object} target
 * @returns {String}
 */
export function getTargetId(target) {
  if (typeof target === 'string') return target
  if (!target || typeof target !== 'object') return ''
  return getId(target) || (target.source ? getTargetId(target.source) : '')
}

function contextStrings(resource) {
  return [].concat(resource?.['@context'] ?? []).filter((c) => typeof c === 'string')
}

/**
 * Human-readable @context problems with a resource, for inline notices.
 * Never blocks rendering — the viewer is liberal in what it accepts.
 * @param {Object} resource
 * @param {Array<String>} supportedTypes annotation or presentation types
 * @returns {Array<String>} warnings
 */
export function contextWarnings(resource, supportedTypes) {
  const warnings = []
  const type = getType(resource)
  const contexts = contextStrings(resource)
  const isAnnotation = ANNOTATION_TYPES.includes(type)
  if (!contexts.length) {
    warnings.push(isAnnotation
      ? 'The resource has no @context. It should reference the Web Annotation and GeoJSON-LD contexts.'
      : 'The resource has no @context. It should reference a IIIF Presentation API context.')
    return warnings
  }
  const has = (url) => contexts.some((c) => c === url || c === url.replace(/^http:/, 'https:') || c === url.replace(/^https:/, 'http:'))
  if (isAnnotation) {
    if (!contexts.some((c) => /iiif\.io\/api\/presentation\/[234]|w3\.org\/ns\/anno/.test(c))) {
      warnings.push(`The ${type} does not declare a Web Annotation or IIIF Presentation @context.`)
    }
    if (!has(CONTEXTS.geojson)) {
      warnings.push(`The ${type} should include the GeoJSON-LD context.`)
    }
  } else if (supportedTypes === IIIF_RESOURCE_TYPES || (supportedTypes && supportedTypes[0] === 'Collection')) {
    if (!contexts.some((c) => /iiif\.io\/api\/presentation\/[234]/.test(c))) {
      warnings.push('The resource does not declare a IIIF Presentation API @context.')
    }
    // Presentation 4 defines navPlace in its own context.
    if (!has(CONTEXTS.navPlace) && detectVersion(resource) !== 4) {
      warnings.push('The top level object does not contain the navPlace JSON-LD context. Processing continues.')
    }
  }
  return warnings
}

const SKIP_KEYS = new Set(['geometry', 'coordinates', 'properties'])

// v2 child lists that become v3 `items` when a node has no `items` of its own.
// `members` already holds every child in order, so it wins when present.
const V2_CHILD_LISTS = ['collections', 'manifests', 'ranges', 'canvases']

function v2Children(node) {
  if ('members' in node) return [].concat(node.members ?? [])
  return V2_CHILD_LISTS.flatMap((key) => [].concat(node[key] ?? []))
}

// v2 painting annotation (resource/on) -> v3 shape (body/target).
function v2Painting(anno) {
  if (!anno || typeof anno !== 'object') return normalize(anno)
  const { resource, on, ...rest } = anno
  const out = normalize(rest)
  if (resource !== undefined) out.body = normalize(resource)
  if (on !== undefined) out.target = normalize(on)
  if (out.motivation === 'sc:painting') out.motivation = 'painting'
  return out
}

function normalizeThumbnail(t) {
  if (typeof t === 'string') return t ? { id: t } : null
  const id = t?.resource?.['@id'] ?? t?.resource?.id ?? t?.['@id'] ?? t?.id
  return id ? { id } : normalize(t)
}

/**
 * Deep-rewrite a fetched resource into the viewer's v3-shaped internal model.
 *  - '@id' -> id, '@type'/'type' -> bare prefixed-stripped type
 *  - string or v2 '@value' label/description -> v3 language maps
 *  - v2 `description` -> `summary`
 *  - v2 thumbnail `[{ resource: { '@id' } }]` or a URI string -> [{ id }]
 *  - v2 `attribution` -> `requiredStatement`, v2 `license` -> `rights`
 *  - v2 Collection `members`, `collections`, `manifests` and Range
 *    `members`, `ranges`, `canvases` -> `items`
 *  - v2 Canvas `images` -> `items` (one AnnotationPage of painting annotations)
 *  - v2 Canvas `otherContent` dropped (annotation-list fetching is #24)
 * GeoJSON `geometry`/`coordinates`/`properties` values are copied verbatim.
 * @param {*} node
 * @returns {*} normalized copy
 */
export function normalize(node) {
  if (Array.isArray(node)) return node.map(normalize)
  if (node === null || typeof node !== 'object') return node

  const out = {}
  const hasItems = 'items' in node
  if (!hasItems && ['members', ...V2_CHILD_LISTS].some((key) => key in node)) {
    out.items = normalize(v2Children(node))
  }
  for (let [key, value] of Object.entries(node)) {
    if (key === '@context') { out['@context'] = value; continue }
    if (key === '@id') { key = 'id' }
    if (key === '@type') { key = 'type' }
    if (key === 'description' && !('summary' in node)) { key = 'summary' }
    if (key === 'attribution') {
      if (!('requiredStatement' in node)) {
        out.requiredStatement = { label: { none: ['Attribution'] }, value: toLanguageMap(value) ?? {} }
      }
      continue
    }
    if (key === 'license') {
      const rights = [].concat(value ?? []).map((v) => (typeof v === 'string' ? v : getId(v))).find(Boolean)
      if (!('rights' in node) && rights) out.rights = rights
      continue
    }
    if (!hasItems && (key === 'members' || V2_CHILD_LISTS.includes(key))) continue
    if (key === 'otherContent') continue
    if (key === 'images' && !hasItems && getType(node) === 'Canvas') {
      out.items = [{ type: 'AnnotationPage', items: [].concat(value ?? []).map(v2Painting) }]
      continue
    }
    if (key === 'sequences') {
      // v2 Manifest: sequences[].canvases[] is the v3 items[] list.
      if (!('items' in node)) {
        out.items = [].concat(node.sequences ?? []).flatMap((seq) => normalize(seq?.canvases ?? []))
      }
      continue
    }

    if (SKIP_KEYS.has(key)) {
      // A shallow copy, so properties added later never leak into the source.
      out[key] = key === 'properties' && value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : value
      continue
    }

    if (key === 'type') {
      out.type = getType(node)
      continue
    }
    if (key === 'label' || key === 'summary') {
      const map = toLanguageMap(value)
      if (map !== undefined) out[key] = map
      continue
    }
    if (key === 'thumbnail') {
      out.thumbnail = [].concat(value ?? []).map(normalizeThumbnail).filter(Boolean)
      continue
    }
    if (key === 'requiredStatement') {
      out.requiredStatement = {
        label: toLanguageMap(value?.label) ?? {},
        value: toLanguageMap(value?.value) ?? {}
      }
      continue
    }
    out[key] = normalize(value)
  }
  return out
}
