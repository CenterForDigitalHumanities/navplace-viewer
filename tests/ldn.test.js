import test from 'node:test'
import assert from 'node:assert/strict'
import { normalize } from '../js/iiif.js'
import {
  findInboxes, notificationsFromContainer, bodyHasGeography,
  collectNotifications, notificationFeatures, NOTIFICATION_COLOR
} from '../js/ldn.js'

const geoFeature = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-90, 38] },
  properties: {}
}

const makeNote = (id, target, body = geoFeature, extra = {}) => ({
  '@context': 'http://www.w3.org/ns/anno.jsonld',
  id,
  type: 'Annotation',
  motivation: 'geo:tagging',
  target,
  body,
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

test('collectNotifications does not filter by motivation', async () => {
  const resource = normalize({ id: 'https://example.org/m', type: 'Manifest', inbox: 'https://example.org/inbox' })
  const noting = makeNote('https://example.org/n/1', 'https://example.org/m', geoFeature, { motivation: 'oa:commenting' })
  const { notifications } = await collectNotifications(resource, {
    fetcher: async () => [noting],
    displayed: new Set(['https://example.org/m'])
  })
  assert.equal(notifications.length, 1)
})

test('inbox failures are silent', async () => {
  const resource = normalize({ id: 'https://example.org/m', type: 'Manifest', inbox: 'https://example.org/inbox' })
  const { notifications, warnings } = await collectNotifications(resource, {
    fetcher: async () => { throw new Error('CORS blocked') }
  })
  assert.deepEqual(notifications, [])
  assert.deepEqual(warnings, [])
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

test('notificationFeatures tags features orange-source and attributes the sender', async () => {
  const note = makeNote('https://example.org/n/1', 'https://example.org/c1', geoFeature, {
    creator: { id: 'https://orcid.org/0000-0002-1825-0097' },
    created: '2026-01-02T00:00:00Z'
  })
  const features = await notificationFeatures([note])
  assert.equal(features.length, 1)
  assert.equal(features[0].properties.__fromResource, 'Notification')
  assert.equal(features[0].properties.notification.creator, 'https://orcid.org/0000-0002-1825-0097')
  assert.equal(NOTIFICATION_COLOR, '#ff7f0e')
})

test('notificationFeatures resolves a referenced body.id', async () => {
  const note = makeNote('https://example.org/n/1', 'https://example.org/c1', { id: 'https://example.org/geo/1.json', type: 'Feature' })
  const features = await notificationFeatures([note], {
    fetcher: async () => geoFeature
  })
  assert.equal(features.length, 1)
  assert.deepEqual(features[0].geometry, geoFeature.geometry)
})
