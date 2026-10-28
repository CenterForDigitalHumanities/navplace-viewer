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
import { parseQuery, buildUrl } from './js/query.js'
import { normalize, detectVersion, contextWarnings, IIIF_RESOURCE_TYPES, ANNOTATION_TYPES, getType } from './js/iiif.js'
import { discoverFeatures, displayedIds, ResourceResolver } from './js/features.js'
import { collectNotifications, notificationFeatures, LDN_TIMEOUT_MS } from './js/ldn.js'
import { buildPopup } from './js/popup.js'
import { defaultColorFor } from './js/components/map-view.js'

const isAnnotationViewer = () => window.location.pathname.includes('annotation-viewer')

const VIEWER = {
  resource: null,
  features: [],
  // Counts run() calls so a slower, older load cannot overwrite a newer one.
  _runId: 0,

  get supportedTypes() {
    return isAnnotationViewer() ? ANNOTATION_TYPES : IIIF_RESOURCE_TYPES
  },

  get mapElement() {
    return document.querySelector('map-view')
  },

  get optionsElement() {
    return document.querySelector('viewer-options')
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
    // LDN is opt-in: inboxes are read only when the visitor asks for them.
    const opts = { dig: true, resolve: true, ldn: false, pushUrl: true, ...options }
    // Already decoded once by parseQuery (or typed by hand); never decode again.
    const url = contentUrl ?? ''
    if (!url) {
      showNotice('No resource URI provided.', 'warning')
      return
    }
    // A newer run (Apply Options again, or Back) supersedes this one.
    const runId = ++this._runId
    const stale = () => runId !== this._runId
    const body = document.getElementById('viewerBody')
    const loading = document.getElementById('loadingMessage')
    const state = { content: url, dig: opts.dig, resolve: opts.resolve, ldn: opts.ldn }
    const controls = this.optionsElement
    clearNotices()
    controls?.sync(state)
    if (body) body.classList.remove('is-hidden')
    if (loading) loading.classList.remove('is-hidden')

    // A failed load shows an empty world map (legacy parity) and offers the
    // URI input again.
    const failLoad = () => {
      this.features = []
      if (this.mapElement) this.mapElement.features = []
      if (loading) loading.classList.add('is-hidden')
      controls?.sync({ ...state, failed: true })
    }

    let raw = null
    try {
      const resp = await fetch(url, { cache: 'default' })
      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`)
      raw = await resp.json()
    } catch (err) {
      if (stale()) return
      failLoad()
      showNotice(`Unable to resolve ${url}: ${err.message}`, 'error')
      return
    }
    if (stale()) return

    const resource = normalize(raw)
    const type = getType(resource)
    this.resource = resource

    if (!this.supportedTypes.includes(type)) {
      failLoad()
      showWrongViewerNotice(type, url)
      return
    }
    for (const warning of contextWarnings(resource, this.supportedTypes)) showNotice(warning, 'warning')
    const version = detectVersion(resource)
    if (version === 2 || version === 4) {
      showNotice(`IIIF Presentation API v${version} resource detected; normalized for display.`, 'info')
    }

    const resolver = new ResourceResolver({ fetchLimit: 1000 })
    let discovered
    try {
      discovered = await discoverFeatures(resource, {
        supportedTypes: this.supportedTypes,
        dig: opts.dig,
        resolve: opts.resolve,
        resolver
      })
    } catch (err) {
      // Malformed data must not leave the loading message up forever.
      if (stale()) return
      failLoad()
      showNotice(`Unable to read the geography in ${url}: ${err.message}`, 'error')
      return
    }
    if (stale()) return
    const { features, warnings } = discovered
    for (const warning of warnings) showNotice(warning, 'warning')

    let allFeatures = features
    if (opts.ldn && !isAnnotationViewer()) {
      try {
        // One deadline covers every LDN request, so the map waits LDN_TIMEOUT_MS at most.
        const signal = AbortSignal.timeout(LDN_TIMEOUT_MS)
        // Referenced Manifests and Canvases fetched during discovery are on screen too,
        // so their inboxes are read and their ids count as displayed.
        const resolved = [...new Set(resolver.cache.values())].filter((r) => r && typeof r === 'object')
        const { notifications, warnings: ldnWarnings } = await collectNotifications(resource, {
          displayed: displayedIds(resource, features, resolved),
          resolved,
          signal
        })
        if (stale()) return
        // A Set, so a timeout seen while reading inboxes and bodies is reported once.
        const ldnNotices = new Set(ldnWarnings)
        if (notifications.length) {
          const { features: ldnFeatures, warnings: bodyWarnings } = await notificationFeatures(notifications, { signal })
          if (stale()) return
          for (const warning of bodyWarnings) ldnNotices.add(warning)
          allFeatures = allFeatures.concat(ldnFeatures)
          showNotice(`${notifications.length} LDN notification(s) included from resource inboxes.`, 'info')
        }
        for (const warning of ldnNotices) showNotice(warning, 'warning')
      } catch (err) {
        // LDN is additive; never break the map over a bad inbox.
        console.warn('LDN consumption failed', err)
      }
    }

    this.features = allFeatures
    const params = parseQuery(window.location.search)
    // A focus key names a feature of one resource, so only re-applying options keeps it.
    const focus = opts.focus ?? (params.content === url ? params.focus : null)
    const map = this.mapElement
    // A view without ?layer= uses the default basemap, so Back restores it too.
    const layer = opts.layer ?? params.layer
    if (map) {
      if (layer) map.setAttribute('layer', layer)
      else map.removeAttribute('layer')
      // render() reads the focus attribute, so a stale one is cleared first.
      map.removeAttribute('focus')
      try {
        map.features = allFeatures
        if (focus) map.setAttribute('focus', focus)
      } catch (err) {
        // Leaflet rejects the whole set over one malformed geometry.
        console.warn('Map rendering failed', err)
        showNotice(`The geography could not be drawn on the map: ${err.message}`, 'warning')
      }
    }
    if (loading) loading.classList.add('is-hidden')
    if (!allFeatures.length) showNotice('No navPlace geography found in this resource.', 'info')

    if (opts.pushUrl) {
      const target = buildUrl(window.location.pathname, {
        'iiif-content': url,
        dig: opts.dig ? null : 'false',
        resolve: opts.resolve ? null : 'false',
        // The annotation viewer has no LDN option to record.
        ldn: (opts.ldn && !isAnnotationViewer()) ? 'true' : null,
        layer,
        focus
      })
      // Applying unchanged options would otherwise add an identical history entry.
      if (target === window.location.href) window.history.replaceState({ content: url }, '', target)
      else window.history.pushState({ content: url }, '', target)
    }
    document.dispatchEvent(new CustomEvent('viewer-ready', { detail: { resource: this.resource, features: allFeatures } }))
  },

  /** Render whatever the current URL points at. */
  async start() {
    const params = parseQuery(window.location.search)
    if (!params.content) {
      // Back to the empty page: drop what is on screen and any load in flight.
      this._runId += 1
      this.resource = null
      this.features = []
      if (this.mapElement) this.mapElement.features = []
      document.getElementById('viewerBody')?.classList.add('is-hidden')
      clearNotices()
      this.optionsElement?.sync({ content: null, dig: params.dig, resolve: params.resolve, ldn: params.ldn })
      return
    }
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

function showNotice(message, level = 'info', link = null) {
  const box = document.getElementById('notices')
  if (!box) return
  const div = document.createElement('div')
  div.className = `notice is-${level}`
  // #notices is a polite live region; errors interrupt.
  if (level === 'error') div.setAttribute('role', 'alert')
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
  if (isAnnotationViewer() && IIIF_RESOURCE_TYPES.includes(type)) {
    showNotice(
      `This viewer is for W3C Web Annotation 'Annotation' and 'AnnotationPage' objects, but the resource type is '${type}'.`,
      'warning',
      { href: buildUrl('./', { 'iiif-content': url }), label: 'Open it in the navPlace Viewer instead' }
    )
    return
  }
  if (!isAnnotationViewer() && ANNOTATION_TYPES.includes(type)) {
    showNotice(
      `This viewer is for IIIF Presentation API types, but the resource type is '${type}'.`,
      'warning',
      { href: buildUrl('./annotation-viewer.html', { data: url }), label: 'Open it in the Annotation Viewer instead' }
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
  // A basemap picked on the map stays in the shareable URL (no new history entry).
  document.addEventListener('nav-layer', (e) => {
    window.history.replaceState(window.history.state, '', buildUrl(window.location.href, { layer: e.detail.layer }))
  })
  window.addEventListener('popstate', () => {
    VIEWER.start()
  })
  VIEWER.start()
})

// Help with initial orientation on page loads (legacy parity).
window.addEventListener('beforeunload', () => window.scrollTo(0, 0))
