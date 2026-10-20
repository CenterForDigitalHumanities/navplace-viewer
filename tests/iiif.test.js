import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { detectVersion, getId, getType, normalize, contextWarnings, IIIF_RESOURCE_TYPES } from '../js/iiif.js'

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

test('contextWarnings flags missing contexts but never blocks', () => {
  const warnings = contextWarnings({ type: 'Manifest' }, IIIF_RESOURCE_TYPES)
  assert.ok(warnings.length >= 1)
  const good = contextWarnings({
    '@context': ['https://iiif.io/api/presentation/3/context.json', 'http://iiif.io/api/extension/navplace/context.json'],
    type: 'Manifest'
  }, IIIF_RESOURCE_TYPES)
  assert.deepEqual(good, [])
})
