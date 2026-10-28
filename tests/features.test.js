import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { normalize } from '../js/iiif.js'
import { discoverFeatures, displayedIds, ResourceResolver } from '../js/features.js'
import { ANNOTATION_TYPES } from '../js/iiif.js'

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

const pointCollection = (id, coordinates = [0, 0]) => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', id, geometry: { type: 'Point', coordinates }, properties: {} }]
})

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
})

test('a referenced navPlace FeatureCollection is dereferenced, even with resolve=false (legacy parity)', async () => {
  // canvas-1.json's navPlace is a bare { id, type: "FeatureCollection" } reference.
  for (const resolve of [true, false]) {
    const resource = normalize(await loadFixture('referenced/canvas-1.json'))
    const resolver = new ResourceResolver({ fetcher: fixtureFetcher })
    const { features } = await discoverFeatures(resource, { resolve, resolver })
    assert.equal(resolver.fetchCount, 1)
    assert.deepEqual(features.map((f) => f.id), ['https://www.example.com/feature/123123.json'])
    assert.ok(features[0].geometry)
    assert.equal(features[0].properties.__fromResource, 'Canvas')
  }
})

test('resolve=false does not fetch referenced resources', async () => {
  const fetched = []
  const resolver = new ResourceResolver({
    fetcher: async (uri) => {
      fetched.push(uri)
      return { id: uri, type: 'Canvas', navPlace: pointCollection('https://example.org/geo/c'), items: [] }
    }
  })
  const resource = normalize({
    id: 'https://example.org/m',
    type: 'Manifest',
    items: ['https://example.org/c1', { id: 'https://example.org/c2', type: 'Canvas' }]
  })
  const { features } = await discoverFeatures(resource, { resolve: false, resolver })
  assert.deepEqual(fetched, [])
  assert.equal(features.length, 0)
})

