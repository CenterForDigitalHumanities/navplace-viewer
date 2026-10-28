/*
 * LDN (Linked Data Notifications) consumption — beta.
 *
 * The geolocator (and any LDN producer) posts geo-tagging notifications at
 * the inbox of the resources it displays.  This module *reads* those inboxes
 * so map.rerum.io can show community geography alongside the structured
 * navPlace data.  Companion contract: navplace-viewer issue #55.
 *
 * Deliberately forgiving: an inbox that 401s, 404s, 405s, or fails CORS is
 * skipped silently — LDN is additive, never an error condition for the map.
 * A request that takes longer than LDN_TIMEOUT_MS is skipped with a warning.
 * No motivation filtering: any notification carrying geography renders.
 */

import { getId, getType, getTargetId } from './iiif.js'

export const NOTIFICATION_LIMIT = 50
export const NOTIFICATION_COLOR = '#ff7f0e'

const LDN_TIMEOUT_MS = 8000
const TIMEOUT_WARNING = `LDN took too long to respond (over ${LDN_TIMEOUT_MS / 1000} seconds); some notifications were skipped.`

// fetch() rejects with a TimeoutError DOMException when AbortSignal.timeout() fires.
const isTimeout = (err) => err?.name === 'TimeoutError'

function inboxOf(node) {
  const raw = node?.inbox ?? node?.['ldp:inbox']
  if (!raw) return []
  return [].concat(raw)
    .map((v) => (typeof v === 'string' ? v : getId(v)))
    .filter(Boolean)
}

/**
 * Every inbox declared by a resource or its children (one level of items /
 * structures deep, matching what the viewer actually renders).
 * @param {Object} resource normalized resource
 * @returns {Array<String>} unique inbox URLs, top-level first
 */
export function findInboxes(resource) {
  const inboxes = []
  const seen = new Set()
  const add = (node) => {
    for (const url of inboxOf(node)) {
      if (!seen.has(url)) {
        seen.add(url)
        inboxes.push(url)
      }
    }
  }
  add(resource)
  for (const child of resource?.items ?? []) {
    add(child)
    for (const grandchild of child?.items ?? []) add(grandchild)
  }
  for (const range of resource?.structures ?? []) add(range)
  return inboxes
}

/**
 * Pull the notification list out of an LDPC representation.  Producers vary:
 * ldp:contains, contains, members, @graph, or a bare array.
 * @param {Object|Array} container
 * @returns {Array<Object>}
 */
export function notificationsFromContainer(container) {
  if (Array.isArray(container)) return container
  if (!container || typeof container !== 'object') return []
  const list =
    container['ldp:contains'] ?? container.contains ?? container.members ??
    container['@graph'] ?? container.graph ?? null
  return Array.isArray(list) ? list : []
}

/**
 * The IRI of an inbox entry that only references its notification: a string
 * or a bare { id } node.  Empty for an embedded notification.
 * @param {String|Object} entry
 * @returns {String}
 */
function notificationIri(entry) {
  if (typeof entry === 'string') return entry
  if (entry && typeof entry === 'object' && !getType(entry) && !entry.body) return getId(entry)
  return ''
}

async function defaultFetcher(url) {
  const resp = await globalThis.fetch(url, {
    headers: { Accept: 'application/ld+json, application/activity+json, application/json' },
    signal: AbortSignal.timeout(LDN_TIMEOUT_MS)
  })
  if (!resp.ok) return null
  return resp.json()
}

/**
 * True when a Web Annotation body carries (or references) GeoJSON.
 * @param {Object} body
 * @returns {Boolean}
 */
export function bodyHasGeography(body) {
  const b = [].concat(body ?? [])[0] ?? body
  if (!b || typeof b !== 'object') return false
  const type = getType(b)
  if (type === 'Feature' || type === 'FeatureCollection') return true
  if (b.geometry) return true
  if (b.type === 'Point' || b.type === 'Polygon' || b.type === 'LineString' ||
    b.type === 'MultiPoint' || b.type === 'MultiPolygon' || b.type === 'MultiLineString') return true
  return false
}

function targetIds(notification) {
  const ids = []
  for (const target of [].concat(notification?.target ?? [])) {
    const id = getTargetId(target)
    if (id) ids.push(String(id).split('#')[0])
  }
  return ids
}

