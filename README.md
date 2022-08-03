# navplace-viewer

Thank you to the IIIF Community for their help with this side project.  IIIF Maps members provided valuable code review, functionality review, resource testing and feedback.  IIIF Training with Glen Robson provided resources and user expectations.  These factors are what make this useful.  

This viewer is built to support IIIF Presentation API 3 resources (Collection, Manifest, Range, Canvas) with the `navPlace` property.  To supply a resource, provide the URL in the address bar by adding the IIIF Content State parameter `?iiif-content=`.  The `navPlace` property contains GeoJSON-LD and is Linked Data 1.1 compliant.  If you supply a GeoJSON-LD Feature or Feature Collection, that will also render.  Note there is no direct support for Web Annotations that contain GeoJSON-LD as the body.  

The viewer has a brute force standpoint when it comes to rendering the geography on the web map.  It will render __ALL__ the `navPlace` properties it finds on the object supplied and its children (`items` or `structures`) and their children recursively.  For example, if you supply a Manifest which has a `navPlace` property which contains 2 Canvas items that also contain the `navPlace` property, __ALL__ 3 geographies will be rendered.  If the Manifest contains the same geographic information as the Canvases, the data will be duplicated.  There is no setting to turn this on or off.

The viewer will resolve all referenced values.  Going back to our previous example of the Manifest with two Canvases that all have a `navPlace` property.  If the `navPlace` properties were referenced Feature Collections, they would be resolved and appear in the viewer.  If the Canvas items were referenced, they would be resolved and checked for `navPlace` which would also be resolved if it were referenced.  This logic applies recursively from the top level item (such as a Collection) through all children items.  See the /tests/referenced/ directory for examples of referenced resources.  They can be supplied to the viewer to see the functionality.