test('dig=false looks at the top level resource and its direct children only', async () => {
  const resource = normalize({
    id: 'https://example.org/col',
    type: 'Collection',
    navPlace: pointCollection('https://example.org/geo/col'),
    items: [{
      id: 'https://example.org/m',
      type: 'Manifest',
      navPlace: pointCollection('https://example.org/geo/m'),
      items: [{ id: 'https://example.org/c', type: 'Canvas', navPlace: pointCollection('https://example.org/geo/c') }]
    }]
  })
  const { features } = await discoverFeatures(resource, { resolve: false, dig: false })
  assert.deepEqual(features.map((f) => f.id), ['https://example.org/geo/col', 'https://example.org/geo/m'])
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

test('a Range uses a fetched Canvas first and the Manifest\'s own Canvas when the fetch fails', async () => {
  const manifest = (rangeItem) => normalize({
    id: 'https://example.org/m',
    type: 'Manifest',
    items: [
      { id: 'https://example.org/c1', type: 'Canvas', navPlace: pointCollection('https://example.org/geo/embedded'), items: [] },
      { id: 'https://example.org/c2', type: 'Canvas', navPlace: pointCollection('https://example.org/geo/c2'), items: [] }
    ],
    structures: [{ id: 'https://example.org/r', type: 'Range', items: [rangeItem] }]
  })
  const fetched = new ResourceResolver({
    fetcher: async (uri) => ({ id: uri, type: 'Canvas', navPlace: pointCollection('https://example.org/geo/fetched'), items: [] })
  })
  const failing = new ResourceResolver({ fetcher: async (uri) => { throw new Error(`404 ${uri}`) } })
  const ids = async (resource, options) => (await discoverFeatures(resource, options)).features.map((f) => f.id)

  for (const ref of [{ id: 'https://example.org/c1', type: 'Canvas' }, 'https://example.org/c1']) {
    assert.deepEqual(await ids(manifest(ref), { resolver: fetched }), ['https://example.org/geo/fetched'])
    assert.deepEqual(await ids(manifest(ref), { resolver: failing }), ['https://example.org/geo/embedded'])
    assert.deepEqual(await ids(manifest(ref), { resolve: false }), ['https://example.org/geo/embedded'])
  }
  // A fragment on the reference (part of a Canvas) still finds the Canvas.
  assert.deepEqual(await ids(manifest('https://example.org/c1#xywh=0,0,10,10'), { resolve: false }), ['https://example.org/geo/embedded'])
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

test('different resources that note the same Feature each show it', async () => {
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
  assert.deepEqual(features.map((f) => f.properties.__fromResource), ['Manifest', 'Canvas'])
})

test('a referenced Feature shared by two resources keeps each resource\'s properties', async () => {
  const resolver = new ResourceResolver({
    fetcher: async (uri) => ({ id: uri, type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: {} })
  })
  const ref = () => ({ type: 'FeatureCollection', features: [{ id: 'https://example.org/geo/ref', type: 'Feature' }] })
  const resource = normalize({
    id: 'https://example.org/m',
    type: 'Manifest',
    items: [
      { id: 'https://example.org/c1', type: 'Canvas', label: { en: ['One'] }, navPlace: ref(), items: [] },
      { id: 'https://example.org/c2', type: 'Canvas', label: { en: ['Two'] }, navPlace: ref(), items: [] }
    ]
  })
  const { features } = await discoverFeatures(resource, { resolver })
  assert.equal(resolver.fetchCount, 1)
  assert.deepEqual(features.map((f) => f.properties.canvas), ['https://example.org/c1', 'https://example.org/c2'])
  assert.deepEqual(features.map((f) => f.properties.label.en[0]), ['One', 'Two'])
})

test('a Canvas takes rights statements from its Manifest but never its descriptive properties', async () => {
  const requiredStatement = { label: { en: ['Attribution'] }, value: { en: ['The Library'] } }
  const resource = normalize({
    id: 'https://example.org/m',
    type: 'Manifest',
    label: { en: ['The Manifest'] },
    summary: { en: ['About the Manifest'] },
    navDate: '1863-08-28T00:00:00Z',
    thumbnail: [{ id: 'https://example.org/m-thumb.jpg', type: 'Image' }],
    rights: 'http://creativecommons.org/licenses/by/4.0/',
    requiredStatement,
    items: [{ id: 'https://example.org/c1', type: 'Canvas', navPlace: pointCollection('https://example.org/geo/c1'), items: [] }]
  })
  const { features } = await discoverFeatures(resource, { resolve: false })
  assert.equal(features.length, 1)
  const p = features[0].properties
  assert.equal(p.label, undefined)
  assert.equal(p.summary, undefined)
  assert.equal(p.navDate, undefined)
  assert.equal(p.thumbnail, undefined)
  assert.equal(p.rights, 'http://creativecommons.org/licenses/by/4.0/')
  assert.deepEqual(p.requiredStatement, requiredStatement)
})

test('a resource listed twice is drawn once', async () => {
  const manifest = { id: 'https://example.org/m', type: 'Manifest', navPlace: pointCollection('https://example.org/geo/m'), items: [] }
  const resource = normalize({ id: 'https://example.org/col', type: 'Collection', items: [manifest, manifest] })
  const { features } = await discoverFeatures(resource, { resolve: false })
  assert.equal(features.length, 1)
})

test('a Manifest with structures is mapped through its Ranges, not its items', async () => {
  const canvas = (n) => ({ id: `https://example.org/c${n}`, type: 'Canvas', navPlace: pointCollection(`https://example.org/geo/c${n}`), items: [] })
  const resource = normalize({
    id: 'https://example.org/m',
    type: 'Manifest',
    items: [canvas(1), canvas(2)],
    structures: [{ id: 'https://example.org/r', type: 'Range', items: [canvas(2)] }]
  })
  const { features } = await discoverFeatures(resource, { resolve: false })
  assert.deepEqual(features.map((f) => f.id), ['https://example.org/geo/c2'])
})

test('the manifest-with-range fixture shows only the curated Range', async () => {
  const resource = normalize(await loadFixture('referenced/manifest-with-range.json'))
  const resolver = new ResourceResolver({ fetcher: fixtureFetcher })
  const { features } = await discoverFeatures(resource, { resolver })
  assert.deepEqual(features.map((f) => f.id), ['http://example.com/feature/5', 'http://example.com/feature/3', 'http://example.com/feature/1'])
})

test('dig=false on a Manifest with structures still shows the Canvases its Ranges list', async () => {
  const canvas = (n) => ({ id: `https://example.org/c${n}`, type: 'Canvas', navPlace: pointCollection(`https://example.org/geo/c${n}`), items: [] })
  const resource = normalize({
    id: 'https://example.org/m',
    type: 'Manifest',
    items: [canvas(1), canvas(2)],
    structures: [{
      id: 'https://example.org/r',
      type: 'Range',
      items: [canvas(2), { id: 'https://example.org/r2', type: 'Range', items: [canvas(3)] }]
    }]
  })
  const { features } = await discoverFeatures(resource, { resolve: false, dig: false })
  assert.deepEqual(features.map((f) => f.id), ['https://example.org/geo/c2'])
})

test('a feature thumbnail written as one object is kept', async () => {
  const resource = normalize({
    id: 'https://example.org/c',
    type: 'Canvas',
    thumbnail: [{ id: 'https://example.org/canvas-thumb.jpg' }],
    navPlace: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { thumbnail: { id: 'https://example.org/feature-thumb.jpg' } }
      }]
    }
  })
  const { features } = await discoverFeatures(resource, { resolve: false })
  assert.deepEqual(features[0].properties.thumbnail, [{ id: 'https://example.org/feature-thumb.jpg' }])
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
  const resource = normalize({
    id: 'https://example.org/m',
    type: 'Manifest',
    items: Array.from({ length: 150 }, (_, i) => ({ id: `https://example.org/c${i}`, type: 'Canvas', navPlace: pointCollection(`https://example.org/geo/${i}`) }))
  })
  const { features, warnings } = await discoverFeatures(resource, { resolve: false, findLimit: 100 })
  assert.ok(features.length <= 100)
  assert.ok(warnings.some((w) => /processing limit/.test(w)))
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

test('the scary fixture renders every Feature (limits cap resources, not Features)', async () => {
  const resource = normalize(await loadFixture('fixtures/scary.json'))
  const { features, warnings } = await discoverFeatures(resource, { resolve: false })
  assert.equal(features.length, 3221)
  assert.deepEqual(warnings, [])
})

test('displayedIds covers the resource tree and annotation targets, without fragments', () => {
  const resource = normalize({
    id: 'https://example.org/m',
    type: 'Manifest',
    items: [{ id: 'https://example.org/c1', type: 'Canvas' }],
    structures: [{ id: 'https://example.org/r', type: 'Range', items: [{ id: 'https://example.org/c2', type: 'Canvas' }] }]
  })
  const features = [{ properties: { anno: 'https://example.org/anno/1', targeting: 'https://example.org/c9#xywh=0,0,10,10' } }]
  assert.deepEqual([...displayedIds(resource, features)].sort(), [
    'https://example.org/anno/1',
    'https://example.org/c1',
    'https://example.org/c2',
    'https://example.org/c9',
    'https://example.org/m',
    'https://example.org/r'
  ])
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
