/*
 * <viewer-options> — the URI input and detection controls below the map.
 * Dispatches `nav-load` ({uri, dig, resolve, ldn}) and `nav-reset`.
 * No inline onclick handlers; the app orchestrator listens for the events.
 *
 * variant="iiif" shows the dig/resolve/LDN toggles; variant="annotation"
 * is just the URI input and buttons.
 */

class ViewerOptions extends HTMLElement {
  connectedCallback() {
    if (this.dataset.rendered) return
    this.dataset.rendered = 'true'
    const variant = this.getAttribute('variant') === 'annotation' ? 'annotation' : 'iiif'
    this.innerHTML = `
      <p class="howTo">
        It looks like you haven't provided a URI. If you are not using the
        ${variant === 'iiif' ? `<code>?iiif-content=</code>` : `<code>?iiif-content=</code> or <code>?data=</code>`}
        URL parameter, you can supply a URI here.
        <input id="resourceURI" type="text" />
      </p>
      ${variant === 'iiif' ? `
      <div class="row">
        <div class="col-10">
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
            <span class="badge is-success">beta</span><br>
            <b>Consume notifications</b>: <input id="ldnOption" type="checkbox" checked />
          </p>
        </div>
      </div>` : ''}
      <input id="loadInput" type="button" value="Load Resource" />
      <input id="startOverInput" type="button" value="Start Over" />
    `
    this.querySelector('#loadInput').addEventListener('click', () => this._load())
    this.querySelector('#startOverInput').addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('nav-reset'))
    })
    this.querySelector('#resourceURI').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._load()
    })
  }

  _load() {
    const uri = this.querySelector('#resourceURI')?.value?.trim() ?? ''
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

  /** Once a resource is on screen the manual loader is noise (legacy parity). */
  collapse(collapsed) {
    const input = this.querySelector('#loadInput')
    if (input) input.classList.toggle('is-hidden', !!collapsed)
  }
}

customElements.define('viewer-options', ViewerOptions)
