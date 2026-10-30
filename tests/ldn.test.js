import test from 'node:test'
import assert from 'node:assert/strict'
import { normalize } from '../js/iiif.js'
import {
  findInboxes, notificationsFromContainer, bodyHasGeography,
  collectNotifications, notificationFeatures, INBOX_LIMIT
} from '../js/ldn.js'

const geoFeature = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-90, 38] },
  properties: {}
}

// notificationFeatures tags the body in place, so every note gets its own copy.
const makeNote = (id, target, body = geoFeature, extra = {}) => ({
  '@context': 'http://www.w3.org/ns/anno.jsonld',
  id,
  type: 'Annotation',
  motivation: 'geo:tagging',
  target,
  body: structuredClone(body),
  ...extra
})

test('findInboxes scans the resource and its children, top level first', () => {
  const resource = normalize({
    id: 'https://example.org/m',
    type: 'Manifest',
    inbox: 'https://example.org/inbox/m',
    items: [
      { id: 'https://example.org/c1', type: 'Canvas', 'ldp:inbox': { id: 'https://example.org/inbox/c1' } },
      { id: 'https://example.org/c2', type: 'Canvas' }
    ]
  })
  assert.deepEqual(findInboxes(resource), [
    'https://example.org/inbox/m',
    'https://example.org/inbox/c1'
  ])
})

test('findInboxes also scans resources fetched during discovery', () => {
  const collection = normalize({ id: 'https://example.org/col', type: 'Collection', items: [{ id: 'https://example.org/m', type: 'Manifest' }] })
  const manifest = normalize({
    id: 'https://example.org/m',
    type: 'Manifest',
    inbox: 'https://example.org/inbox/m',
    items: [{ id: 'https://example.org/c1', type: 'Canvas', inbox: 'https://example.org/inbox/c1' }]
  })
  assert.deepEqual(findInboxes(collection), [])
  // A failed fetch is cached as null, and one resource may be cached under two keys.
  assert.deepEqual(findInboxes(collection, [manifest, null, manifest]), [
    'https://example.org/inbox/m',
    'https://example.org/inbox/c1'
  ])
})

test('collectNotifications reads the inboxes of resolved resources', async () => {
  const collection = normalize({ id: 'https://example.org/col', type: 'Collection', items: [{ id: 'https://example.org/m', type: 'Manifest' }] })
  const manifest = normalize({ id: 'https://example.org/m', type: 'Manifest', inbox: 'https://example.org/inbox/m' })
  const fetched = []
  const fetcher = async (url) => {
    fetched.push(url)
    return [makeNote('https://example.org/n/1', 'https://example.org/m')]
  }
  const { notifications } = await collectNotifications(collection, {
    fetcher,
    resolved: [manifest],
    displayed: new Set(['https://example.org/col', 'https://example.org/m'])
  })
  assert.deepEqual(fetched, ['https://example.org/inbox/m'])
  assert.deepEqual(notifications.map((n) => n.id), ['https://example.org/n/1'])
})

test('notificationsFromContainer accepts every LDPC shape', () => {
  const note = { id: 'a', type: 'Annotation' }
  assert.deepEqual(notificationsFromContainer([note]), [note])
  assert.deepEqual(notificationsFromContainer({ 'ldp:contains': [note] }), [note])
  assert.deepEqual(notificationsFromContainer({ contains: [note] }), [note])
  assert.deepEqual(notificationsFromContainer({ members: [note] }), [note])
  assert.deepEqual(notificationsFromContainer({ '@graph': [note] }), [note])
  assert.deepEqual(notificationsFromContainer(null), [])
})

test('bodyHasGeography recognizes embedded and bare geometry', () => {
  assert.equal(bodyHasGeography(geoFeature), true)
  assert.equal(bodyHasGeography({ type: 'FeatureCollection', features: [] }), true)
  assert.equal(bodyHasGeography({ type: 'Point', coordinates: [1, 2] }), true)
  assert.equal(bodyHasGeography({ type: 'Text', value: 'hello' }), false)
})

test('bodyHasGeography recognizes geography in any body entry', () => {
  assert.equal(bodyHasGeography([
    { type: 'Text', value: 'a description' },
    { type: 'FeatureCollection', features: [geoFeature] }
  ]), true)
  assert.equal(bodyHasGeography([
    { type: 'Text', value: 'a description' },
    { type: 'Text', value: 'another description' }
  ]), false)
})

test('collectNotifications keeps geo notifications targeting displayed ids', async () => {
  const resource = normalize({
    id: 'https://example.org/m',
    type: 'Manifest',
    inbox: 'https://example.org/inbox/m',
    items: [{ id: 'https://example.org/c1', type: 'Canvas' }]
  })
  const notes = [
    makeNote('https://example.org/n/1', 'https://example.org/c1'),
    makeNote('https://example.org/n/2', 'https://example.org/elsewhere'),
    makeNote('https://example.org/n/3', 'https://example.org/m', { type: 'Text', value: 'no geography' })
  ]
  const fetcher = async () => ({ '@context': 'http://www.w3.org/ns/ldp', 'ldp:contains': notes })
  const displayed = new Set(['https://example.org/m', 'https://example.org/c1'])
  const { notifications } = await collectNotifications(resource, { displayed, fetcher })
  assert.deepEqual(notifications.map((n) => n.id), ['https://example.org/n/1'])
})

