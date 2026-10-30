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
 * Only the first INBOX_LIMIT inboxes are read, all at once, and every request
 * shares one LDN_TIMEOUT_MS deadline, so slow inboxes cost LDN_TIMEOUT_MS in
 * total.  Whatever is not read by then is skipped with a warning.
 * No motivation filtering: any notification carrying geography renders.
 */

import { getId, getType, getTargetId } from './iiif.js'

export const NOTIFICATION_LIMIT = 50
export const INBOX_LIMIT = 5
export const NOTIFICATION_COLOR = '#ff7f0e'

export const LDN_TIMEOUT_MS = 8000
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
 * structures deep, matching what the viewer actually renders), followed by
 * the inboxes of the resources fetched while discovering features, so a
 * Collection of referenced Manifests reads their inboxes too.
 * @param {Object} resource normalized resource
 * @param {Iterable<Object>} [resolved] normalized resources the resolver fetched
 * @returns {Array<String>} unique inbox URLs, top-level first
 */
export function findInboxes(resource, resolved = []) {
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
  const scan = (node) => {
    if (!node || typeof node !== 'object') return
    add(node)
    for (const child of node.items ?? []) {
      add(child)
      for (const grandchild of child?.items ?? []) add(grandchild)
    }
    for (const range of node.structures ?? []) add(range)
  }
  scan(resource)
  for (const node of resolved) scan(node)
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

async function defaultFetcher(url, signal) {
  const resp = await globalThis.fetch(url, {
    headers: { Accept: 'application/ld+json, application/activity+json, application/json' },
    signal
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
  return [].concat(body ?? []).some((b) => {
    if (!b || typeof b !== 'object') return false
    const type = getType(b)
    if (type === 'Feature' || type === 'FeatureCollection') return true
    if (b.geometry) return true
    return b.type === 'Point' || b.type === 'Polygon' || b.type === 'LineString' ||
      b.type === 'MultiPoint' || b.type === 'MultiPolygon' || b.type === 'MultiLineString'
  })
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
 * @param {Function} [options.fetcher] async (url, signal) => parsed JSON | null
 * @param {Number} [options.limit]
 * @param {Number} [options.inboxLimit] how many inboxes are read, in findInboxes() order
 * @param {Iterable<Object>} [options.resolved] resources fetched during discovery,
 *   whose inboxes are read after the resource's own
 * @param {AbortSignal} [options.signal] one deadline for every request;
 *   defaults to LDN_TIMEOUT_MS from now
 * @returns {Promise<{notifications: Array, warnings: Array<String>}>}
 */
export async function collectNotifications(resource, options = {}) {
  const fetcher = options.fetcher ?? defaultFetcher
  const limit = options.limit ?? NOTIFICATION_LIMIT
  const inboxLimit = options.inboxLimit ?? INBOX_LIMIT
  const signal = options.signal ?? AbortSignal.timeout(LDN_TIMEOUT_MS)
  const displayed = options.displayed
  const warnings = []
  const notifications = []
  const limitWarning = `Notification limit (${limit}) reached; some inbox entries were not shown.`
  const warnOnce = (message) => {
    if (!warnings.includes(message)) warnings.push(message)
  }
  let fetched = 0

  const inboxes = findInboxes(resource, options.resolved ?? [])
  if (inboxes.length > inboxLimit) warnOnce(`LDN inbox limit (${inboxLimit}) reached; some inboxes were not read.`)
  // Read in parallel, so one slow inbox does not use up the deadline for the rest.
  const containers = await Promise.allSettled(inboxes.slice(0, inboxLimit).map((inbox) => fetcher(inbox, signal)))
  for (const result of containers) {
    if (notifications.length >= limit) break
    if (result.status === 'rejected') {
      // 401/404/405/CORS/network: LDN is additive, stay silent.  A slow inbox is reported.
      if (isTimeout(result.reason)) warnOnce(TIMEOUT_WARNING)
      continue
    }
    for (let note of notificationsFromContainer(result.value)) {
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
          note = await fetcher(iri, signal)
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
 * @param {Function} [options.fetcher] async (url, signal) => GeoJSON | null, for body.id
 * @param {AbortSignal} [options.signal] the deadline given to collectNotifications,
 *   so both share one; defaults to LDN_TIMEOUT_MS from now
 * @returns {Promise<{features: Array<Object>, warnings: Array<String>}>} GeoJSON Features
 */
export async function notificationFeatures(notifications, options = {}) {
  const fetcher = options.fetcher ?? defaultFetcher
  const signal = options.signal ?? AbortSignal.timeout(LDN_TIMEOUT_MS)
  const features = []
  const warnings = []
  for (const note of notifications) {
    const bodies = [].concat(note.body ?? [])
    for (let body of bodies) {
      if (!body || typeof body !== 'object') continue
      // A body that only references geography ({id, type:"Feature"}) needs a fetch.
      if (getId(body) && !body.geometry && !Array.isArray(body.features)) {
        try {
          const resolved = await fetcher(getId(body), signal)
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
        if (!feature.properties.label && body.label) feature.properties.label = body.label
        feature.properties.notification = {
          id: getId(note),
          creator: typeof note.creator === 'string' ? note.creator : getId(note.creator) || undefined,
          created: note.created ?? note.published ?? undefined,
          target: targetIds(note)[0]
        }
        features.push(feature)
      }
    }
  }
  return { features, warnings }
}
