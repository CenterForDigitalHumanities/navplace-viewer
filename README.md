# navplace-viewer

## IIIF
Thank you to the [IIIF Community](https://iiif.io/community/) for their help with this pocket project.  [IIIF Maps](https://iiif.io/community/groups/maps/) and [IIIF Maps TSG](https://iiif.io/community/groups/maps-tsg/) members provided valuable code review, functionality review, resource testing and feedback.  [IIIF Training](https://iiif.io/get-started/training/) with Glen Robson provided resources and user expectations.  These factors are what make this useful.  

The Navplace Viewer is built to support [IIIF Presentation API Defined Types](https://iiif.io/api/presentation/3.0/#21-defined-types) (Collection, Manifest, Range, Canvas) with the [`navPlace` property](https://iiif.io/api/extension/navplace/).  Resources authored against **Presentation API 2, 3, or 4** are all accepted: the viewer detects the version from the `@context` and normalizes v2/v4 shapes to the v3 model before display.  Presentation API 4 resources are read through those same four types; v4's Scene and Timeline are not supported.  To supply a resource, provide the URL in the address bar by adding the IIIF Content State parameter `?iiif-content=` (or its aliases `?data=` and `?manifest=`) or by using the prompts in the interface.  The parameter takes a plain URI; a base64url-encoded Content State is not supported.  The `navPlace` property contains [GeoJSON-LD](https://geojson.org/geojson-ld/) and is [Linked Data 1.1](https://www.w3.org/TR/json-ld11/) compliant.

Now in beta: the Annotation Viewer also supports [W3C Web Annotation](https://www.w3.org/TR/annotation-model/) 'Annotation' and 'AnnotationPage' types!  To supply a resource, head to [annotation-viewer.html](https://map.rerum.io/annotation-viewer.html).  You can provide the URL in the address bar by using the `?iiif-content=` or `?data=` URL parameters, or by using the prompts in the interface.  It is expected that Annotations used will contain [GeoJSON-LD](https://geojson.org/geojson-ld/) bodies and be [Linked Data 1.1](https://www.w3.org/TR/json-ld11/) compliant.

Also in beta: **Linked Data Notifications (LDN) consumption** on the main viewer.  When the resource or its embedded children and grandchildren declare an `inbox` (as [rerum.io](https://rerum.io) and the [geolocator](https://github.com/CenterForDigitalHumanities/geolocator) do), the viewer reads notifications from those inboxes and renders them on the map in orange.  Their popups name the notification's creator and date and link to the notification.  Only Annotations with GeoJSON bodies are shown, up to 50 of them, and an Annotation that targets a resource not on the map is skipped.  Notifications are additive: an inbox that is missing, private, or offline is silently skipped.  Reading inboxes sends a request from the visitor's browser to every inbox host the resources declare, which can be a different server than the one hosting the resource.  Turn the feature off with the checkbox or `?ldn=false`.

## Companion Apps
This viewer is the consumer half of a pair.  [The Geolocator](https://geo.rerum.io) ([repository](https://github.com/CenterForDigitalHumanities/geolocator)) is the producer: it stamps `navPlace` into IIIF Presentation 2/3/4 resources and creates W3C Web Annotations with GeoJSON-LD bodies, then hands off to this viewer via `?iiif-content=` / `?data=` links.  The full producer/consumer contract (version tolerance, no `motivation` filtering, URL handoff, LDN ownership) is specified in [issue #55](https://github.com/CenterForDigitalHumanities/navplace-viewer/issues/55).

## 🌟👍 Contributors 👍🌟
To contribute (you will want to run this on localhost), read the [Navplace Viewer Contributors Guide](CONTRIBUTING.md).  If you are looking to fork and run your own Navplace Viewer, continue reading.

## Have Your Own Viewer Right Away
If you are tailoring the viewer for your specific needs and do not want to contribute to this original or you want to deploy your modifications immediately without waiting for a review then you should fork this repository into your GitHub space.  It will run immediately if you deploy the fork using GitHub Pages (you will get a default URL right away), and you can assign your own DNS from there.  If you want to contribute that modification to the original, pull request your changes to the `main` branch in this repository from your repository.  Please attribute the original and offer free access to your fork as described by the README.

## Functionality Notes

### Brute Force Feature Detection
The viewer has a brute force standpoint when it comes to rendering these resources' geographic data on the web map.  It will render __ALL__ the `navPlace` properties it finds on the object supplied and its children (`items` or `structures`) and their children [recursively](https://www.merriam-webster.com/dictionary/recursion).  For example, if you supply a Manifest which has a `navPlace` property which contains 2 Canvas items that also contain the `navPlace` property, __ALL__ 3 geographies will be rendered.  If the Manifest contains the same geographic information as the Canvases, the data will be duplicated.  Each resource contributes its `navPlace` once, even when it is reached more than once, such as a Canvas that two Ranges reference.  A Manifest that has `structures` is mapped through its Ranges, and its `items` are not searched.  A Canvas that a Range references is fetched, or, when it can't be fetched, read from the Manifest's own Canvases.  See the Options section below to control this behavior.

### Resolve Resources By Default
The viewer will resolve all [referenced values, or embedded object values missing key details](https://iiif.io/api/presentation/3.0/#12-terminology) like `items`.  Going back to our previous example of the Manifest with two Canvases that all have a `navPlace` property.  If the `navPlace` properties were referenced Feature Collections, they would be resolved and appear in the viewer.  If the Canvas items were referenced, they would be resolved and checked for `navPlace` which would also be resolved if it were referenced.  This logic applies recursively from the top level item (such as a Collection) through all children items.  To guard against circular references, the viewer stops fetching after 1000 requests and stops processing after 1000 resources, and says so in a notice.  See the [/tests/referenced/](/tests/referenced/) directory for examples of referenced resources.  [They can be supplied to the viewer to see the functionality](https://centerfordigitalhumanities.github.io/navplace-viewer/?iiif-content=https://map.rerum.io/tests/referenced/collection-2.json).  See the Options section below to control this behavior.

### Options For These Behaviors
You can toggle how the viewer functions by supplying URL parameters or marking the check boxes available in the UI below the web map.

 - *Limit navPlace Detection* : Only use the navPlace properties on my top level object and its direct children.  Don't search recursively through the Linked Data relationship hierarchy for all the navPlace properties.  Its URL parameter is `dig` and is `dig=true` by default.
 - *Limit Resolved Resources*: Don't fetch referenced Collections, Manifests, Ranges, Canvases, or Annotations while going through the Linked Data relationship hierarchy.  Only the embedded resources are searched.  A `navPlace` value or Annotation body that is itself a reference is still fetched, because it is the geography.  Its URL parameter is `resolve` and is `resolve=true` by default.
 - *Consume notifications* (main viewer only): read geography from the `inbox` declarations of the displayed resources.  Its URL parameter is `ldn` and is `ldn=true` by default.
 - *Basemap*: pick the underlying map layer.  Its URL parameter is `layer` and accepts (case-insensitive) `OpenStreetMap`, `ESRI Light Gray`, `ESRI Street`, `ESRI NatGeo`, `Open Topomap`, `USGS Topo + Street`, or `Esri World Imagery`.  The default is `Esri World Imagery`, which is also used for a name the viewer doesn't recognize.  Picking a basemap on the map updates this parameter.  Example: `?layer=OpenStreetMap`.
 - *Focus*: zoom to a feature and open its popup once rendering finishes.  Its URL parameter is `focus` and takes the feature's GeoJSON `id`.  A feature without an `id` is named by its position among the drawn features, `feature[0]`, `feature[1]`, and so on.  Example: `?focus=https://example.org/geojson/feature/2`.

Every parameter above can be combined with `?iiif-content=` (or `?data=` or `?manifest=`) so a fully configured view is shareable as a URL.

### Toggleable Basemaps
Click the !["Basemap Layers"](/images/layers.png "Basemap Layers") icon on the top right of the web map for different basemaps to toggle between.  Basemaps come from OpenStreetMap, Esri (Light Gray, Street, NatGeo, and World Imagery), OpenTopoMap, and USGS (Imagery Topo).  No API keys are required.  The former Mapbox satellite layer, which needed a Mapbox access token, was replaced by Esri World Imagery, which is the default.  The former CARTO light basemap was replaced by Esri Light Gray.

## Pop Up Metadata for Features

### GeoJSON `properties`
The following entries of a Feature's `properties` will be shown in the metadata pop ups.
- [Language map](https://iiif.io/api/presentation/3.0/#language-of-property-values) `label` and `summary`.  If a string is detected, it will be converted to a language map `none` entry.
- JSON Array `metadata` of `{ "label": ..., "value": ... }` entries, each shown as its label followed by its value.
- `navDate`, shown as an ISO 8601 date and time, or as written when it is not a date.
- JSON Array `thumbnail` whose first object contains the URI (`id` or `@id`) of the thumbnail image to appear in the pop up.
- `rights` and `requiredStatement`.
- URI `canvas` or `manifest` which is the `id` of the resource containing the `navPlace` property.  It becomes "Open in Mirador" and "Open in Universal Viewer" links, which use `manifest` when both are present.
- URIs `anno` and `targeting` (Annotation Viewer) which become links to the Web Annotation and the resource it targets.

The pop up also shows the Feature's geometry type, and the coordinates of a Point.  Every value is escaped before it is shown, and only `http` and `https` URIs become links or images.

Here is an example Feature with these metadata properties

```JSON
    {
        "id":"https://example.org/geojson/feature/2",
        "type":"Feature",
        "properties":{
            "label":{
                "en": ["An English label"],
                "none": ["A language agnostic label.  Que interesante."]
            },
            "summary":{
                "en": ["An English summary"],
                "it": ["Un riassunto Italiano"]
            },
            "manifest": "https://example.org/iiif/manifest/1",
            "canvas": "https://example.org/iiif/canvas/1",
            "thumbnail" : [{"id": "https://example.org/image/thumb.jpg"}]
        },
        "geometry":{
           "type":"Point",
           "coordinates":[-90.28, 38.62]
        }
    }
```

Note that you can have more entries in a Feature's `properties`, but they will not be detected by this viewer and will not appear in the pop ups.  However, this viewer is open source and yours to modify for your needs!  Two hooks are exposed on the global `VIEWER` object so forks can change presentation without touching the modules:

- `VIEWER.formatPopup = (feature) => htmlString` replaces the popup content for every feature.  Your function must escape any values it puts in the HTML.
- `VIEWER.colorFor = (feature) => '#rrggbb'` replaces the color logic (the default colors features by the type of resource its `navPlace` came from, with LDN notifications in orange).

Both are plain assignments, and a map already on screen redraws.  Set them from a `<script type="module">` placed after the `app.js` script; a plain inline script runs before `VIEWER` exists.  Or edit `js/popup.js` / `js/components/map-view.js` directly.  If you think everyone wants what you built, [make an issue in the GitHub repository](https://github.com/CenterForDigitalHumanities/navplace-viewer/issues) for consideration by open source software developers.

### Automated Metadata Support

For all [IIIF Presentation API Defined Types](https://iiif.io/api/presentation/3.0/#21-defined-types), if the Feature(s) from the `navPlace` property do not have a `label`, `summary`, `requiredStatement`, `rights`, or `navDate`, they will be automatically set to that value from the resource itself.  When the resource does not have it either and is part of a Manifest, such as a Canvas or Range, the Manifest's value is used.  [__ALL__ labels and summaries for __ALL__ languages are shown](https://github.com/CenterForDigitalHumanities/navplace-viewer/issues/22).

If the Features do have the `thumbnail` property, the first one listed in the array will be used.  If they do not, the viewer tries these in order:

1. The `thumbnail` of the resource itself.
1. For a Canvas, the image painted on it.  For a Manifest, the image painted on its first Canvas.
1. The `thumbnail` of the Manifest the resource is part of.

A Collection's Features only use the Collection's own `thumbnail`.

Features also record the resource they came from: `canvas` for a Canvas, `manifest` for a Manifest or anything that is part of one, and `collection` for a Collection.  `canvas` and `manifest` drive the Mirador and Universal Viewer links in the pop up.

In the Annotation Viewer, the same `label`, `summary`, `requiredStatement`, `rights`, and `navDate` support applies, taken from the Annotation.  Each Feature also records the Annotation (`anno`) and its target (`targeting`, the `source` of a SpecificResource target) for the pop up links.

## Development
The viewer is a zero-build static site: plain ES modules under `js/`, web components, and no bundler or framework.  Serve the repository root with any static file server (e.g. `npx http-server -p 8080`) and open `index.html`.  The test suite runs on Node's built-in test runner with no dependencies:

```
npm test
```

Tests cover URL parsing, IIIF version normalization, feature discovery, bounding box and zoom math, LDN handling, and popup escaping against the fixtures in `tests/`.

## License and Attribution
Primary Developer: Bryan Haberberger -- https://github.com/thehabes
 
&copy; 2023-2026 Research Computing Group at Saint Louis University

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, and/or sublicense, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

The Research Computing Group at Saint Louis University shall be credited for the original source code in all software distributions and publications.

The original source code remains freely and openly available.  The repackaging and sale of the original source code is not allowed.  This source code may be a part of other larger Software that is for sale, so long as that other Software contains the required attribution mentioned above.  

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
