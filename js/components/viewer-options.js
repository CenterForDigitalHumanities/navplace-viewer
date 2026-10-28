/*
 * <viewer-options> — the URI input and detection controls below the map.
 * Dispatches `nav-load` ({uri, dig, resolve, ldn}) and `nav-reset`.
 * No inline onclick handlers; the app orchestrator listens for the events.
 *
 * variant="iiif" shows the dig/resolve/LDN toggles; variant="annotation"
 * is just the URI input and buttons.  The controls stay on screen after a
 * load, and the app calls sync() so they mirror what is displayed.
 */

class ViewerOptions extends HTMLElement {
  _current = null

  connectedCallback() {
    if (this.dataset.rendered) return
    this.dataset.rendered = 'true'
    this.variant = this.getAttribute('variant') === 'annotation' ? 'annotation' : 'iiif'
    this.innerHTML = `
      <p class="howTo uriInput">
        It looks like you haven't provided a URI. If you are not using the
        ${this.variant === 'iiif' ? `<code>?iiif-content=</code>` : `<code>?iiif-content=</code> or <code>?data=</code>`}
        URL parameter, you can supply a URI here.
        <input id="resourceURI" type="text" />
      </p>
      ${this.variant === 'iiif' ? `
      <h6>You can control how the viewer looks for navPlace properties.</h6>
      <p class="howTo">
        Only resolve the navPlace properties on my top level object and its direct children.<br>
        <b>Limit navPlace Detection</b>: <input id="digOption" type="checkbox" />
      </p>
      <p class="howTo">
        Don't resolve the referenced value string or object URIs. Only use the available embedded data.<br>
        <b>Limit Resolved Resources</b>: <input id="resolveOption" type="checkbox" />
      </p>
      <p class="howTo">
        Also show geography from LDN notifications posted to the resource's inbox.
        <span class="tag is-small bg-primary">beta</span><br>
        <b>Consume notifications</b>: <input id="ldnOption" type="checkbox" checked />
      </p>` : ''}
      <input id="loadInput" type="button" value="Load Resource" />
      <input id="startOverInput" type="button" value="Start Over" />
    `
    this.querySelector('#loadInput').addEventListener('click', () => this._load())
    this.querySelector('#startOverInput').addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('nav-reset', { bubbles: true }))
    })
    this.querySelector('#resourceURI').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._load()
    })
  }

  /**
   * Mirror the viewer state.  The URI input shows only while nothing is
   * loaded or after a failed load; the checkboxes follow the URL.
   * @param {Object} state
   * @param {String|null} [state.content] URI being displayed
   * @param {Boolean} [state.dig]
   * @param {Boolean} [state.resolve]
   * @param {Boolean} [state.ldn]
   * @param {Boolean} [state.failed] the last load failed
   */
  sync({ content = null, dig = true, resolve = true, ldn = true, failed = false } = {}) {
    this._current = content || null
    const showUri = !this._current || failed
    this.querySelector('.uriInput')?.classList.toggle('is-hidden', !showUri)
    const check = (id, value) => {
      const box = this.querySelector(id)
      if (box) box.checked = value
    }
    check('#digOption', dig === false)
    check('#resolveOption', resolve === false)
    check('#ldnOption', ldn !== false)
    const load = this.querySelector('#loadInput')
    if (!load) return
    load.value = !showUri && this.variant === 'iiif' ? 'Apply Options' : 'Load Resource'
    // The annotation viewer has no options to apply (legacy parity).
    load.classList.toggle('is-hidden', this.variant === 'annotation' && !showUri)
  }

  _load() {
    const field = this.querySelector('#resourceURI')
    const typed = field && !field.closest('.is-hidden') ? field.value.trim() : ''
    const uri = typed || this._current || ''
    if (!uri) {
      this.dispatchEvent(new CustomEvent('nav-notice', {
        bubbles: true,
        detail: { message: 'You must supply a URI via the URL parameter or the text input.', level: 'warning' }
      }))
      return
    }
    const dig = this.querySelector('#digOption') ? !this.querySelector('#digOption').checked : true
    const resolve = this.querySelector('#resolveOption') ? !this.querySelector('#resolveOption').checked : true
    const ldn = this.querySelector('#ldnOption') ? this.querySelector('#ldnOption').checked : false
    this.dispatchEvent(new CustomEvent('nav-load', { bubbles: true, detail: { uri, dig, resolve, ldn } }))
  }
}

customElements.define('viewer-options', ViewerOptions)
