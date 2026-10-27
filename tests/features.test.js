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

test('dig=false looks at the top level resource and its direct children', async () => {
  const resource = normalize(await loadFixture('fixtures/navplace-on-manifest-and-canvases.json'))
  const { features } = await discoverFeatures(resource, { resolve: false, dig: false })
  assert.deepEqual(features.map((f) => f.properties.__fromResource).sort(), ['Canvas', 'Manifest'])
})

test('dig=false stops below the direct children', async () => {
  const point = (id) => ({ type: 'FeatureCollection', features: [{ type: 'Feature', id, geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }] })
  const resource = normalize({
    id: 'https://example.org/col',
    type: 'Collection',
    items: [{
      id: 'https://example.org/m',
      type: 'Manifest',
      navPlace: point('https://example.org/geo/m'),
      items: [{ id: 'https://example.org/c', type: 'Canvas', navPlace: point('https://example.org/geo/c') }]
    }]
  })
  const { features } = await discoverFeatures(resource, { resolve: false, dig: false })
  assert.deepEqual(features.map((f) => f.id), ['https://example.org/geo/m'])
})

test('a Manifest-level feature falls back to the first Canvas image', async () => {
  const resource = normalize({
    id: 'https://example.org/m',
    type: 'Manifest',
    navPlace: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }] },
    items: [{
      id: 'https://example.org/c',
      type: 'Canvas',
      items: [{ type: 'AnnotationPage', items: [{ type: 'Annotation', motivation: 'painting', body: { id: 'https://example.org/full.jpg', type: 'Image' } }] }]
    }]
  })
  const { features } = await discoverFeatures(resource, { resolve: false })
  assert.equal(features[0].properties.thumbnail[0].id, 'https://example.org/full.jpg')
})

test('a v2 Canvas feature falls back to its painted image', async () => {
  const resource = normalize({
    '@id': 'https://example.org/m',
    '@type': 'sc:Manifest',
    sequences: [{
      canvases: [{
        '@id': 'https://example.org/c',
        '@type': 'sc:Canvas',
        images: [{ '@type': 'oa:Annotation', resource: { '@id': 'https://example.org/v2.jpg' } }],
        navPlace: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }] }
      }]
    }]
  })
  const { features } = await discoverFeatures(resource, { resolve: false })
  assert.equal(features[0].properties.thumbnail[0].id, 'https://example.org/v2.jpg')
})

test('a referenced v2 Manifest is normalized and walked', async () => {
  const v2 = await loadFixture('fixtures/v2-manifest.json')
  const resolver = new ResourceResolver({
    fetcher: async (uri) => {
      if (uri === v2['@id']) return structuredClone(v2)
      throw new Error(`404 ${uri}`)
    }
  })
  const resource = normalize({
    '@context': 'http://iiif.io/api/presentation/2/context.json',
    '@id': 'https://example.org/col',
    '@type': 'sc:Collection',
    manifests: [{ '@id': v2['@id'], '@type': 'sc:Manifest' }]
  })
  const { features } = await discoverFeatures(resource, { resolver })
  assert.equal(features.length, 1)
  assert.equal(features[0].properties.__fromResource, 'Canvas')
})

test('a SpecificResource target links to its source', async () => {
  const resource = normalize({
    id: 'https://example.org/anno/1',
    type: 'Annotation',
    body: { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: {} },
    target: { type: 'SpecificResource', source: 'https://example.org/canvas/1', selector: { type: 'FragmentSelector', value: 'xywh=0,0,10,10' } }
  })
  const { features } = await discoverFeatures(resource, { supportedTypes: ANNOTATION_TYPES, resolve: false })
  assert.equal(features[0].properties.targeting, 'https://example.org/canvas/1')
  assert.ok(displayedIds(resource, features).has('https://example.org/canvas/1'))
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

test('circular references report each limit warning once', async () => {
  const ids = ['a', 'b', 'c'].map((n) => `https://example.org/col/${n}`)
  const graph = {
    [ids[0]]: [ids[1]],
    [ids[1]]: [ids[0], ids[2]],
    [ids[2]]: [ids[0]]
  }
  const resolver = new ResourceResolver({
    fetcher: async (uri) => ({ id: uri, type: 'Collection', items: graph[uri].map((id) => ({ id, type: 'Collection' })) })
  })
  const resource = normalize({ id: ids[0], type: 'Collection', items: [{ id: ids[1], type: 'Collection' }] })
  const { warnings } = await discoverFeatures(resource, { resolver })
  assert.deepEqual(warnings, ['Resource processing limit (1000) reached. Check for circular references.'])
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
