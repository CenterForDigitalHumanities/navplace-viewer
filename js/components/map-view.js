/*
 * <map-view> — the Leaflet map.  Receives discovered GeoJSON features,
 * colors them by originating resource type, and supports ?layer= basemap
 * selection and ?focus= popup targeting.
 *
 * Leaflet itself stays a plain CDN script tag (global `L`); this component
 * only reads it, so the site remains zero-build.
 */

import { getBbox, calculateZoom, bboxCenter, featureKey } from '../geo.js'
import { buildPopup } from '../popup.js'
import { NOTIFICATION_COLOR } from '../ldn.js'

export const RESOURCE_COLORS = {
  Collection: 'blue',
  Manifest: 'purple',
  Range: 'yellow',
  Canvas: '#008080',
  AnnotationPage: '#005A9C',
  Annotation: '#005A9C',
  Notification: NOTIFICATION_COLOR
}
export const UNKNOWN_COLOR = 'red'

export function defaultColorFor(feature) {
  return RESOURCE_COLORS[feature?.properties?.__fromResource] ?? UNKNOWN_COLOR
}

export const BASEMAPS = [
  {
    name: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  },
  {
    name: 'CartoDB',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
  },
  {
    name: 'ESRI Street',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ'
  },
  {
    name: 'ESRI NatGeo',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; National Geographic, Esri, DeLorme, NAVTEQ'
  },
  {
    name: 'Open Topomap',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'
  },
  {
    name: 'USGS Topo + Street',
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; USGS The National Map'
  },
  {
    name: 'Esri World Imagery',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics'
  }
]

function pickBasemap(query) {
  if (!query) return BASEMAPS[0]
  const q = String(query).toLowerCase()
  return BASEMAPS.find((b) => b.name.toLowerCase() === q)
    ?? BASEMAPS.find((b) => b.name.toLowerCase().includes(q))
    ?? BASEMAPS[0]
}

class MapView extends HTMLElement {
  static observedAttributes = ['layer', 'focus']

  constructor() {
    super()
    this._features = []
    this.colorFor = defaultColorFor
    this.formatPopup = buildPopup
  }

  connectedCallback() {
    if (!this._container) {
      this._container = document.createElement('div')
      this._container.className = 'map-instance'
      this.appendChild(this._container)
    }
    this.render()
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'layer' && this._map) this._applyBasemap(newValue)
    if (name === 'focus' && this._map) this._applyFocus(newValue)
  }

  set features(list) {
    this._features = Array.isArray(list) ? list : []
    if (this.isConnected) this.render()
  }

  get features() {
    return this._features
  }

  _applyBasemap(query) {
    const L = globalThis.L
    if (!L || !this._map) return
    const chosen = this._baseLayers?.get(pickBasemap(query).name)
    if (!chosen) return
    if (this._basemap) this._map.removeLayer(this._basemap)
    this._basemap = chosen.addTo(this._map)
  }

  _applyFocus(key) {
    const L = globalThis.L
    if (!L || !this._map || !key) return
    const index = this._features.findIndex((f, i) => featureKey(f, i) === key)
    if (index === -1) return
    const layer = this._featureLayers?.[index]
    if (!layer) return
    const center = bboxCenter(getBbox(this._features[index]) ?? [0, 0, 0, 0])
    this._map.setView(center, Math.max(this._map.getZoom(), 12))
    if (layer.openPopup) layer.openPopup()
  }

  render() {
    const L = globalThis.L
    if (!L || !this._container) return
    if (this._map) {
      this._map.remove()
      this._map = null
    }
    this._featureLayers = []

    const chosen = pickBasemap(this.getAttribute('layer'))
    let center = [20, 0]
    let zoom = 2
    const allFeatures = { type: 'FeatureCollection', features: this._features }
    const bbox = this._features.length ? getBbox(allFeatures) : undefined
    if (bbox) {
      center = bboxCenter(bbox)
      zoom = Math.max(2, calculateZoom(bbox))
    }

    this._map = L.map(this._container, { center, zoom, layers: [] })
    this._baseLayers = new Map()
    const baseMaps = {}
    for (const def of BASEMAPS) {
      baseMaps[def.name] = L.tileLayer(def.url, { maxZoom: 19, attribution: def.attribution })
      this._baseLayers.set(def.name, baseMaps[def.name])
    }
    this._basemap = baseMaps[chosen.name].addTo(this._map)
    L.control.layers(baseMaps, {}).addTo(this._map)

    if (!this._features.length) return
    const geoLayer = L.geoJSON(allFeatures, {
      pointToLayer: (feature, latlng) => {
        const color = this.colorFor(feature)
        return L.circleMarker(latlng, {
          radius: 6,
          fillColor: color,
          color,
          weight: 1,
          opacity: 1,
          fillOpacity: 1
        })
      },
      style: (feature) => {
        const type = feature.geometry?.type ?? ''
        if (type === 'Point') return {}
        const color = this.colorFor(feature)
        return { color, fillColor: color, fillOpacity: 0.09 }
      },
      onEachFeature: (feature, layer) => {
        const html = this.formatPopup(feature, layer)
        if (html) layer.bindPopup(html)
        this._featureLayers.push(layer)
      }
    }).addTo(this._map)

    if (this._features.length === 1 && bbox) {
      this._map.setView(center, Math.max(zoom, 8))
    }
    this._applyFocus(this.getAttribute('focus'))
  }
}

customElements.define('map-view', MapView)
