/*
 * Query string handling.
 *
 * Every value is percent-decoded exactly once, so an unencoded URI
 * (?iiif-content=https://example.org/m.json) and an encoded one
 * (?iiif-content=https%3A%2F%2Fexample.org%2Fm.json, or Oh My RERUM's
 * handoff) load the same resource.  Decoding once keeps the escapes that
 * belong to the resource URI itself: ?iiif-content=https://e.org/a%252Fb
 * loads https://e.org/a%2Fb.  A '+' stays a '+' (URIs never carry spaces),
 * a stray '%' is left alone, and values may contain '=' (issue #54).
 * Supported parameters:
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

/**
 * Percent-decode a query component once.  Never throws: escape runs that are
 * not valid UTF-8 and lone '%' signs are kept as they are.
 * @param {String} s
 * @returns {String}
 */
export function safeDecode(s) {
  if (s == null) return s
  return String(s).replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run)
    } catch {
      return run
    }
  })
}

/**
 * Percent-encode a query value but keep it readable, like Oh My RERUM's
 * encodeHandoff: ':' and '/' stay as they are, and '%' plus the characters
 * that would end the value (& = + #) are escaped.
 * @param {*} value
 * @returns {String}
 */
export function encodeValue(value) {
  return encodeURI(String(value)).replace(/[&=+#]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

function rawPairs(search) {
  return String(search ?? '').replace(/^\?/, '').split('&').filter(Boolean).map((pair) => {
    const eq = pair.indexOf('=')
    return eq === -1 ? [pair, ''] : [pair.slice(0, eq), pair.slice(eq + 1)]
  })
}

export function parseQueryString(search) {
  const params = new Map()
  for (const [name, value] of rawPairs(search)) {
    const key = safeDecode(name)
    // The first occurrence wins, as with URLSearchParams.get().
    if (!params.has(key)) params.set(key, safeDecode(value))
  }
  const get = (name) => params.get(name) ?? null
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
 * toggles default to true).  Values are encoded with encodeValue() so a
 * shared iiif-content URI stays readable.
 * @param {String} base pathname or absolute URL
 * @param {Object} params
 * @returns {String}
 */
export function buildUrl(base, params) {
  const url = new URL(base, typeof window !== 'undefined' ? window.location.href : 'http://localhost/')
  const pairs = rawPairs(url.search)
    .filter(([name]) => !Object.hasOwn(params, safeDecode(name)))
    .map(([name, value]) => `${name}=${value}`)
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '' || value === false) continue
    pairs.push(`${encodeURIComponent(key)}=${encodeValue(value)}`)
  }
  url.search = pairs.length ? `?${pairs.join('&')}` : ''
  return url.toString()
}
