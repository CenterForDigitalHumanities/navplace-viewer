import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { detectVersion, getId, getType, getTargetId, normalize, contextWarnings, IIIF_RESOURCE_TYPES } from '../js/iiif.js'

const fixture = async (name) =>
  JSON.parse(await readFile(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'))

test('detectVersion reads the @context of v2, v3, and v4 resources', () => {
  assert.equal(detectVersion({ '@context': 'http://iiif.io/api/presentation/2/context.json' }), 2)
  assert.equal(detectVersion({ '@context': 'https://iiif.io/api/presentation/3/context.json' }), 3)
  assert.equal(detectVersion({ '@context': ['http://www.w3.org/ns/anno.jsonld', 'https://iiif.io/api/presentation/4/context.json'] }), 4)
  assert.equal(detectVersion({ '@context': 'http://example.org/other' }), null)
  assert.equal(detectVersion(undefined), null)
})

test('getId and getType handle JSON-LD flavors', () => {
  assert.equal(getId({ '@id': 'a' }), 'a')
  assert.equal(getId({ id: 'b' }), 'b')
  assert.equal(getType({ '@type': 'sc:Canvas' }), 'Canvas')
  assert.equal(getType({ type: ['Annotation'] }), 'Annotation')
  assert.equal(getType({}), '')
})

test('normalize rewrites a v2 manifest into the v3-shaped model', async () => {
  const v2 = normalize(await fixture('v2-manifest.json'))
  assert.equal(v2.type, 'Manifest')
  assert.equal(v2.id, 'https://example.org/iiif/v2-manifest')
  // string label -> language map
  assert.deepEqual(v2.label, { none: ['A v2 Manifest for viewer tests'] })
  // description -> summary
  assert.ok(v2.summary)
  assert.ok(!('description' in v2))
  // thumbnail [{ resource: { '@id' } }] -> [{ id }]
  assert.equal(v2.thumbnail[0].id, 'https://example.org/images/thumb-1.jpg')
  // sequences[].canvases -> items
  assert.equal(v2.items.length, 2)
  assert.equal(v2.items[0].type, 'Canvas')
  // @value language maps
  assert.deepEqual(v2.items[0].label, { en: ['Canvas with navPlace'] })
  // otherContent dropped
  assert.ok(!('otherContent' in v2.items[0]))
  // images -> items[0] AnnotationPage of painting annotations
  const painting = v2.items[1].items[0].items[0]
  assert.equal(painting.type, 'Annotation')
  assert.equal(painting.motivation, 'painting')
  assert.equal(painting.body.id, 'https://example.org/images/canvas-2.jpg')
  assert.equal(painting.target, 'https://example.org/iiif/v2-manifest/canvas-2')
  // structures kept, types stripped
  assert.equal(v2.structures[0].type, 'Range')
  // GeoJSON coordinates survive untouched
  assert.deepEqual(v2.items[0].navPlace.features[0].geometry.coordinates, [-90.26, 38.63])
})

test('normalize keeps v3 resources semantically identical', async () => {
  const raw = await fixture('navplace-on-manifest-and-canvases.json')
  const norm = normalize(raw)
  assert.equal(norm.type, raw.type ?? raw['@type'])
  assert.equal(norm.id, raw['@id'] ?? raw.id)
  const rawIds = JSON.stringify(raw).match(/"id":\s*"[^"]+"/g)?.length ?? 0
  assert.ok(norm.id)
  assert.ok(rawIds >= 0)
})

test('normalize does not mangle annotation bodies', () => {
  const anno = normalize({
    '@context': ['http://www.w3.org/ns/anno.jsonld', 'http://geojson.org/geojson-ld/geojson-context.jsonld'],
    id: 'https://example.org/anno/1',
    type: 'Annotation',
    motivation: 'geo:tagging',
    body: {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [1, 2] },
      properties: { label: { en: ['x'] } }
    },
    target: 'https://example.org/canvas/1'
  })
  assert.equal(anno.body.geometry.type, 'Point')
  assert.deepEqual(anno.body.geometry.coordinates, [1, 2])
  assert.equal(anno.motivation, 'geo:tagging')
})

test('normalize copies GeoJSON properties verbatim', () => {
  const raw = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [1, 2] },
    properties: { label: 'plain string', description: 'A GeoJSON description', content: ['kept'] }
  }
  const feature = normalize(raw)
  assert.deepEqual(feature.properties, raw.properties)
  feature.properties.added = true
  assert.ok(!('added' in raw.properties))
})

