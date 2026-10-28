import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPopup, safeUrl } from '../js/popup.js'

const feature = (properties, geometry) => ({
  type: 'Feature',
  id: 'http://example.com/feature/1',
  geometry: geometry ?? { type: 'Point', coordinates: [-90.26, 38.63] },
  properties
})

test('escapes HTML in labels and metadata', () => {
  const html = buildPopup(feature({
    label: { en: ['<script>alert(1)</script>'] },
    summary: { none: ['<img src=x onerror=alert(2)>'] },
    metadata: [{ label: { en: ['who'] }, value: { en: ['<b>bad</b>'] } }]
  }))
  assert.ok(!html.includes('<script>'))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(html.includes('&lt;b&gt;bad&lt;/b&gt;'))
})

test('renders label and summary, but not the geometry', () => {
  const html = buildPopup(feature({ label: { en: ['St. Louis'] }, summary: { none: ['A city'] } }))
  assert.ok(html.includes('St. Louis'))
  assert.ok(html.includes('A city'))
  assert.ok(!html.includes('-90.26'))
  assert.ok(!html.includes('Point'))
})

test('plain-string language maps work', () => {
  const html = buildPopup(feature({ label: 'Plain String Label' }))
  assert.ok(html.includes('Plain String Label'))
})

test('rights renders as the plain URI, escaped', () => {
  const html = buildPopup(feature({ rights: 'https://creativecommons.org/publicdomain/mark/1.0/' }))
  assert.ok(html.includes('<div class="featureInfo">https://creativecommons.org/publicdomain/mark/1.0/</div>'))
  assert.ok(!html.includes('none:'))
  assert.ok(buildPopup(feature({ rights: '<b>x</b>' })).includes('&lt;b&gt;x&lt;/b&gt;'))
})

test('requiredStatement never renders [object Object]', () => {
  const noLabel = buildPopup(feature({ requiredStatement: { value: { en: ['The Library'] } } }))
  assert.ok(noLabel.includes('en: The Library'))
  assert.ok(!noLabel.includes('[object Object]'))
  const objectEntries = buildPopup(feature({
    requiredStatement: { label: { en: [{ value: 'nested' }] }, value: { en: ['Shown'] } }
  }))
  assert.ok(objectEntries.includes('en: Shown'))
  assert.ok(!objectEntries.includes('[object Object]'))
  const full = buildPopup(feature({ requiredStatement: { label: { en: ['Attribution'] }, value: { en: ['The Library'] } } }))
  assert.ok(full.includes('en: Attribution') && full.includes('en: The Library'))
})

test('safeUrl rejects javascript: and accepts http(s)', () => {
  assert.equal(safeUrl('javascript:alert(1)'), '')
  assert.equal(safeUrl('https://example.org/x'), 'https://example.org/x')
  assert.equal(safeUrl('data:text/html,<script>'), '')
})

test('thumbnails and reader links render only for safe urls', () => {
  const html = buildPopup(feature({
    thumbnail: [{ id: 'https://example.org/t.jpg' }],
    manifest: 'https://example.org/manifest.json',
    canvas: 'javascript:alert(1)'
  }))
  assert.ok(html.includes('https://example.org/t.jpg'))
  assert.ok(html.includes('projectmirador.org'))
  assert.ok(!html.includes('javascript:'))
})

test('LDN notifications get an attribution block', () => {
  const html = buildPopup(feature({
    __fromResource: 'Notification',
    notification: {
      id: 'https://example.org/n/1',
      creator: 'https://orcid.org/0000-0002-1825-0097',
      created: '2026-01-02T00:00:00Z',
      target: 'https://example.org/canvas/1'
    }
  }))
  assert.ok(html.includes('ldnAttribution'))
  assert.ok(html.includes('orcid.org/0000-0002-1825-0097'))
  assert.ok(html.includes('https://example.org/n/1'))
})

test('missing properties do not throw', () => {
  assert.equal(typeof buildPopup({ type: 'Feature', geometry: null, properties: undefined }), 'string')
})
