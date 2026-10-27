import test from 'node:test'
import assert from 'node:assert/strict'
import { getBbox, calculateZoom, bboxCenter, featureKey } from '../js/geo.js'

test('getBbox wraps points, lines, and polygons', () => {
  assert.deepEqual(getBbox({ type: 'Point', coordinates: [10, 20] }), [10, 20, 10, 20])
  const line = getBbox({ type: 'LineString', coordinates: [[0, 0], [10, 5]] })
  assert.deepEqual(line, [0, 0, 10, 5])
  const poly = getBbox({ type: 'Polygon', coordinates: [[[-1, -1], [2, -1], [2, 3], [-1, 3], [-1, -1]]] })
  assert.deepEqual(poly, [-1, -1, 2, 3])
})

test('getBbox handles Features, FeatureCollections, and GeometryCollections', () => {
  const feature = getBbox({ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] } })
  assert.deepEqual(feature, [1, 2, 1, 2])
  const fc = getBbox({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [10, 10] } }
    ]
  })
  assert.deepEqual(fc, [0, 0, 10, 10])
  const gc = getBbox({
    type: 'GeometryCollection',
    geometries: [
      { type: 'Point', coordinates: [-5, -5] },
      { type: 'Point', coordinates: [5, 5] }
    ]
  })
  assert.deepEqual(gc, [-5, -5, 5, 5])
  assert.equal(getBbox({ type: 'Feature', geometry: { type: 'Point', coordinates: [] } }), undefined)
  assert.equal(getBbox(null), undefined)
})

test('calculateZoom: single point is street level, no division by zero', () => {
  assert.equal(calculateZoom([1, 2, 1, 2]), 8)
  // axis-aligned lines used to divide by zero / swap branches
  assert.ok(Number.isFinite(calculateZoom([0, 0, 10, 0])))
  assert.ok(Number.isFinite(calculateZoom([0, 0, 0, 10])))
  assert.ok(calculateZoom([0, 0, 360, 180]) <= calculateZoom([0, 0, 1, 1]))
})

test('bboxCenter returns [lat, lng]', () => {
  assert.deepEqual(bboxCenter([0, 0, 10, 20]), [10, 5])
})

test('featureKey prefers the feature id', () => {
  assert.equal(featureKey({ id: 'https://example.org/geo/1' }, 0), 'https://example.org/geo/1')
  assert.equal(featureKey({ '@id': 'a' }, 0), 'a')
  assert.equal(featureKey({}, 3), 'feature[3]')
})