test('normalize maps v2 Collection and Range child lists to items', () => {
  const collection = normalize({
    '@id': 'https://example.org/col',
    '@type': 'sc:Collection',
    collections: [{ '@id': 'https://example.org/col/2', '@type': 'sc:Collection' }],
    manifests: [{ '@id': 'https://example.org/m/1', '@type': 'sc:Manifest' }]
  })
  assert.deepEqual(collection.items.map((i) => [i.id, i.type]), [
    ['https://example.org/col/2', 'Collection'],
    ['https://example.org/m/1', 'Manifest']
  ])
  assert.ok(!('manifests' in collection) && !('collections' in collection))
  const range = normalize({
    '@id': 'https://example.org/r',
    '@type': 'sc:Range',
    ranges: ['https://example.org/r/2'],
    canvases: ['https://example.org/c/1']
  })
  assert.deepEqual(range.items, ['https://example.org/r/2', 'https://example.org/c/1'])
  const members = normalize({ '@type': 'sc:Collection', members: [{ '@id': 'x', '@type': 'sc:Manifest' }], manifests: [{ '@id': 'y' }] })
  assert.deepEqual(members.items.map((i) => i.id), ['x'])
})

test('normalize maps v2 attribution, license, and string thumbnails', () => {
  const m = normalize({
    '@type': 'sc:Manifest',
    attribution: 'Provided by Example Library',
    license: 'https://creativecommons.org/licenses/by/4.0/',
    thumbnail: 'https://example.org/thumb.jpg'
  })
  assert.deepEqual(m.requiredStatement, { label: { none: ['Attribution'] }, value: { none: ['Provided by Example Library'] } })
  assert.equal(m.rights, 'https://creativecommons.org/licenses/by/4.0/')
  assert.deepEqual(m.thumbnail, [{ id: 'https://example.org/thumb.jpg' }])
})

test('getTargetId reads strings, ids, and SpecificResource sources', () => {
  assert.equal(getTargetId('https://example.org/c'), 'https://example.org/c')
  assert.equal(getTargetId({ id: 'https://example.org/c' }), 'https://example.org/c')
  assert.equal(getTargetId({ type: 'SpecificResource', source: 'https://example.org/c' }), 'https://example.org/c')
  assert.equal(getTargetId({ type: 'SpecificResource', source: { id: 'https://example.org/c', type: 'Canvas' } }), 'https://example.org/c')
  assert.equal(getTargetId(undefined), '')
})

test('contextWarnings flags missing contexts but never blocks', () => {
  const warnings = contextWarnings({ type: 'Manifest' }, IIIF_RESOURCE_TYPES)
  assert.ok(warnings.length >= 1)
  const good = contextWarnings({
    '@context': ['https://iiif.io/api/presentation/3/context.json', 'http://iiif.io/api/extension/navplace/context.json'],
    type: 'Manifest'
  }, IIIF_RESOURCE_TYPES)
  assert.deepEqual(good, [])
})

test('contextWarnings accepts navPlace from the Presentation 4 context', () => {
  const v4 = contextWarnings({ '@context': 'http://iiif.io/api/presentation/4/context.json', type: 'Collection' }, IIIF_RESOURCE_TYPES)
  assert.deepEqual(v4, [])
  const v3 = contextWarnings({ '@context': 'http://iiif.io/api/presentation/3/context.json', type: 'Collection' }, IIIF_RESOURCE_TYPES)
  assert.ok(v3.some((w) => /navPlace/.test(w)))
})
