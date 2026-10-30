/*
 * Small shared helpers.  Pure functions, no DOM.
 */

/**
 * Escape a value for safe interpolation into HTML.  Remote Linked Data is
 * untrusted; every string that reaches a popup or notice passes through here.
 * @param {*} value
 * @returns {String}
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * A language map ({ en: [...] }) or a bare string/array of strings, always
 * rendered as a language map.  IIIF v2 labels are plain strings; v3+ uses
 * language maps.
 * @param {String|Array|Object} value
 * @returns {Object|undefined} language map
 */
export function toLanguageMap(value) {
  if (value == null) return undefined
  if (typeof value === 'string') return { none: [value] }
  if (Array.isArray(value)) {
    // v2 description arrays: [{ '@value': 'x', '@language': 'en' }]
    if (value.every((v) => typeof v === 'string')) return { none: [...value] }
    const map = {}
    for (const entry of value) {
      const text = entry?.['@value'] ?? entry?.value
      const lang = entry?.['@language'] ?? entry?.language ?? 'none'
      if (text == null) continue
      map[lang] = (map[lang] ?? []).concat([text])
    }
    return Object.keys(map).length ? map : undefined
  }
  if (typeof value === 'object') {
    // Already a language map, or a lone { '@value' } object
    if (value['@value'] != null) return { [value['@language'] ?? 'none']: [value['@value']] }
    return value
  }
  return undefined
}