test('collectNotifications accepts geography in later body entries', async () => {
  const resource = normalize({
    id: 'https://example.org/m',
    type: 'Manifest',
    inbox: 'https://example.org/inbox'
  })
  const note = makeNote('https://example.org/n/1', 'https://example.org/m', [
    { type: 'Text', value: 'A description' },
    { type: 'FeatureCollection', features: [geoFeature] }
  ])
  const { notifications } = await collectNotifications(resource, {
    fetcher: async () => [note],
    displayed: new Set(['https://example.org/m'])
  })
  assert.deepEqual(notifications.map((n) => n.id), ['https://example.org/n/1'])
})

test('collectNotifications does not filter by motivation', async () => {
  const resource = normalize({ id: 'https://example.org/m', type: 'Manifest', inbox: 'https://example.org/inbox' })
  const noting = makeNote('https://example.org/n/1', 'https://example.org/m', geoFeature, { motivation: 'oa:commenting' })
  const { notifications } = await collectNotifications(resource, {
    fetcher: async () => [noting],
    displayed: new Set(['https://example.org/m'])
  })
  assert.equal(notifications.length, 1)
})

test('collectNotifications fetches notifications listed by IRI', async () => {
  const resource = normalize({ id: 'https://example.org/m', type: 'Manifest', inbox: 'https://example.org/inbox' })
  const notes = {
    'https://example.org/n/1': makeNote('https://example.org/n/1', 'https://example.org/m'),
    'https://example.org/n/2': makeNote('https://example.org/n/2', 'https://example.org/m')
  }
  const fetched = []
  const fetcher = async (url) => {
    fetched.push(url)
    if (url === 'https://example.org/inbox') return { 'ldp:contains': ['https://example.org/n/1', { '@id': 'https://example.org/n/2' }, 'https://example.org/n/missing'] }
    if (notes[url]) return notes[url]
    throw new Error('404')
  }
  const { notifications } = await collectNotifications(resource, { fetcher, displayed: new Set(['https://example.org/m']) })
  assert.deepEqual(notifications.map((n) => n.id), ['https://example.org/n/1', 'https://example.org/n/2'])
  assert.ok(fetched.includes('https://example.org/n/missing'))
})

test('IRI fetches stop at the notification limit', async () => {
  const resource = normalize({ id: 'https://example.org/m', type: 'Manifest', inbox: 'https://example.org/inbox' })
  let fetches = 0
  const fetcher = async (url) => {
    if (url === 'https://example.org/inbox') return Array.from({ length: 10 }, (_, i) => `https://example.org/n/${i}`)
    fetches += 1
    return makeNote(url, 'https://example.org/m', { type: 'Text', value: 'no geography' })
  }
  const { notifications, warnings } = await collectNotifications(resource, { fetcher, limit: 3 })
  assert.equal(fetches, 3)
  assert.equal(notifications.length, 0)
  assert.equal(warnings.length, 1)
})

test('inbox failures are silent', async () => {
  const resource = normalize({ id: 'https://example.org/m', type: 'Manifest', inbox: 'https://example.org/inbox' })
  const { notifications, warnings } = await collectNotifications(resource, {
    fetcher: async () => { throw new Error('CORS blocked') }
  })
  assert.deepEqual(notifications, [])
  assert.deepEqual(warnings, [])
})

test('a slow inbox or notification is skipped with one warning', async () => {
  const resource = normalize({
    id: 'https://example.org/m',
    type: 'Manifest',
    inbox: 'https://example.org/inbox/slow',
    items: [{ id: 'https://example.org/c1', type: 'Canvas', inbox: 'https://example.org/inbox/c1' }]
  })
  const timeout = () => { throw new DOMException('signal timed out', 'TimeoutError') }
  const fetcher = async (url) => {
    if (url === 'https://example.org/inbox/c1') return ['https://example.org/n/slow']
    return timeout()
  }
  const { notifications, warnings } = await collectNotifications(resource, { fetcher })
  assert.deepEqual(notifications, [])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /took too long to respond/)
})

test('the default fetcher gives every LDN request a timeout signal', async () => {
  const realFetch = globalThis.fetch
  const signals = []
  globalThis.fetch = async (url, init) => {
    signals.push(init?.signal)
    return { ok: true, json: async () => [] }
  }
  try {
    const resource = normalize({ id: 'https://example.org/m', type: 'Manifest', inbox: 'https://example.org/inbox' })
    await collectNotifications(resource)
  } finally {
    globalThis.fetch = realFetch
  }
  assert.equal(signals.length, 1)
  assert.ok(signals[0] instanceof AbortSignal)
})

