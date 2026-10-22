import test from 'node:test'
import assert from 'node:assert/strict'
import { parseQueryString, buildUrl, safeDecode } from '../js/query.js'

test('reads the iiif-content parameter', () => {
  const q = parseQueryString('?iiif-content=https://example.org/manifest.json')
  assert.equal(q.content, 'https://example.org/manifest.json')
})

test('data and manifest are aliases for iiif-content', () => {
  assert.equal(parseQueryString('?data=https://example.org/a.json').content, 'https://example.org/a.json')
  assert.equal(parseQueryString('?manifest=https://example.org/b.json').content, 'https://example.org/b.json')
  // iiif-content wins when several are present
  const both = parseQueryString('?data=https://example.org/a.json&iiif-content=https://example.org/b.json')
  assert.equal(both.content, 'https://example.org/b.json')
})

test('percent-encoded URIs with embedded = and ? decode correctly (issue #54)', () => {
  const original = 'https://example.org/manifest.json?token=abc=123&x=1'
  const encoded = encodeURIComponent(original)
  const q = parseQueryString(`?iiif-content=${encoded}`)
  assert.equal(q.content, original)
})

test('dig/resolve/ldn default to true and only "false" turns them off', () => {
  const dflt = parseQueryString('')
  assert.equal(dflt.dig, true)
  assert.equal(dflt.resolve, true)
  assert.equal(dflt.ldn, true)
  const off = parseQueryString('?dig=false&resolve=false&ldn=false')
  assert.equal(off.dig, false)
  assert.equal(off.resolve, false)
  assert.equal(off.ldn, false)
})

test('layer and focus pass through', () => {
  const q = parseQueryString('?layer=Esri%20World%20Imagery&focus=https://example.org/geo/1')
  assert.equal(q.layer, 'Esri World Imagery')
  assert.equal(q.focus, 'https://example.org/geo/1')
})

test('safeDecode leaves malformed sequences alone', () => {
  assert.equal(safeDecode('100%sure'), '100%sure')
  assert.equal(safeDecode(null), null)
})

test('buildUrl omits null, empty, and false params', () => {
  const url = buildUrl('/index.html', {
    'iiif-content': 'https://example.org/m.json',
    dig: null,
    resolve: 'false',
    ldn: false,
    layer: '',
    focus: 'k1'
  })
  assert.match(url, /iiif-content=https/)
  assert.match(url, /resolve=false/)
  assert.match(url, /focus=k1/)
  assert.doesNotMatch(url, /ldn/)
  assert.doesNotMatch(url, /layer=/)
  assert.doesNotMatch(url, /dig=/)
})
