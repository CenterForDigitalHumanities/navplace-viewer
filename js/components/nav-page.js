/*
 * <nav-page> — site chrome (header + footer) wrapped around page content.
 * Light DOM with the move-children pattern (slots only work in shadow DOM),
 * so chota and app.css apply to everything unchanged.
 *
 * variant="iiif"        the navPlace viewer (index.html)
 * variant="annotation"  the geolocation annotation viewer (annotation-viewer.html)
 */

const HEADERS = {
  iiif: `
    <header>
      <div class="row">
        <div class="two columns">
          <a href="https://iiif.io"><img src="./images/iiif-logo.jpg" alt="IIIF logo" class="u-full-width"></a>
        </div>
        <h1 class="ten columns">
          <div class="regular-header-text">International Image Interoperability Framework</div>
          <br class="savespace">
          <div class="small-header-text">navPlace Viewer</div>
        </h1>
      </div>
    </header>`,
  annotation: `
    <header>
      <div class="row">
        <div class="two columns">
          <a target="_blank" rel="noopener" href="https://rerum.io"><img src="./images/rerum-logo.png" alt="RERUM logo" class="u-full-width"></a>
        </div>
        <h1 class="ten columns">
          <div class="regular-header-text">RERUM</div>
          <br class="savespace">
          <div class="small-header-text">Geolocation Annotation Viewer</div>
        </h1>
      </div>
    </header>`
}

const FOOTER = `
  <footer class="nav nav-center text-primary is-fixed is-full-width, is-vertical-align">
    <div>
      <a target="_blank" rel="noopener" href="https://www.slu.edu/research/faculty-resources/research-computing.php">
        <img class="brand" alt="" src="./images/rcg-logo.jpg"/> <small>&copy;2023-2026 Research Computing Group</small>
      </a>
    </div>
    <div>
      <a target="_blank" rel="noopener" href="https://rerum.io">
        <img class="brand" alt="" src="./images/rerum-logo.png"/> <small>RERUM</small>
      </a>
    </div>
    <div>
      <a target="_blank" rel="noopener" href="https://iiif.io">
        <img class="brand" alt="" src="https://iiif.io/assets/images/logos/logo-sm.png"><small>International Image Interoperability Framework</small>
      </a>
    </div>
    <div>
      <a target="_blank" rel="noopener" href="https://github.com/CenterForDigitalHumanities/navplace-viewer/blob/main/README.md">
        <img width="30" height="30" alt="Git logo" src="./images/github.svg"><small>&nbsp;&nbsp;Support/Contribute to Navplace Viewer</small>
      </a>
    </div>
  </footer>`

class NavPage extends HTMLElement {
  connectedCallback() {
    if (this.dataset.rendered) return
    this.dataset.rendered = 'true'
    const variant = HEADERS[this.getAttribute('variant')] ? this.getAttribute('variant') : 'iiif'
    // Move the page's own children between header and footer (no shadow DOM).
    const content = [...this.childNodes]
    this.innerHTML = HEADERS[variant]
    const container = document.createElement('div')
    container.className = 'page-content'
    content.forEach((node) => container.appendChild(node))
    this.appendChild(container)
    this.insertAdjacentHTML('beforeend', FOOTER)
  }
}

customElements.define('nav-page', NavPage)