test('only the first INBOX_LIMIT inboxes are read, and the rest are reported', async () => {
  const resource = normalize({
    id: 'https://example.org/m',
    type: 'Manifest',
    inbox: 'https://example.org/inbox/m',
    items: Array.from({ length: INBOX_LIMIT + 1 }, (_, i) => ({ id: `https://example.org/c${i}`, type: 'Canvas', inbox: `https://example.org/inbox/c${i}` }))
  })
  const fetched = []
  const fetcher = async (url) => {
    fetched.push(url)
    return []
  }
  const { warnings } = await collectNotifications(resource, { fetcher })
  assert.equal(fetched.length, INBOX_LIMIT)
  assert.deepEqual(fetched, findInboxes(resource).slice(0, INBOX_LIMIT))
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /inbox limit/)
})

test('inboxes are read in parallel, so slow ones share one wait', async () => {
  const resource = normalize({
    id: 'https://example.org/m',
    type: 'Manifest',
    inbox: 'https://example.org/inbox/m',
    items: [{ id: 'https://example.org/c1', type: 'Canvas', inbox: 'https://example.org/inbox/c1' }]
  })
  let inFlight = 0
  let most = 0
  const fetcher = async () => {
    inFlight += 1
    most = Math.max(most, inFlight)
    await new Promise((resolve) => setTimeout(resolve, 10))
    inFlight -= 1
    return []
  }
  await collectNotifications(resource, { fetcher })
  assert.equal(most, 2)
})

test('one deadline is shared by every inbox, notification, and body request', async () => {
  const resource = normalize({
    id: 'https://example.org/m',
    type: 'Manifest',
    inbox: 'https://example.org/inbox/m',
    items: [{ id: 'https://example.org/c1', type: 'Canvas', inbox: 'https://example.org/inbox/c1' }]
  })
  const signal = AbortSignal.timeout(60000)
  const seen = []
  const referenced = makeNote('https://example.org/n/1', 'https://example.org/m', { id: 'https://example.org/geo/1.json', type: 'Feature' })
  const fetcher = async (url, s) => {
    seen.push(s)
    if (url === 'https://example.org/inbox/m') return ['https://example.org/n/1']
    if (url === 'https://example.org/n/1') return referenced
    if (url === 'https://example.org/geo/1.json') return structuredClone(geoFeature)
    return []
  }
  const { notifications } = await collectNotifications(resource, { fetcher, signal })
  await notificationFeatures(notifications, { fetcher, signal })
  assert.equal(seen.length, 4)
  assert.ok(seen.every((s) => s === signal))
})

test('notification cap warns', async () => {
  const resource = normalize({ id: 'https://example.org/m', type: 'Manifest', inbox: 'https://example.org/inbox' })
  const many = Array.from({ length: 5 }, (_, i) => makeNote(`https://example.org/n/${i}`, 'https://example.org/m'))
  const { notifications, warnings } = await collectNotifications(resource, {
    fetcher: async () => many,
    limit: 3,
    displayed: new Set(['https://example.org/m'])
  })
  assert.equal(notifications.length, 3)
  assert.ok(warnings.length)
})

test('notificationFeatures marks features as Notification and attributes the sender', async () => {
  const note = makeNote('https://example.org/n/1', 'https://example.org/c1', geoFeature, {
    creator: { id: 'https://orcid.org/0000-0002-1825-0097' },
    created: '2026-01-02T00:00:00Z'
  })
  const { features } = await notificationFeatures([note])
  assert.equal(features.length, 1)
  assert.equal(features[0].properties.__fromResource, 'Notification')
  assert.deepEqual(features[0].properties.notification, {
    id: 'https://example.org/n/1',
    creator: 'https://orcid.org/0000-0002-1825-0097',
    created: '2026-01-02T00:00:00Z',
    target: 'https://example.org/c1'
  })
})

test('notificationFeatures renders geography from later body entries', async () => {
  const note = makeNote('https://example.org/n/1', 'https://example.org/c1', [
    { type: 'Text', value: 'A description' },
    { type: 'FeatureCollection', features: [geoFeature] }
  ])
  const { features } = await notificationFeatures([note])
  assert.equal(features.length, 1)
  assert.deepEqual(features[0].geometry, geoFeature.geometry)
  assert.equal(features[0].properties.__fromResource, 'Notification')
})

test('notificationFeatures resolves a referenced body.id', async () => {
  const note = makeNote('https://example.org/n/1', 'https://example.org/c1', { id: 'https://example.org/geo/1.json', type: 'Feature' })
  const { features } = await notificationFeatures([note], {
    fetcher: async () => structuredClone(geoFeature)
  })
  assert.equal(features.length, 1)
  assert.deepEqual(features[0].geometry, geoFeature.geometry)
})

test('notificationFeatures warns when a referenced body times out', async () => {
  const note = makeNote('https://example.org/n/1', 'https://example.org/c1', { id: 'https://example.org/geo/1.json', type: 'Feature' })
  const { features, warnings } = await notificationFeatures([note], {
    fetcher: async () => { throw new DOMException('signal timed out', 'TimeoutError') }
  })
  assert.deepEqual(features, [])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /took too long to respond/)
})
