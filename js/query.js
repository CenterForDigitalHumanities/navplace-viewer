/*
 * Query string handling.
 *
 * Reads the query string with URLSearchParams and percent-decodes values so
 * encoded IIIF content URIs (including ones containing '=') load correctly
 * (issue #54).  Supported parameters:
 *
 *   iiif-content  resource URI (IIIF Content State / oh-my-rerum name)
 *   data          alias for iiif-content (annotation viewer history)
 *   manifest      alias for iiif-content
 *   dig           false = only look for navPlace on the top level + children
 *   resolve       false = do not fetch referenced values
 *   ldn           false = do not read LDN inboxes (main viewer only)
 *   layer         basemap name, e.g. "OpenStreetMap"
 *   focus         feature key whose popup opens on load
 */

export function safeDecode(s) {
  if (s == null) return s
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

export function parseQueryString(search) {
  const params = new URLSearchParams(search)
  const get = (name) => {
    const v = params.get(name)
    return v === null ? null : safeDecode(v)
  }
  const flag = (name, dflt) => {
    const v = get(name)
    if (v == null) return dflt
    return v !== 'false'
  }
  return {
    content: get('iiif-content') ?? get('data') ?? get('manifest'),
    dig: flag('dig', true),
    resolve: flag('resolve', true),
    ldn: flag('ldn', true),
    layer: get('layer'),
    focus: get('focus')
  }
}

export function parseQuery(search) {
  return parseQueryString(search ?? (typeof window !== 'undefined' ? window.location.search : ''))
}

/**
 * Build a URL from a base path and parameters.  null/undefined values remove
 * the parameter; false values are omitted so shared URLs stay short (all
 * toggles default to true).
 * @param {String} base pathname or absolute URL
 * @param {Object} params
 * @returns {String}
 */
export function buildUrl(base, params) {
  const url = new URL(base, typeof window !== 'undefined' ? window.location.href : 'http://localhost/')
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '' || value === false) url.searchParams.delete(key)
    else url.searchParams.set(key, String(value))
  }
  return url.toString()
}
