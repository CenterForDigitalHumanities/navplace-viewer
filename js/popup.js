/*
 * Popup content as pure functions: feature properties in, escaped HTML out.
 * The map component binds the result; forks can override VIEWER.formatPopup
 * (documented in the README) and return their own HTML string.
 */

import { escapeHtml, toLanguageMap } from './utils.js'

/** Only http(s) URLs are embedded; anything else renders as text. */
export function safeUrl(value) {
  const url = String(value ?? '')
  return /^https?:\/\//i.test(url) ? url : ''
}

function languageMapLines(value) {
  const map = toLanguageMap(value)
  if (!map) return ''
  let html = ''
  for (const [lang, entries] of Object.entries(map)) {
    // Only text is shown; a malformed entry is skipped, never printed as [object Object].
    const text = [].concat(entries ?? []).filter((e) => typeof e === 'string' || typeof e === 'number').join(' -- ')
    if (text) html += `<b>${escapeHtml(lang)}: ${escapeHtml(text)}</b><br>`
  }
  return html
}

function readerLinks(uri) {
  const url = safeUrl(uri)
  if (!url) return ''
  const encoded = escapeHtml(url)
  return (
    `<a href="https://projectmirador.org/embed/?iiif-content=${encoded}" target="_blank" rel="noopener">` +
    `<img src="https://www.qdl.qa/sites/all/themes/QDLTheme/css/img/logo_mirador.png" alt="Open in Mirador"/></a>` +
    `<a href="https://uv-v3.netlify.app/#?c=&m=&s=&cv=&manifest=${encoded}" target="_blank" rel="noopener">` +
    `<img src="https://www.qdl.qa/sites/all/themes/QDLTheme/css/img/logo_uv.png" alt="Open in Universal Viewer"/></a>`
  )
}

/**
 * Build the popup HTML for one discovered feature.
 * @param {Object} feature GeoJSON Feature with viewer properties
 * @returns {String} escaped HTML
 */
export function buildPopup(feature) {
  const p = feature?.properties
  if (!p) return ''
  let html = ''
  if (p.label) html += `<div class="featureInfo">${languageMapLines(p.label)}</div>`
  if (p.summary) html += `<div class="featureInfo">${languageMapLines(p.summary)}</div>`
  if (Array.isArray(p.metadata)) {
    for (const entry of p.metadata) {
      if (!entry || typeof entry !== 'object') continue
      const lines = languageMapLines(entry.label) + languageMapLines(entry.value)
      if (lines) html += `<div class="featureInfo">${lines}</div>`
    }
  }
  if (p.navDate) {
    const date = new Date(p.navDate)
    const shown = Number.isNaN(date.getTime()) ? String(p.navDate) : date.toISOString()
    html += `<div class="featureInfo">${escapeHtml(shown)}</div>`
  }
  // One thumbnail object or an array of them.
  const firstThumb = [].concat(p.thumbnail ?? [])[0]
  if (firstThumb) {
    const thumb = safeUrl(firstThumb.id ?? firstThumb['@id'])
    if (thumb) html += `<img src="${escapeHtml(thumb)}" alt="" />`
  }
  if (p.rights) {
    // rights is a URI string; show it as is, like the legacy popup.
    const rights = typeof p.rights === 'string' ? escapeHtml(p.rights) : languageMapLines(p.rights)
    if (rights) html += `<div class="featureInfo">${rights}</div>`
  }
  if (p.requiredStatement) {
    const rs = p.requiredStatement
    // A IIIF requiredStatement is { label, value }; anything else is read as a bare language map.
    const stmt = (rs.label !== undefined || rs.value !== undefined)
      ? languageMapLines(rs.label) + languageMapLines(rs.value)
      : languageMapLines(rs)
    if (stmt) html += `<div class="featureInfo">${stmt}</div>`
  }
  if (p.manifest) html += readerLinks(p.manifest)
  else if (p.canvas) html += readerLinks(p.canvas)
  else if (p.anno) {
    const anno = safeUrl(p.anno)
    const target = safeUrl(String(p.targeting ?? '').split('#')[0])
    html += `<div class="featureInfo">`
    if (anno) html += `<a target="_blank" rel="noopener" href="${escapeHtml(anno)}">Web Annotation</a><br>`
    if (target) html += `<a target="_blank" rel="noopener" href="${escapeHtml(target)}">Targeted Resource</a>`
    html += `</div>`
  }
  if (p.notification) {
    const n = p.notification
    const by = n.creator ? ` via ${escapeHtml(String(n.creator))}` : ''
    const when = n.created ? ` on ${escapeHtml(String(n.created))}` : ''
    html += `<div class="featureInfo ldnAttribution">LDN notification${by}${when}`
    if (n.id && safeUrl(n.id)) html += ` &mdash; <a target="_blank" rel="noopener" href="${escapeHtml(safeUrl(n.id))}">source</a>`
    html += `</div>`
  }
  return html
}