/**
 * Fetch geo-carrying notifications for a displayed resource.  An inbox may
 * list its notifications by IRI (as the LDN spec describes) or embed them;
 * at most `limit` IRIs are fetched across all inboxes.
 * @param {Object} resource normalized top-level resource
 * @param {Object} options
 * @param {Set<String>} [options.displayed] ids on screen; notifications
 *   targeting other resources are skipped when provided
 * @param {Function} [options.fetcher] async (url) => parsed JSON | null
 * @param {Number} [options.limit]
 * @returns {Promise<{notifications: Array, warnings: Array<String>}>}
 */
export async function collectNotifications(resource, options = {}) {
  const fetcher = options.fetcher ?? defaultFetcher
  const limit = options.limit ?? NOTIFICATION_LIMIT
  const displayed = options.displayed
  const warnings = []
  const notifications = []
  const limitWarning = `Notification limit (${limit}) reached; some inbox entries were not shown.`
  const warnOnce = (message) => {
    if (!warnings.includes(message)) warnings.push(message)
  }
  let fetched = 0

  for (const inbox of findInboxes(resource)) {
    if (notifications.length >= limit) break
    let container = null
    try {
      container = await fetcher(inbox)
    } catch (err) {
      // 401/404/405/CORS/network: LDN is additive, stay silent.  A slow inbox is reported.
      if (isTimeout(err)) warnOnce(TIMEOUT_WARNING)
      continue
    }
    for (let note of notificationsFromContainer(container)) {
      if (notifications.length >= limit) {
        warnOnce(limitWarning)
        break
      }
      const iri = notificationIri(note)
      if (iri) {
        if (fetched >= limit) {
          warnOnce(limitWarning)
          break
        }
        fetched += 1
        try {
          note = await fetcher(iri)
        } catch (err) {
          // An unreachable notification is skipped like an unreachable inbox.
          if (isTimeout(err)) warnOnce(TIMEOUT_WARNING)
          continue
        }
      }
      if (!note || typeof note !== 'object') continue
      if (getType(note) !== 'Annotation') continue
      if (!bodyHasGeography(note.body)) continue
      if (displayed && displayed.size) {
        const targets = targetIds(note)
        if (targets.length && !targets.some((t) => displayed.has(t))) continue
      }
      notifications.push(note)
    }
  }
  return { notifications, warnings }
}

/**
 * Turn LDN notifications into map features.  Each feature is tagged
 * `__fromResource: "Notification"` so the map colors it orange and the popup
 * can attribute the sender.
 * @param {Array<Object>} notifications
 * @param {Object} [options]
 * @param {Function} [options.fetcher] async (url) => GeoJSON | null, for body.id
 * @returns {Promise<{features: Array<Object>, warnings: Array<String>}>} GeoJSON Features
 */
export async function notificationFeatures(notifications, options = {}) {
  const fetcher = options.fetcher ?? defaultFetcher
  const features = []
  const warnings = []
  for (const note of notifications) {
    let body = [].concat(note.body ?? [])[0] ?? note.body
    if (!body || typeof body !== 'object') continue
    // A body that only references geography ({id, type:"Feature"}) needs a fetch.
    if (getId(body) && !body.geometry && !Array.isArray(body.features)) {
      try {
        const resolved = await fetcher(getId(body))
        if (resolved && bodyHasGeography(resolved)) body = resolved
      } catch (err) {
        if (isTimeout(err) && !warnings.includes(TIMEOUT_WARNING)) warnings.push(TIMEOUT_WARNING)
        continue
      }
    }
    const type = getType(body)
    const collected = []
    if (type === 'FeatureCollection') {
      for (const f of body.features ?? []) {
        if (f && f.geometry) collected.push(f)
      }
    } else if (body.geometry) {
      collected.push(body)
    } else if (body.type && body.coordinates) {
      collected.push({ type: 'Feature', geometry: body, properties: {} })
    }
    for (const feature of collected) {
      feature.properties = feature.properties && typeof feature.properties === 'object' ? feature.properties : {}
      feature.properties.__fromResource = 'Notification'
      if (!feature.properties.label && note.body?.label) feature.properties.label = note.body.label
      feature.properties.notification = {
        id: getId(note),
        creator: typeof note.creator === 'string' ? note.creator : getId(note.creator) || undefined,
        created: note.created ?? note.published ?? undefined,
        target: targetIds(note)[0]
      }
      features.push(feature)
    }
  }
  return { features, warnings }
}
