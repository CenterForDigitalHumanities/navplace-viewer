import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { normalize } from '../js/iiif.js'
import { discoverFeatures, displayedIds, ResourceResolver } from '../js/features.js'
import { IIIF_RESOURCE_TYPES, ANNOTATION_TYPES } from '../js/iiif.js'

const loadFixture = async (rel) =>
  JSON.parse(await readFile(fileURLToPath(new URL(`./${rel}`, import.meta.url)), 'utf8'))

// Map the fixture URLs onto the files on disk so referenced resources resolve.
const fixtureFetcher = async (uri) => {
  const name = String(uri).split('/').pop().replace(/\.json$/, '')
  for (const dir of ['fixtures/', 'referenced/']) {
    try {
      return JSON.parse(await readFile(fileURLToPath(new URL(`./${dir}${name}.json`, import.meta.url)), 'utf8'))
    } catch { /* try next */ }
  }
  throw new Error(`no fixture for ${uri}`)
}

test('discovers embedded navPlace on a manifest and its canvases', async () => {
  const resource = normalize(await loadFixture('fixtures/navplace-on-manifest-and-canvases.json'))
  const { features } = await discoverFeatures(resource, { resolve: false })
  assert.equal(features.length, 2)
  const fromManifest = features.find((f) => f.properties.__fromResource === 'Manifest')
  const fromCanvas = features.find((f) => f.properties.__fromResource === 'Canvas')
  assert.ok(fromManifest && fromCanvas)
  assert.equal(fromManifest.properties.manifest, resource.id)
  assert.equal(fromCanvas.properties.canvas, resource.items[0].id)
})

test('v2 manifests are normalized and discovered', async () => {
  const resource = normalize(await loadFixture('fixtures/v2-manifest.json'))
  const { features } = await discoverFeatures(resource, { resolve: false })
  assert.equal(features.length, 1)
  const f = features[0]
  assert.equal(f.properties.__fromResource, 'Canvas')
  assert.deepEqual(f.properties.label, { en: ['V2 canvas point'] })
  // inherited from the manifest
  assert.deepEqual(f.properties.navDate, '1863-08-28T00:00:00Z')
  assert.equal(f.properties.thumbnail[0].id, 'https://example.org/images/thumb-1.jpg')
})

test('referenced FeatureCollections are dereferenced through the resolver', async () => {
  const resource = normalize(await loadFixture('referenced/canvas-1.json'))
  const resolver = new ResourceResolver({ fetcher: fixtureFetcher })
  const { features } = await discoverFeatures(resource, { resolver })
  assert.ok(features.length >= 1)
  assert.ok(features.every((f) => f.geometry))
})

test('resolve=false leaves referenced geography undiscovered', async () => {
  const resource = normalize(await loadFixture('referenced/canvas-1.json'))
  const { features } = await discoverFeatures(resource, { resolve: false })
  assert.equal(features.length, 0)
})

test('dig=false only looks at the top level resource', async () => {
  const resource = normalize(await loadFixture('fixtures/navplace-on-manifest-and-canvases.json'))
  const { features } = await discoverFeatures(resource, { resolve: false, dig: false })
  assert.equal(features.length, 1)
  assert.equal(features[0].properties.__fromResource, 'Manifest')
})

test('features with the same id are collected once', async () => {
  const shared = { type: 'Feature', id: 'https://example.org/geo/same', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }
  const resource = normalize({
    '@context': 'https://iiif.io/api/presentation/3/context.json',
    id: 'https://example.org/m',
    type: 'Manifest',
    navPlace: { type: 'FeatureCollection', features: [shared] },
    items: [
      { id: 'https://example.org/c1', type: 'Canvas', navPlace: { type: 'FeatureCollection', features: [shared] } }
    ]
  })
  const { features } = await discoverFeatures(resource, { resolve: false })
  assert.equal(features.length, 1)
})

test('annotation pages are walked with the annotation body property', async () => {
  const resource = normalize({
    '@context': ['http://www.w3.org/ns/anno.jsonld', 'http://geojson.org/geojson-ld/geojson-context.jsonld'],
    id: 'https://example.org/ap/1',
    type: 'AnnotationPage',
    items: [
      {
        id: 'https://example.org/anno/1',
        type: 'Annotation',
        motivation: 'geo:tagging',
        body: { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: {} },
        target: 'https://example.org/canvas/9'
      },
      {
        id: 'https://example.org/anno/2',
        type: 'Annotation',
        body: { type: 'Point', coordinates: [2, 2] },
        target: 'https://example.org/canvas/10'
      }
    ]
  })
  const { features } = await discoverFeatures(resource, { supportedTypes: ANNOTATION_TYPES, resolve: false })
  assert.equal(features.length, 2)
  assert.equal(features[0].properties.anno, 'https://example.org/anno/1')
  assert.equal(features[0].properties.targeting, 'https://example.org/canvas/9')
  assert.deepEqual(features[1].geometry, { type: 'Point', coordinates: [2, 2] })
  assert.equal(features[1].properties.targeting, 'https://example.org/canvas/10')
})

test('processing limits stop runaway resources with a warning', async () => {
  const resource = normalize(await loadFixture('fixtures/scary.json'))
  const { features, warnings } = await discoverFeatures(resource, { resolve: false, findLimit: 100 })
  assert.ok(features.length <= 101)
  assert.ok(warnings.some((w) => /limit/i.test(w)))
})

test('the scary fixture is capped by the default feature limit', async () => {
  const resource = normalize(await loadFixture('fixtures/scary.json'))
  const { features, warnings } = await discoverFeatures(resource, { resolve: false })
  assert.equal(features.length, 1000)
  assert.ok(warnings.some((w) => /limit/i.test(w)))
})

test('displayedIds covers the resource tree and annotation targets', async () => {
  const resource = normalize(await loadFixture('fixtures/navplace-on-manifest-and-canvases.json'))
  const ids = displayedIds(resource, [])
  assert.ok(ids.has(resource.id))
  assert.ok(ids.has(resource.items[0].id))
})

test('ResourceResolver caches, dedupes ids, and enforces the fetch limit', async () => {
  let calls = 0
  const resolver = new ResourceResolver({
    fetcher: async (uri) => { calls += 1; return { id: uri, type: 'Canvas' } },
    fetchLimit: 2
  })
  const a = await resolver.resolve('https://example.org/x')
  const b = await resolver.resolve('https://example.org/x')
  assert.equal(a, b)
  assert.equal(calls, 1)
  assert.ok(await resolver.resolve('https://example.org/y'))
  assert.equal(resolver.exhausted, true)
  assert.equal(await resolver.resolve('https://example.org/z'), null)
  assert.equal(await resolver.resolve(''), null)
})
