/*
 * navPlace Viewer application entry point.
 *
 * Orchestrates the pure modules (query, iiif, features, ldn, popup) and the
 * custom elements (<nav-page>, <map-view>, <viewer-options>).  A light
 * `window.VIEWER` facade is kept for backward compatibility with forks that
 * override VIEWER.formatPopup / VIEWER.colorFor (see README).
 *
 * Zero build step: plain ES modules served as-is by GitHub Pages.
 */

import './js/components/nav-page.js'
import './js/components/map-view.js'
import './js/components/viewer-options.js'
import { parseQuery, buildUrl, safeDecode } from './js/query.js'
import { normalize, detectVersion, contextWarnings, IIIF_RESOURCE_TYPES, ANNOTATION_TYPES, getType } from './js/iiif.js'
import { discoverFeatures, displayedIds, ResourceResolver } from './js/features.js'
import { collectNotifications, notificationFeatures } from './js/ldn.js'
import { buildPopup } from './js/popup.js'
import { defaultColorFor } from './js/components/map-view.js'

const isAnnotationViewer = () => window.location.pathname.includes('annotation-viewer')

const VIEWER = {
  version: '1.0.0',
  resource: null,
  features: [],
  warnings: [],

  get supportedTypes() {
    return isAnnotationViewer() ? ANNOTATION_TYPES : IIIF_RESOURCE_TYPES
  },

  get mapElement() {
    return document.querySelector('map-view')
  },

  /** The raw Leaflet map, for forks that poke at it (legacy parity). */
  get mymap() {
    return this.mapElement?._map ?? null
  },

  get formatPopup() {
    return this.mapElement?.formatPopup ?? buildPopup
  },
  set formatPopup(fn) {
    if (this.mapElement) this.mapElement.formatPopup = fn
  },

  get colorFor() {
    return this.mapElement?.colorFor ?? defaultColorFor
  },
  set colorFor(fn) {
    if (this.mapElement) this.mapElement.colorFor = fn
  },

  /**
   * Load and render a resource.  Updates the URL without a page reload so
   * the address bar is always shareable.
   * @param {String} contentUrl URI of the resource to display
   * @param {Object} [options] {dig, resolve, ldn, layer, focus, pushUrl}
   */
  async run(contentUrl, options = {}) {
    const opts = { dig: true, resolve: true, ldn: !isAnnotationViewer(), pushUrl: true, ...options }
    const url = safeDecode(contentUrl ?? '')
    if (!url) {
      showNotice('No resource URI provided.', 'warning')
      return
    }
    const body = document.getElementById('viewerBody')
    const needs = document.getElementById('needs')
    const loading = document.getElementById('loadingMessage')
    clearNotices()
    if (needs) needs.classList.add('is-hidden')
    if (body) body.classList.remove('is-hidden')
    if (loading) loading.classList.remove('is-hidden')

    let raw = null
    try {
      const resp = await fetch(url, { cache: 'default' })
      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`)
      raw = await resp.json()
    } catch (err) {
      if (loading) loading.classList.add('is-hidden')
      showNotice(`Unable to resolve ${url}: ${err.message}`, 'error')
      if (needs) needs.classList.remove('is-hidden')
      return
    }

    const resource = normalize(raw)
    const type = getType(resource)
    this.resource = resource
    this.warnings = []

    if (!this.supportedTypes.includes(type)) {
      if (loading) loading.classList.add('is-hidden')
      showWrongViewerNotice(type, url)
      return
    }
    for (const warning of contextWarnings(resource, this.supportedTypes)) showNotice(warning, 'warning')
    const version = detectVersion(resource)
    if (version === 2 || version === 4) {
      showNotice(`IIIF Presentation API v${version} resource detected; normalized for display.`, 'info')
    }

    const resolver = new ResourceResolver({ fetchLimit: 1000 })
    const { features, warnings } = await discoverFeatures(resource, {
      supportedTypes: this.supportedTypes,
      dig: opts.dig,
      resolve: opts.resolve,
      resolver
    })
    for (const warning of warnings) showNotice(warning, 'warning')

    let allFeatures = features
    if (opts.ldn && !isAnnotationViewer()) {
      try {
        const { notifications, warnings: ldnWarnings } = await collectNotifications(resource, {
          displayed: displayedIds(resource, features),
          resolver
        })
        for (const warning of ldnWarnings) showNotice(warning, 'info')
        if (notifications.length) {
          const ldnFeatures = await notificationFeatures(notifications)
          allFeatures = allFeatures.concat(ldnFeatures)
          showNotice(`${notifications.length} LDN notification(s) included from resource inboxes.`, 'info')
        }
      } catch (err) {
        // LDN is additive; never break the map over a bad inbox.
        console.warn('LDN consumption failed', err)
      }
    }

    this.features = allFeatures
    const map = this.mapElement
    if (map) {
      if (opts.layer) map.setAttribute('layer', opts.layer)
      map.features = allFeatures
      if (opts.focus) map.setAttribute('focus', opts.focus)
    }
    if (loading) loading.classList.add('is-hidden')
    if (!allFeatures.length) showNotice('No navPlace geography found in this resource.', 'info')

    if (opts.pushUrl) {
      const params = parseQuery(window.location.search)
      const target = buildUrl(window.location.pathname, {
        'iiif-content': url,
        dig: opts.dig ? null : 'false',
        resolve: opts.resolve ? null : 'false',
        ldn: opts.ldn ? null : 'false',
        layer: opts.layer ?? params.layer,
        focus: opts.focus ?? params.focus
      })
      window.history.pushState({ content: url }, '', target)
    }
    document.dispatchEvent(new CustomEvent('viewer-ready', { detail: { resource: this.resource, features: allFeatures } }))
  },

  /** Render whatever the current URL points at. */
  async start() {
    const params = parseQuery(window.location.search)
    const needs = document.getElementById('needs')
    if (!params.content) {
      if (needs) needs.classList.remove('is-hidden')
      return
    }
    const options = needs?.querySelector('viewer-options')
    if (options) options.collapse(true)
    await this.run(params.content, {
      dig: params.dig,
      resolve: params.resolve,
      ldn: params.ldn && !isAnnotationViewer(),
      layer: params.layer,
      focus: params.focus,
      pushUrl: false
    })
  }
}

window.VIEWER = VIEWER

/* ---------- inline notices (replace every alert/confirm) ---------- */

function clearNotices() {
  const box = document.getElementById('notices')
  if (box) box.innerHTML = ''
}

export function showNotice(message, level = 'info', link = null) {
  const box = document.getElementById('notices')
  if (!box) return
  const div = document.createElement('div')
  div.className = `notice is-${level}`
  div.textContent = message
  if (link) {
    const a = document.createElement('a')
    a.href = link.href
    a.target = link.target ?? '_self'
    a.rel = 'noopener'
    a.textContent = link.label
    div.appendChild(document.createTextNode(' '))
    div.appendChild(a)
  }
  const close = document.createElement('button')
  close.className = 'notice-close'
  close.setAttribute('aria-label', 'Dismiss')
  close.textContent = '\u00d7'
  close.addEventListener('click', () => div.remove())
  div.appendChild(close)
  box.appendChild(div)
}

/**
 * The resource belongs to the other page.  Offer a link; never auto-navigate.
 */
function showWrongViewerNotice(type, url) {
  const needs = document.getElementById('needs')
  if (needs) needs.classList.remove('is-hidden')
  if (isAnnotationViewer() && IIIF_RESOURCE_TYPES.includes(type)) {
    showNotice(
      `This viewer is for W3C Web Annotation 'Annotation' and 'AnnotationPage' objects, but the resource is a ${type}.`,
      'warning',
      { href: `./?${new URLSearchParams({ 'iiif-content': url }).toString()}`, label: 'Open it in the navPlace Viewer instead' }
    )
    return
  }
  if (!isAnnotationViewer() && ANNOTATION_TYPES.includes(type)) {
    showNotice(
      `This viewer is for IIIF Presentation API types, but the resource is a ${type}.`,
      'warning',
      { href: `./annotation-viewer.html?${new URLSearchParams({ data: url }).toString()}`, label: 'Open it in the Annotation Viewer instead' }
    )
    return
  }
  showNotice(`The data resource type '${type || 'Unknown'}' is not supported here.`, 'error')
}

/* ---------- wiring ---------- */

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('nav-load', (e) => {
    VIEWER.run(e.detail.uri, e.detail)
  })
  document.addEventListener('nav-reset', () => {
    window.location = window.location.origin + window.location.pathname
  })
  document.addEventListener('nav-notice', (e) => {
    showNotice(e.detail.message, e.detail.level ?? 'info')
  })
  window.addEventListener('popstate', () => {
    VIEWER.start()
  })
  VIEWER.start()
})

// Help with initial orientation on page loads (legacy parity).
window.addEventListener('beforeunload', () => window.scrollTo(0, 0))
