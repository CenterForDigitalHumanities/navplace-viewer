import test from 'node:test'
import assert from 'node:assert/strict'
import { parseQueryString, buildUrl, safeDecode, encodeValue } from '../js/query.js'

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

test('values are decoded exactly once', () => {
  // Oh My RERUM sends a literal %2F in a URI as %252F.
  assert.equal(
    parseQueryString('?iiif-content=https://devstore.rerum.io/v1/id%252F6adf8b79701cb863609dff2d').content,
    'https://devstore.rerum.io/v1/id%2F6adf8b79701cb863609dff2d'
  )
  assert.equal(parseQueryString('?iiif-content=https://example.org/100%25/m.json').content, 'https://example.org/100%/m.json')
})

test('unencoded values pass through, including + and a stray %', () => {
  assert.equal(parseQueryString('?iiif-content=https://example.org/a+b/m.json').content, 'https://example.org/a+b/m.json')
  assert.equal(parseQueryString('?iiif-content=https://example.org/100%/m.json').content, 'https://example.org/100%/m.json')
  assert.equal(parseQueryString('?iiif-content=https://example.org/m.json?a=b').content, 'https://example.org/m.json?a=b')
})

test('dig/resolve default to true and only "false" turns them off', () => {
  const dflt = parseQueryString('')
  assert.equal(dflt.dig, true)
  assert.equal(dflt.resolve, true)
  const off = parseQueryString('?dig=false&resolve=false')
  assert.equal(off.dig, false)
  assert.equal(off.resolve, false)
})

test('ldn defaults to false and only ldn=true turns it on', () => {
  assert.equal(parseQueryString('').ldn, false)
  assert.equal(parseQueryString('?ldn=false').ldn, false)
  assert.equal(parseQueryString('?ldn=true').ldn, true)
  // Opt-in needs an affirmative value: a bare flag or any other value stays off.
  assert.equal(parseQueryString('?ldn').ldn, false)
  assert.equal(parseQueryString('?ldn=0').ldn, false)
  assert.equal(parseQueryString('?ldn=yes').ldn, false)
})

test('layer and focus pass through', () => {
  const q = parseQueryString('?layer=Esri%20World%20Imagery&focus=https://example.org/geo/1')
  assert.equal(q.layer, 'Esri World Imagery')
  assert.equal(q.focus, 'https://example.org/geo/1')
})

test('safeDecode leaves malformed sequences alone', () => {
  assert.equal(safeDecode('100%sure'), '100%sure')
  assert.equal(safeDecode('100%sure%2Fthing'), '100%sure/thing')
  assert.equal(safeDecode(null), null)
})

test('buildUrl keeps the content URI readable and round-trips it', () => {
  for (const uri of [
    'https://example.org/m.json',
    'https://example.org/a%2Fb/m.json',
    'https://example.org/m.json?x=1&y=2#frag',
    'https://example.org/a+b',
    'https://example.org/café'
  ]) {
    const url = buildUrl('/index.html', { 'iiif-content': uri })
    assert.equal(parseQueryString(new URL(url).search).content, uri)
  }
  assert.match(buildUrl('/index.html', { 'iiif-content': 'https://example.org/m.json' }), /iiif-content=https:\/\/example\.org\/m\.json$/)
  assert.equal(encodeValue('a&b=c+d#e'), 'a%26b%3Dc%2Bd%23e')
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
