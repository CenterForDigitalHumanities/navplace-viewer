# navplace-viewer

## IIIF
Thank you to the [IIIF Community](https://iiif.io/community/) for their help with this pocket project.  [IIIF Maps](https://iiif.io/community/groups/maps/) and [IIIF Maps TSG](https://iiif.io/community/groups/maps-tsg/) members provided valuable code review, functionality review, resource testing and feedback.  [IIIF Training](https://iiif.io/get-started/training/) with Glen Robson provided resources and user expectations.  These factors are what make this useful.  

This viewer is built to support [IIIF Presentation API 3 Defined Resource Types](https://iiif.io/api/presentation/3.0/#21-defined-types) (Collection, Manifest, Range, Canvas) with the `navPlace` property.  To supply a resource, provide the URL in the address bar by adding the IIIF Content State parameter `?iiif-content=` or by using the prompts in the interface.  The `navPlace` property contains [GeoJSON-LD](https://geojson.org/geojson-ld/) and is [Linked Data 1.1](https://www.w3.org/TR/json-ld11/) compliant.  If you supply a GeoJSON-LD Feature or Feature Collection URI, those will also render, but you should be supply a IIIF Presentation API 3 Defined Type.

## Functionality Notes

### Brute Force Feature Detection
The viewer has a brute force standpoint when it comes to rendering the geography on the web map.  It will render __ALL__ the `navPlace` properties it finds on the object supplied and its children (`items` or `structures`) and their children recursively.  For example, if you supply a Manifest which has a `navPlace` property which contains 2 Canvas items that also contain the `navPlace` property, __ALL__ 3 geographies will be rendered.  If the Manifest contains the same geographic information as the Canvases, the data will be duplicated.  See the Options section below to control this behavior.

### Resolve Resources By Default
The viewer will resolve all [referenced values, or embedded object values missing key details](https://iiif.io/api/presentation/3.0/#12-terminology) like `items`.  Going back to our previous example of the Manifest with two Canvases that all have a `navPlace` property.  If the `navPlace` properties were referenced Feature Collections, they would be resolved and appear in the viewer.  If the Canvas items were referenced, they would be resolved and checked for `navPlace` which would also be resolved if it were referenced.  This logic applies recursively from the top level item (such as a Collection) through all children items.  See the [/tests/referenced/](/tests/referenced/) directory for examples of referenced resources.  They can be supplied to the viewer to see the functionality.  See the Options section below to control this behavior.

### Options For These Behaviors
You can toggle how the viewer functions by supplying URL parameters or marking the checkboxes available in the UI.

 - *Limit navPlace Detection* : Only use the navPlace properties on my top level object and its direct children.  Don't search rescursively through the Linked Data relationship hierarchy for all the navPlace properties.  
 - *Limit Resolved Resources*: When you come across a referenced value string or object, don't resolve the URI.  Don't resolve everything while going through the Linked Data relationship hierarchy.
   
### Toggleable Basemaps
Click the !["Basemap Layers"](/images/layers.png "Basemap Layers") icon on the top right of the web map for different basemaps to toggle between.

## Pop Up Metadata for Features

### GeoJSON `properties`
The following entries of a Feature's `properties` will be shown in the metadata pop ups
- [Language map](https://iiif.io/api/presentation/3.0/#language-of-property-values) `label` and `summary`.  If a string is detected, it will be converted to a language map `none` entry.
- URI `canvas` or `manifest` which is the `id` of the resource containing the `navPlace` property.
- JSON Array `thumbnail` whose objects containing the URI (`id` or `@id`) of the thumbnail image to appear in the pop up.

Here is an example Feature with these properties

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
                "it": ["Un riassunto italiano"]
            },
            "manifest": "https://example.org/iiif/manifest/1",
            "canvas": "https://example.org/iiif/canvas/1",
            "thumbnail" : [{"id": "https://iiif-test.github.io/test2/images/IMG_8713/full/max/0/default.jpg"}]
        },
        "geometry":{
           "type":"Point",
           "coordinates":[
                9.938,
                51.533
           ]
        }
    }
```

### Automated Metadata Support

For all Presentation API 3 Defined Resource Types if the Feature(s) from the `navPlace` property do not have a `label` and `summary`, they will be automatically set to the `label` and `summary` of the resource itself.

For Manifests, if the Feature(s) from the `navPlace` property do not have a `thumbnail`, their thumbnail will be the image from the first Canvas if one exists.
For Canvases, if the Feature(s) from the `navPlace` property do not have a `thumbnail` property, their thumbnail will be the image from the Canvas if one exists.
This `thumbnail` support does not apply to Ranges or Collections, as their structures are too complex to determine a single image to default to.

## License and Attribution
Primary Developer: Bryan Haberberger
 
&copy; 2023 Research Computing Group at Saint Louis University

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, and/or sublicense, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

The Research Computing Group at Saint Louis University shall be credited for the original source code in all software distributions and publications.

The original source code remains freely and openly available.  The repackaging and sale of the original source code is not allowed.  This source code may be a part of other larger Software that is for sale, so long as that other Software contains the required attribution mentioned above.  

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
