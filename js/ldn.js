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
 * No motivation filtering: any notification carrying geography renders.
 */

import { getId, getType } from './iiif.js'

export const NOTIFICATION_LIMIT = 50
export const NOTIFICATION_COLOR = '#ff7f0e'

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

async function defaultFetcher(url) {
  const resp = await globalThis.fetch(url, {
    headers: { Accept: 'application/ld+json, application/activity+json, application/json' }
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
    const id = typeof target === 'string' ? target : getId(target)
    if (id) ids.push(String(id).split('#')[0])
  }
  return ids
}

/**
 * Fetch geo-carrying notifications for a displayed resource.
 * @param {Object} resource normalized top-level resource
 * @param {Object} options
 * @param {Set<String>} [options.displayed] ids on screen; notifications
 *   targeting other resources are skipped when provided
 * @param {Function} [options.fetcher] async (url) => parsed JSON | null
 * @param {ResourceResolver} [options.resolver] used to resolve body.id
 * @param {Number} [options.limit]
 * @returns {Promise<{notifications: Array, warnings: Array<String>}>}
 */
export async function collectNotifications(resource, options = {}) {
  const fetcher = options.fetcher ?? defaultFetcher
  const limit = options.limit ?? NOTIFICATION_LIMIT
  const displayed = options.displayed
  const warnings = []
  const notifications = []

  for (const inbox of findInboxes(resource)) {
    if (notifications.length >= limit) break
    let container = null
    try {
      container = await fetcher(inbox)
    } catch (err) {
      continue // 401/404/405/CORS/network: LDN is additive, stay silent
    }
    for (const note of notificationsFromContainer(container)) {
      if (notifications.length >= limit) {
        warnings.push(`Notification limit (${limit}) reached; some inbox entries were not shown.`)
        break
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
 * @returns {Promise<Array<Object>>} GeoJSON Features
 */
export async function notificationFeatures(notifications, options = {}) {
  const fetcher = options.fetcher ?? defaultFetcher
  const features = []
  for (const note of notifications) {
    let body = [].concat(note.body ?? [])[0] ?? note.body
    if (!body || typeof body !== 'object') continue
    // A body that only references geography ({id, type:"Feature"}) needs a fetch.
    if (getId(body) && !body.geometry && !Array.isArray(body.features)) {
      try {
        const resolved = await fetcher(getId(body))
        if (resolved && bodyHasGeography(resolved)) body = resolved
      } catch (err) {
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
        source: getId(note) || undefined,
        creator: typeof note.creator === 'string' ? note.creator : getId(note.creator) || undefined,
        created: note.created ?? note.published ?? undefined,
        target: targetIds(note)[0]
      }
      features.push(feature)
    }
  }
  return features
}
