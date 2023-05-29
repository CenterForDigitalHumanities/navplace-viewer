/* 
 * @author Bryan Haberberger
 * https://github.com/thehabes 
 */

let VIEWER = {}

//Keep tracked of fetched resources.  Do not fetch resources you have already resolved.
VIEWER.resourceMap = new Map()

//Keep track of how many resources you have fetched
VIEWER.resourceFetchCount = 0

//Keep track of how many resources you are processing for navPlace
VIEWER.resourceCount = 0

//Once you have fetched this many resources, fetch no more.  Helps stop infinite loops from circular references.
VIEWER.resourceFetchLimit = 1000

//Once you have processed this many resources, process no more.  Helps stop infinite loops from circular references.
VIEWER.resourceFindLimit = 1000

//The resource supplied via the iiif-content paramater.  All referenced values that could be resolved are resolved and embedded.
VIEWER.resource = {}

//For Leaflet
VIEWER.mymap = {}

//Supported Resource Types
VIEWER.iiifResourceTypes = ["Collection", "Manifest", "Range", "Canvas"]

//Supported Annotation Types
VIEWER.annotationTypes = ["AnnotationPage", "Annotation"]

//Viewer specific resources to consider in logic.  Set on init()
VIEWER.supportedTypes = []

//IIIF properties to look into for more navPlace values or geography bodies.  Ex. of possibilities not included - partOf, seeAlso, annotations
VIEWER.iiifRecurseKeys = ["items", "structures"]

//We only support IIIF resource types with IIIF Presentation API contexts.
VIEWER.iiif_prezi_contexts = ["https://iiif.io/api/presentation/3/context.json", "http://iiif.io/api/presentation/3/context.json"]

//We check to see if you are using the navPlace context
VIEWER.iiif_navplace_contexts = ["http://iiif.io/api/extension/navplace/context.json", "https://iiif.io/api/extension/navplace/context.json"]

//Annotation contexts to verify
VIEWER.annotation_contexts = VIEWER.iiif_prezi_contexts.concat(["https://www.w3.org/ns/anno.jsonld", "http://www.w3.org/ns/anno.jsonld"])

//GeoJSON contexts to verify
VIEWER.geojson_contexts = ["https://geojson.org/geojson-ld/geojson-context.jsonld", "http://geojson.org/geojson-ld/geojson-context.jsonld"]

VIEWER.isJSON = function(obj) {
    let r = false
    let json = {}
    try {
        json = JSON.parse(JSON.stringify(obj))
        r = true
    } catch (e) {
        r = false
    }
    return r
}

/**
 * Search all levels of the JSON for all navPlace properties.  Annotation bodies do not recurse this way.
 * If you come across a referenced value, attempt to dereference it.  If successful, embed it to go forward with (so as not to resolve it again)
 * Note this may not be memory friendly as the iiif-content passed in scaled up and up.
 * 
 * Return the array Feature Collections
 */
VIEWER.findAllFeatures = async function(data, property = "navPlace", allPropertyInstances = [], setResource = true) {
    //Check against the limits first.  If we reached any, break the recursion and return the results so far.
    if(VIEWER.resourceCount > VIEWER.resourceFindLimit){
        console.warn(`Resource processing limit [${VIEWER.resourceFindLimit}] reached. Make sure your resources do not contain circular references.`)
        return allPropertyInstances
    }
    let resolved_uri = ""
    if (typeof data === "object") {
        if (Array.isArray(data)) {
            //This is an array, perhaps 'items', where each item potentially has geography
            //Go over data item and try to find features, rescursively.
            for (let i = 0; i < data.length; i++) {
                if(allPropertyInstances.length > VIEWER.resourceFindLimit){
                    console.warn(`${property} property aggregation limit [${VIEWER.resourceFindLimit}] reached`)
                    return allPropertyInstances
                }
                let item = data[i]
                let iiif_uri = ""
                let iiif_resolved = null
                if(typeof item === "string"){
                    // This might be a URI.  Attempt to resolve it
                    if (VIEWER.allowFetch) {
                        iiif_uri = item.id ?? item["@id"] ?? "Yikes"
                        iiif_uri = iiif_uri.split("#")[0]
                        //iiif_uri = iiif_uri.split("?")[0]
                        iiif_resolved = VIEWER.resourceMap.get(iiif_uri)
                            ??
                            await fetch(iiif_uri, {"cache":"default"})
                            .then(resp => resp.json())
                            .catch(err => {
                                console.error(err)
                                return {}
                            })
                        VIEWER.resourceFetchCount += 1
                        //Let individual resources keep track of how many times they were fetched.
                        //Note we cache on the first fetch.  A request for the resource from the cache still increments. 
                        if(iiif_resolved.hasOwnProperty("__fetchCount")){
                            iiif_resolved.__fetchCount += 1
                        }
                        else{
                            iiif_resolved.__fetchCount = 1
                        }
                        resolved_uri = iiif_resolved["@id"] ?? iiif_resolved.id ?? "Yikes"
                        if(iiif_uri !== "Yikes"){
                            VIEWER.resourceMap.set(iiif_uri, iiif_resolved)
                            if(iiif_uri !== resolved_uri){
                                //Then the id handed back a different object.  This is not good, somebody messed up their data
                                VIEWER.resourceMap.set(resolved_uri, iiif_resolved)
                            }    
                        }
                        item = iiif_resolved
                    }
                }
                let t2 = item.type ?? item["@type"] ?? "Yikes"
                if (VIEWER.supportedTypes.includes(t2)) {
                    //This is a supported resource.  If it does not have items or body, then attempt to dereference it.
                    //If we had already resolved it above, then there's no point in trying again.
                    if (iiif_resolved===null && (!item.hasOwnProperty("items") || !item.hasOwnProperty("body")) && VIEWER.allowFetch) {
                        iiif_uri = item.id ?? item["@id"] ?? "Yikes"
                        iiif_uri = iiif_uri.split("#")[0]
                        //iiif_uri = iiif_uri.split("?")[0]
                        iiif_resolved = VIEWER.resourceMap.get(iiif_uri)
                            ??
                            await fetch(iiif_uri, {"cache":"default"})
                            .then(resp => resp.json())
                            .catch(err => {
                                console.error(err)
                                return {}
                            })
                        VIEWER.resourceFetchCount += 1
                        //Let individual resources keep track of how many times they were fetched.
                        //Note we cache on the first fetch.  A request for the resource from the cache still increments. 
                        if(iiif_resolved.hasOwnProperty("__fetchCount")){
                            iiif_resolved.__fetchCount += 1
                        }
                        else{
                            iiif_resolved.__fetchCount = 1
                        }
                        resolved_uri = iiif_resolved["@id"] ?? iiif_resolved.id ?? "Yikes"
                        if(iiif_uri !== "Yikes"){
                            VIEWER.resourceMap.set(iiif_uri, iiif_resolved)
                            if(iiif_uri !== resolved_uri){
                                //Then the id handed back a different object.  This is not good, somebody messed up their data
                                VIEWER.resourceMap.set(resolved_uri, iiif_resolved)
                            }    
                        }
                        //If this resource has items now, then it is derferenced and we want to use it moving forward.
                        if (iiif_resolved.hasOwnProperty("items")) {
                            item = iiif_resolved
                        }
                    }
                    //We have a resolved resource object.  It may have navPlace.  It may have 'items' or 'structures'.  Recurse.
                    //item.__fromResource = t1
                    data[i] = item
                    if(VIEWER.allowRecurse){
                        await VIEWER.findAllFeatures(data[i], property, allPropertyInstances, false)
                    }
                    else{
                        if(data[i].hasOwnProperty(property)){
                            data[i][property].__fromResource = t2
                            allPropertyInstances.push(data[i][property])
                        }
                    }
                }
            }
        } else {
            //This is a JSON object.  It may have navPlace. It may contain a property like 'items'.
            let t1 = data.type ?? data["@type"] ?? "Yikes"
            let keys = Object.keys(data)
            VIEWER.resourceCount += 1
            if(VIEWER.resourceCount > VIEWER.resourceFindLimit){
                console.warn(`navPlace lookup limit [${VIEWER.resourceFindLimit}] reached`)
                return allPropertyInstances
            }
            if (VIEWER.supportedTypes.includes(t1)) {
                //Loop the keys, looks for those properties with Array values, or navPlace
                for await (const key of keys) {
                    if(allPropertyInstances.length > VIEWER.resourceFindLimit){
                        console.warn(`${property} property aggregation limit [${VIEWER.resourceFindLimit}] reached`)
                        return allPropertyInstances
                    }
                    if (key === property) {
                        //This is a navPlace object or a Web Annotation body, it may be referenced
                        const featureType = data[key].type ?? data[key]["@type"] ?? "Yikes"
                        let data_uri = ""
                        let data_resolved = VIEWER.resourceMap.get(data_uri) ?? {}
                        if(featureType === "FeatureCollection"){
                            if (!data[key].hasOwnProperty("features")) {
                                //It is either referenced or malformed
                                data_uri = data[key].id ?? data[key]["@id"] ?? "Yikes"
                                data_resolved = data_uri ? 
                                    await fetch(data_uri, {"cache":"default"})
                                    .then(resp => resp.json())
                                    .catch(err => {
                                        console.error(err)
                                        return {}
                                    })
                                    : {}

                                if (data_resolved.hasOwnProperty("features")) {
                                    //Then this it is dereferenced and we want it moving forward.  Otherwise, it is ignored as unusable.
                                    VIEWER.resourceMap.set(data_uri, data_resolved)
                                    resolved_uri = data_resolved["@id"] ?? data_resolved.id ?? "Yikes"
                                    if(data_uri !== resolved_uri){
                                        //Then the id handed back a different object.  This is not good, somebody messed up their data
                                        VIEWER.resourceMap.set(resolved_uri, data_resolved)
                                    }  
                                    data[key] = data_resolved
                                }
                            }
                            if(data[key] && data[key].hasOwnProperty("features")){
                                //Add a property to the feature collection so that it knows what type of resource it is on.
                                //The Features will use this later to color themselves based on type.
                                data[key].__fromResource = t1
                                if(data.hasOwnProperty("thumbnail") && data[key].hasOwnProperty("features")){
                                    //Special support for thumbnails.  If the resource has one specified, move it to the features' properties.
                                    for await (let f of data[key].features) {
                                        if (!f.hasOwnProperty("geoemtry")) {
                                            //It is either referenced or malformed
                                            data_uri = f.id ?? f["@id"]
                                            data_resolved = data_uri ? 
                                                await fetch(data_uri, {"cache":"default"})
                                                .then(resp => resp.json())
                                                .catch(err => {
                                                    console.error(err)
                                                    return {}
                                                })
                                                : {}

                                            if (data_resolved.hasOwnProperty("geometry")) {
                                                //Then this it is dereferenced and we want it moving forward.  Otherwise, it is ignored as unusable.
                                                VIEWER.resourceMap.set(data_uri, data_resolved)
                                                resolved_uri = data_resolved["@id"] ?? data_resolved.id ?? "Yikes"
                                                if(data_uri !== resolved_uri){
                                                    //Then the id handed back a different object.  This is not good, somebody messed up their data
                                                    VIEWER.resourceMap.set(resolved_uri, data_resolved)
                                                }  
                                                f = data_resolved
                                            }
                                        }
                                        if(!f.properties.hasOwnProperty("thumbnail")){
                                            f.properties.thumbnail = data.thumbnail
                                        }
                                        if(t1 === "Canvas"){
                                            if(!f.properties.hasOwnProperty("canvas")){
                                               f.properties.canvas = data["@id"] ?? data["id"] ?? "Yikes" 
                                            }
                                        }
                                        if(t1 === "Manifest"){
                                            if(!f.properties.hasOwnProperty("manifest")){
                                                f.properties.manifest = data["@id"] ?? data["id"] ?? "Yikes"
                                            }
                                        }
                                        if(VIEWER.annotationTypes.includes(t1)){
                                            f.properties.anno = data["@id"] ?? data["id"] ?? "Yikes"
                                            f.properties.targeting = data.target ?? "Yikes"
                                        }
                                    }
                                }
                                //Essentially, this is our base case.  We have the geography object and do not need to recurse.  We just continue looping the keys.
                                allPropertyInstances.push(data[key])
                            }
                        }
                        else if (featureType === "Feature"){
                            if (!data[key].hasOwnProperty("geoemtry")) {
                                //It is either referenced or malformed
                                data_uri = data[key].id ?? data[key]["@id"]
                                data_resolved = data_uri ? 
                                    await fetch(data_uri, {"cache":"default"})
                                    .then(resp => resp.json())
                                    .catch(err => {
                                        console.error(err)
                                        return {}
                                    })
                                    : {}

                                if (data_resolved.hasOwnProperty("geometry")) {
                                    //Then this it is dereferenced and we want it moving forward.  Otherwise, it is ignored as unusable.
                                    VIEWER.resourceMap.set(data_uri, data_resolved)
                                    resolved_uri = data_resolved["@id"] ?? data_resolved.id ?? "Yikes"
                                    if(data_uri !== resolved_uri){
                                        //Then the id handed back a different object.  This is not good, somebody messed up their data
                                        VIEWER.resourceMap.set(resolved_uri, data_resolved)
                                    }  
                                    data[key] = data_resolved
                                }
                            }
                            if(!data[key].properties) data[key].properties = {}
                            data[key].properties.__fromResource = t1
                            if(VIEWER.annotationTypes.includes(t1)){
                                data[key].properties.anno = data["@id"] ?? data["id"] ?? "Yikes"
                                data[key].properties.targeting = data.target ?? "Yikes"
                            }
                            allPropertyInstances.push(data[key])
                        }
                    } 
                    else if (Array.isArray(data[key])) {
                        //Check if this is one of the keys we know to recurse on (items or structures)
                        if(VIEWER.iiifRecurseKeys.includes(key)){
                            //If the top level resource is a Manifest with items[] and structures[], ignore items.
                            if(!(t1==="Manifest" && key === "items" && data.structures)){
                                await VIEWER.findAllFeatures(data[key], property, allPropertyInstances, false)
                            }
                        }
                    }    
                }
            }
        }
    }
    if(setResource){
        //So that we have everything embedded, since we did the work.
        VIEWER.resource = data 
    }
    //In the final recursive call, we have every property instance we came across and add the last one in.
    //This return will be ALL the navPlace Feature Collections we came across.
    return allPropertyInstances
}

/**
 * For supplying latitude/longitude values via the coordinate number inputs.
 * Position the Leaflet map and update the diplayed coordinate text.
 * Note that order matters, so we are specifically saying what is Lat and what is Long.
 */
VIEWER.updateGeometry = function(event) {
    event.preventDefault()
    let lat = clickedLat ? clickedLat : leafLat.value
    lat = parseInt(lat * 1000000) / 1000000
    let long = clickedLong ? clickedLong : leafLong.value
    long = parseInt(long * 1000000) / 1000000
    if (lat && long) {
        VIEWER.mymap.setView([lat, long], 16)
        let coords = `lat: ${leafLat.value}, lon: ${leafLong.value}`
        document.getElementById("currentCoords").innerHTML = `[${coords}]`
    }
    leafLat.value = lat
    leafLong.value = long
}

/**
 * Check if the resource is IIIF Presentation API 3.  If not, the viewer cannot process it.
 * We will also check for the navPlace context...but we will only warn the user if it isn't there.
 */
VIEWER.verifyResource = function() {
    let resourceType = VIEWER.resource.type ?? VIEWER.resource["@type"] ?? "Yikes"
    if (VIEWER.supportedTypes.includes(resourceType)) {
        if(VIEWER.annotationTypes.includes(resourceType)){
            //Slightly different verification for Web Annotation types
            //@context value is a string.
            if(!VIEWER.resource["@context"]){
                alert("The resource provided does not have a Linked Data context.  The context should include the GeoJSON-LD and Web Annotation context.json references.  The resource will be processed, but please fix this ASAP.")
            }
            else if (typeof VIEWER.resource["@context"] === "string") {
                if (!VIEWER.annotation_contexts.includes(VIEWER.resource["@context"])) {
                    alert(`The ${resourceType} does not have a correct @context.  It must be Web Annotation or IIIF Presentation API 3.  The resource will be processed, but please fix this ASAP.`)
                    //return false
                }
                if (!VIEWER.geojson_contexts.includes(VIEWER.resource["@context"])) {
                    alert(`The ${resourceType} should include the GeoJSON-LD context.json.  The resource will be processed, but please fix this ASAP.`)
                    //return false
                }
            }
            //@context value is an array, one item in the array needs to be one of the supported presentation api uris.  
            else if (Array.isArray(VIEWER.resource["@context"]) && VIEWER.resource["@context"].length > 0) {
                const includes_prezi_context = VIEWER.resource["@context"].some(context => {
                    return VIEWER.iiif_prezi_contexts.includes(context)
                })
                const includes_anno_context = VIEWER.resource["@context"].some(context => {
                    return VIEWER.annotation_contexts.includes(context)
                })
                const includes_geojson_context = VIEWER.resource["@context"].some(context => {
                    return VIEWER.annotation_contexts.includes(context)
                })
                if (!(includes_prezi_context || includes_anno_context)) {
                    alert(`The ${resourceType} does not have a correct @context.  It must be Web Annotation or IIIF Presentation API 3.  The resource will be processed, but please fix this ASAP.`)
                }
                if (!includes_geojson_context) {
                    alert(`The ${resourceType} should include the GeoJSON-LD context.json.  The resource will be processed, but please fix this ASAP.`)
                }
                //return (includes_prezi_context || includes_anno_context) && includes_geojson_context
            }
            //@context value is a custom object -- NOT SUPPORTED
            else if (VIEWER.isJSON(VIEWER.resource["@context"])) {
                alert("We cannot support custom context objects.  This object cannot be verified by its context.  The resource will still be processed.  Please look into changing the context to be '@context: [GeoJSON-LD, Web Annotation]'")
                //return false
            }
        }
        else{
            //Verification for IIIF Presentation API Defined Types
            //@context value is a string.
            if(!VIEWER.resource["@context"]){
                alert("The resource provided does not have a linked data context.  The context should include the IIIF Presentation API 3 and navPlace Extension context.json references.  The resource will be processed, but please fix this ASAP.")
            }
            else if (typeof VIEWER.resource["@context"] === "string") {
                if (!VIEWER.iiif_prezi_contexts.includes(VIEWER.resource["@context"])) {
                    alert("The IIIF resource type does not have the correct @context, it must be Presentation API 3.")
                }
                alert("The object you provided does not contain the navPlace JSON-LD context.")
                //return false
            }
            //@context value is an array, one item in the array needs to be one of the supported presentation api uris.  
            else if (Array.isArray(VIEWER.resource["@context"]) && VIEWER.resource["@context"].length > 0) {
                let includes_prezi_context = VIEWER.resource["@context"].some(context => {
                    return VIEWER.iiif_prezi_contexts.includes(context)
                })
                let includes_navplace_context = VIEWER.resource["@context"].some(context => {
                    return VIEWER.iiif_navplace_contexts.includes(context)
                })
                if (!includes_prezi_context) {
                    alert("The IIIF resource type does not have the correct @context.")
                }
                if (!includes_navplace_context) {
                    alert("The object you provided does not contain the navPlace JSON-LD context.")
                }
                //return includes_prezi_context && includes_navplace_context
            }
            //@context value is a custom object -- NOT SUPPORTED
            else if (VIEWER.isJSON(VIEWER.resource["@context"])) {
                alert("We cannot support custom context objects.  The resource will be processed, but please use the IIIF Presentation API 3 context.")
                //return false
            }    
        }
        return true
    } 
    else {
        if(location.pathname.includes("annotation-viewer")){
            if(VIEWER.iiifResourceTypes.includes(resourceType)){
                if(confirm(
                    "This viewer is for W3C Web Annotation 'Annotation' and 'AnnotationPage' objects with bodies containing GeoJSON.  Perhaps you want the Navplace Viewer?\n \n"+  
                    "Click 'OK' to go to the Navplace Viewer, or 'Cancel' to stay here and try a different resource."
                ))  location.href = `index.html${location.search}`
            }
            else{
                alert(`The data resource type '${resourceType}' is not supported.  It must be a W3C Web Annotation 'Annotation' or 'AnnotationPage'.  Please check the type.`)
            }
        }
        else{
            if(VIEWER.annotationTypes.includes(resourceType)){
                if(confirm(
                    "This viewer is for IIIF Presentation API objects with the 'navPlace' property.  Perhaps you want the Annotation Viewer?\n \n"+  
                    "Click 'OK' to go to the Annotation Viewer, or 'Cancel' to stay here and try a different resource."
                ))  location.href = `annotation-viewer.html${location.search}`
            }
            else{
                alert(`The data resource type '${resourceType}' is not supported.  It must be a IIIF Presentation API Defined Type.  Please check the type.`)    
            }
        }
        return false
    }
}


/**
 * Given the URI of a web resource, resolve it and get the GeoJSON by discovering navPlace properties.
 * @param {type} URI of the web resource to dereference and consume.
 * @return {Array}
 */
VIEWER.consumeForGeoJSON = async function(dataURL) {
    let geoJSONFeatures = []

    let dataObj = await fetch(dataURL, {"cache":"default"})
        .then(resp => resp.json())
        .then(man => { return man })
        .catch(err => { return null })

    if (dataObj) {
        VIEWER.resource = JSON.parse(JSON.stringify(dataObj))
        const resourceType = VIEWER.resource.type ?? VIEWER.resource["@type"] ?? "Yikes"
        if (!VIEWER.verifyResource()) {
            //We cannot reliably parse the features from this resource.  Return the empty array.
            return geoJSONFeatures
        }
        //Find all Features in this IIIF Presentation API resource and its items (children).  
        const prop = VIEWER.annotationTypes.includes(resourceType) ? "body" : "navPlace"
        geoJSONFeatures = await VIEWER.findAllFeatures(VIEWER.resource, prop)
        geoJSONFeatures = geoJSONFeatures.reduce((prev, curr) => {
            //Referenced values were already resolved at this point.  If there are no features, there are no features :(
            if (curr.features) {
                //The Feature Collection knows what resource it came from.  Make all of its Features know too.
                curr.features.forEach(f => {
                    f.properties.__fromResource = curr.__fromResource ?? "Yikes"
                })
                return prev.concat(curr.features)
            }
            return prev.concat(curr)
        }, [])
        

        /**
         * Below this is helping people who did not put their properties in the Features.
         * It will help along a Manifest or Canvas with navPlaces devoid of properties.
         * Imagine being able to delete all this code if people just did their own properties!
         * 
         * TODO -- Too much C&P in this switch.  This should be broken down into helper functions.
         */ 
        switch(resourceType){
            // This logic is the same as the Manifest logic, except looped over Collection.items which are Manifests.
            case "Collection":
                let coll_geos = []
                if (VIEWER.resource.hasOwnProperty("navPlace")) {
                    if (VIEWER.resource.navPlace.features) {
                        VIEWER.resource.navPlace.features = VIEWER.resource.navPlace.features.map(f => {
                            //FIXME support referenced Features even though the spec encourages embedded Features?
                            if (!f.properties.thumbnail) {
                                if(VIEWER.resource.thumbnail){
                                    f.properties.thumbnail = VIEWER.resource.thumbnail
                                }
                            }
                            if (!f.properties.hasOwnProperty("summary")) {
                                f.properties.summary = VIEWER.resource.summary ?? ""
                            }
                            if (!f.properties.hasOwnProperty("label")) {
                                f.properties.label = VIEWER.resource.label ?? ""
                            }
                            if (!f.properties.hasOwnProperty("collection")) {
                                f.properties.label = VIEWER.resource.label ?? ""
                            }
                            f.properties.collection = VIEWER.resource["@id"] ?? VIEWER.resource["id"] ?? "Yikes"
                            return f
                        })
                        coll_geos.push(VIEWER.resource.navPlace)
                    }
                }
                geoJSONFeatures = coll_geos
                VIEWER.resource.items.map(async (manifest) => {
                    let manifest_geos = [] //For the top level resource.navPlace
                    let canvasGeos = [] //For resource.item navPlaces
                    let structuresGeos = []// For resource.structures navPlaces
                    if (manifest.hasOwnProperty("navPlace")) {
                        if (manifest.navPlace.features) {
                            manifest.navPlace.features = manifest.navPlace.features.map(f => {
                                //FIXME support referenced Features even though the spec encourages embedded Features?
                                if (!f.properties.thumbnail) {
                                    //Then lets grab the image URL from the annotation of the first Canvas item if available.  
                                    if(manifest.thumbnail){
                                        f.properties.thumbnail = manifest.thumbnail
                                    }
                                    else if (manifest.hasOwnProperty("items") && manifest.items.length && manifest.items[0].items.length && manifest.items[0].items[0].items.length) {
                                        if (manifest.items[0].items[0].items[0].body) {
                                            let thumburl = manifest.items[0].items[0].items[0].body.id ?? ""
                                            f.properties.thumbnail = [{"id":thumburl}]
                                        }
                                    }
                                }
                                if (!f.properties.hasOwnProperty("summary")) {
                                    f.properties.summary = manifest.summary ?? ""
                                }
                                if (!f.properties.hasOwnProperty("label")) {
                                    f.properties.label = manifest.label ?? ""
                                }
                                if (!f.properties.hasOwnProperty("manifest")) {
                                    if (resourceType === "Manifest") {
                                        f.properties.manifest = manifest["@id"] ?? manifest["id"] ?? "Yikes"
                                    }
                                }
                                return f
                            })
                            manifest_geos.push(manifest.navPlace)
                        }
                    }
                    
                    /*
                     * Preference Manifest.structures manifest_geos over Manifest.items
                     */
                    if (manifest.hasOwnProperty("structures") && manifest.structures.length) {
                        structuresGeos = await Promise.all(manifest.structures.map(async (s) => {
                            //This range may contain other ranges and has the same complexity as a Collection...
                            let structureGeo = await VIEWER.findAllFeatures(s, "navPlace", [], false)
                            return structureGeo
                        }))
                    }
                    else if (manifest.hasOwnProperty("items") && manifest.items.length) {
                        canvasGeos = manifest.items
                            .filter(item => {
                                //We only care about Canvases I think.  Ignore everything else
                                let itemType = item.type ?? item["@type"] ?? "Yikes"
                                return item.hasOwnProperty("navPlace") && (itemType === "Canvas")
                            })
                            .map(canvas => {
                                //Add data from the canvas or the manifest here.
                                if(canvas.navPlace.features){
                                    canvas.navPlace.features.forEach(feature => {
                                        //FIXME support referenced Features even though the spec encourages embedded Features?
                                        if (!feature.properties.hasOwnProperty("thumbnail")) {
                                            //Then lets grab the image URL from the painting annotation
                                            if(canvas.thumbnail){
                                                feature.properties.thumbnail = canvas.thumbnail
                                            }
                                            else if (canvas.items && canvas.items[0] && canvas.items[0].items && canvas.items[0].items[0].body) {
                                                let thumburl = canvas.items[0].items[0].body.id ?? ""
                                                feature.properties.thumbnail = [{"id":thumburl}]
                                            }
                                        }
                                        if (!feature.properties.hasOwnProperty("summary")) {
                                            feature.properties.summary = canvas.summary ?? ""
                                        }
                                        if (!feature.properties.hasOwnProperty("label")) {
                                            feature.properties.label = canvas.label ?? ""
                                        }
                                        if (!feature.properties.hasOwnProperty("canvas")) {
                                            feature.properties.canvas = canvas["@id"] ?? canvas["id"] ?? "Yikes"
                                        }
                                    })    
                                    return canvas.navPlace
                                }
                            })
                    }
                    //Combine them together so that they are all drawn on the web map
                    geoJSONFeatures = geoJSONFeatures.concat([...manifest_geos, ...structuresGeos, ...canvasGeos])
                })
                return geoJSONFeatures
            break
            case "Range":
                // This one is a little different, as a Range can contain a Range.  Complexity is too high.
                return geoJSONFeatures
            break
            case "Manifest":
                let geos = [] //For the top level resource.navPlace
                let itemsGeos = [] //For resource.item navPlaces
                let structuresGeos = []// For resource.structures navPlaces
                if (VIEWER.resource.hasOwnProperty("navPlace")) {
                    if (VIEWER.resource.navPlace.features) {
                        VIEWER.resource.navPlace.features = VIEWER.resource.navPlace.features.map(f => {
                            //FIXME support referenced Features even though the spec encourages embedded Features?
                            if (!f.properties.thumbnail) {
                                //Then lets grab the image URL from the annotation of the first Canvas item if available.  
                                if(VIEWER.resource.thumbnail){
                                    f.properties.thumbnail = VIEWER.resource.thumbnail
                                }
                                else if (VIEWER.resource.hasOwnProperty("items") && VIEWER.resource.items.length && VIEWER.resource.items[0].items.length && VIEWER.resource.items[0].items[0].items.length) {
                                    if (VIEWER.resource.items[0].items[0].items[0].body) {
                                        let thumburl = VIEWER.resource.items[0].items[0].items[0].body.id ?? ""
                                        f.properties.thumbnail = [{"id":thumburl}]
                                    }
                                }
                            }
                            if (!f.properties.hasOwnProperty("summary")) {
                                f.properties.summary = VIEWER.resource.summary ?? ""
                            }
                            if (!f.properties.hasOwnProperty("label")) {
                                f.properties.label = VIEWER.resource.label ?? ""
                            }
                            if (!f.properties.hasOwnProperty("manifest")) {
                                if (resourceType === "Manifest") {
                                    f.properties.manifest = VIEWER.resource["@id"] ?? VIEWER.resource["id"] ?? "Yikes"
                                }
                            }
                            return f
                        })
                        geos.push(VIEWER.resource.navPlace)
                    }
                }
                
                /*
                 * Preference Manifest.structures geos over Manifest.items
                 */
                if (VIEWER.resource.hasOwnProperty("structures") && VIEWER.resource.structures.length) {
                    structuresGeos = await Promise.all(VIEWER.resource.structures.map(async (s) => {
                        //This range may contain other ranges and has the same complexity as a Collection...
                        let structureGeo = await VIEWER.findAllFeatures(s, "navPlace", [], false)
                        return structureGeo
                    }))
                }
                else if (VIEWER.resource.hasOwnProperty("items") && VIEWER.resource.items.length) {
                    itemsGeos = VIEWER.resource.items
                        .filter(item => {
                            //We only care about Canvases I think.  Ignore everything else
                            let itemType = item.type ?? item["@type"] ?? "Yikes"
                            return item.hasOwnProperty("navPlace") && (itemType === "Canvas")
                        })
                        .map(canvas => {
                            //Add data from the canvas or the VIEWER.resource here.
                            if(canvas.navPlace.features){
                                canvas.navPlace.features.forEach(feature => {
                                    //FIXME support referenced Features even though the spec encourages embedded Features?
                                    if (!feature.properties.hasOwnProperty("thumbnail")) {
                                        //Then lets grab the image URL from the painting annotation
                                        if(canvas.thumbnail){
                                            feature.properties.thumbnail = canvas.thumbnail
                                        }
                                        else if (canvas.items && canvas.items[0] && canvas.items[0].items && canvas.items[0].items[0].body) {
                                            let thumburl = canvas.items[0].items[0].body.id ?? ""
                                            feature.properties.thumbnail = [{"id":thumburl}]
                                        }
                                    }
                                    if (!feature.properties.hasOwnProperty("summary")) {
                                        feature.properties.summary = canvas.summary ?? ""
                                    }
                                    if (!feature.properties.hasOwnProperty("label")) {
                                        feature.properties.label = canvas.label ?? ""
                                    }
                                    if (!feature.properties.hasOwnProperty("canvas")) {
                                        feature.properties.canvas = canvas["@id"] ?? canvas["id"] ?? "Yikes"
                                    }
                                })    
                                return canvas.navPlace
                            }
                        })
                }
                //Combine them together so that they are all drawn on the web map
                geoJSONFeatures = [...geos, ...structuresGeos, ...itemsGeos]
                return geoJSONFeatures
            break
            case "Canvas":
                let canvasGeo = {}
                if (VIEWER.resource.hasOwnProperty("navPlace")) {
                    if (VIEWER.resource.navPlace.features) {
                        VIEWER.resource.navPlace.features = VIEWER.resource.navPlace.features.map(f => {
                            //FIXME support referenced Features even though the spec encourages embedded Features?
                            if (!f.properties.thumbnail) {
                                //Then lets grab the image URL from the annotation of the first Canvas item if available.  
                                if(VIEWER.resource.thumbnail){
                                    f.properties.thumbnail = VIEWER.resource.thumbnail
                                }
                                else if (VIEWER.resource.hasOwnProperty("items") && VIEWER.resource.items.length && VIEWER.resource.items[0].items.length && VIEWER.resource.items[0].items[0].items.length) {
                                    if (VIEWER.resource.items[0].items[0].items[0].body) {
                                        let thumburl = VIEWER.resource.items[0].items[0].items[0].body.id ?? ""
                                        f.properties.thumbnail = [{"id":thumburl}]
                                    }
                                }
                            }
                            if (!f.properties.hasOwnProperty("summary")) {
                                f.properties.summary = VIEWER.resource.summary ?? ""
                            }
                            if (!f.properties.hasOwnProperty("label")) {
                                f.properties.label = VIEWER.resource.label ?? ""
                            }
                            if (!f.properties.hasOwnProperty("canvas")) {
                                f.properties.canvas = VIEWER.resource["@id"] ?? VIEWER.resource["id"] ?? "Yikes"
                            }
                            return f
                        })
                    }
                    geoJSONFeatures = VIEWER.resource.navPlace
                    return geoJSONFeatures
                }
            break
            case "AnnotationPage":
            case "Annotation":
                // TODO Metadata support would require resolving and processing the target.
                return geoJSONFeatures
            break
            default:
                alert("Unable to get GeoJSON Features.  The resource type is unknown and I don't know where to look.")
                return geoJSONFeatures
        }
    } else {
        alert("Provided URI did not resolve and so was not dereferencable.  There is no data.")
        return geoJSONFeatures
    }
}

/**
 * Initialize the application.
 * @param {type} view
 * @return {undefined}
 */
VIEWER.init = async function() {
    VIEWER.resourceTypes
    // Don't let either viewer be a catch all for all types.
    if(location.pathname.includes("annotation-viewer")) VIEWER.supportedTypes = Array.from(VIEWER.annotationTypes)
    else{ VIEWER.supportedTypes = Array.from(VIEWER.iiifResourceTypes) }

    let latlong = [12, 12] //default starting coords
    let geos = []
    let resource = {}
    let geoJsonData = []
    let IIIFdataInURL = VIEWER.getURLParameter("iiif-content") ? VIEWER.getURLParameter("iiif-content") : VIEWER.getURLParameter("data")
    let dig = VIEWER.getURLParameter("dig")
    let resolve = VIEWER.getURLParameter("resolve")
    if(dig && dig === "false"){
        digOption.checked = true
    }
    if(resolve && resolve === "false"){
        resolveOption.checked = true
    }
    let dataInURL = IIIFdataInURL
    if (IIIFdataInURL) {
        needs.classList.add("is-hidden")
        viewerBody.classList.remove("is-hidden")
        geoJsonData = await VIEWER.consumeForGeoJSON(dataInURL)
            .then(geoMarkers => { return geoMarkers })
            .catch(err => {
                console.error(err)
                return []
            })
        loadInput.value = "Apply Options"
    }
    let formattedGeoJsonData = geoJsonData.flat(1) //AnnotationPages and FeatureCollections cause arrays in arrays.  
    //Abstracted.  Maybe one day you want to VIEWER.initializeOtherWebMap(latlong, allGeos)
    VIEWER.initializeLeaflet(latlong, formattedGeoJsonData)
}

/**
 * Inititalize a Leaflet Web Map with a standard base map. Give it GeoJSON to draw.
 * In this case, the GeoJSON are all Features take from Feature Collections.
 * These Feature Collections were values of navPlace properties or Web Annotation bodies.
 * All Features from the outer most objects and their children are present.
 * This may have caused duplicates in some cases.
 */
VIEWER.initializeLeaflet = async function(coords, geoMarkers) {
    
    let mapbox_satellite_layer=
    L.tileLayer('https://api.tiles.mapbox.com/v4/{id}/{z}/{x}/{y}.png?access_token=pk.eyJ1IjoidGhlaGFiZXMiLCJhIjoiY2pyaTdmNGUzMzQwdDQzcGRwd21ieHF3NCJ9.SSflgKbI8tLQOo2DuzEgRQ', {
        maxZoom: 19,
        id: 'mapbox.satellite', //mapbox.streets
        accessToken: 'pk.eyJ1IjoidGhlaGFiZXMiLCJhIjoiY2pyaTdmNGUzMzQwdDQzcGRwd21ieHF3NCJ9.SSflgKbI8tLQOo2DuzEgRQ'
    })

    let osm = 
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
    })

    let esri_street = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19
    })
    let esri_natgeo = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19
    })

    let topomap = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
    })

    let carto = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19
    })

    let USGS_top_streets = L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19
    })

    VIEWER.mymap = L.map('leafletInstanceContainer', {
        center: coords,
        zoom: 2,
        layers: [osm, esri_street, topomap, mapbox_satellite_layer]
    })

    let baseMaps = {
        "OpenStreetMap": osm,
        "CartoDB": carto,
        "ESRI Street" : esri_street,
        "ESRI NatGeo" : esri_natgeo,
        "Open Topomap": topomap,
        "USGS Topo + Street": USGS_top_streets,
        "Mapbox Satellite": mapbox_satellite_layer
    }
    let layerControl = L.control.layers(baseMaps, {}).addTo(VIEWER.mymap)

    // let overlayMaps = {
    //     "Cities": osm,
    //     "Streets": esri_street,
    //     "Satellite" : mapbox_satellite_layer,
    //     "Topography" : topomap
    // };
    //var layerControl = L.control.layers(baseMaps, overlayMaps).addTo(VIEWER.mymap)

    let appColor = "#008080"
    L.geoJSON(geoMarkers, {
            pointToLayer: function(feature, latlng) {
                let __fromResource = feature.properties.__fromResource ?? ""
                switch (__fromResource) {
                    case "Collection":
                        appColor = "blue"
                        break
                    case "Manifest":
                        appColor = "purple"
                        break
                    case "Range":
                        appColor = "yellow"
                        break
                    case "Canvas":
                        appColor = "#008080"
                        break
                    case "AnnotationPage":
                    case "Annotation":
                        appColor = "#005A9C"
                    break
                    default:
                        appColor = "red"
                }
                return L.circleMarker(latlng, {
                    radius: 6,
                    fillColor: appColor,
                    color: appColor,
                    weight: 1,
                    opacity: 1,
                    fillOpacity: 1
                })
            },
            style: function(feature) {
                let __fromResource = feature.properties.__fromResource ?? ""
                switch (__fromResource) {
                    case "Collection":
                        appColor = "blue"
                        break
                    case "Manifest":
                        appColor = "purple"
                        break
                    case "Range":
                        appColor = "yellow"
                        break
                    case "Canvas":
                        appColor = "#008080"
                        break
                    case "AnnotationPage":
                    case "Annotation":
                        appColor = "#005A9C"
                    break
                    default:
                        appColor = "red"
                }
                const ft = feature.geometry.type ?? feature.geometry["@type"] ?? "Yikes"
                if (ft !== "Point") {
                    return {
                        color: appColor,
                        fillColor: appColor,
                        fillOpacity: 0.09
                    }
                }
            },
            onEachFeature: VIEWER.formatPopup
        })
        .addTo(VIEWER.mymap)
    leafletInstanceContainer.style.backgroundImage = "none"
    loadingMessage.classList.add("is-hidden")
}

/**
 * Define what information from each Feature belongs in the popup
 * that appears.  We want to show labels, summaries and thumbnails.
 */
VIEWER.formatPopup = function(feature, layer) {
    let popupContent = ""
    let i = 0
    let langs = []
    let stringToLangMap = {"none":[]}
    if (feature.properties){
        if (feature.properties.label){
            //This should be a language map, but might be a string...
            if(typeof feature.properties.label === "string"){
                //console.warn("Detected a 'label' property with a string value.  'label' must be a language map.")
                stringToLangMap.none.push(feature.properties.label)
                feature.properties.label = JSON.parse(JSON.stringify(stringToLangMap))
            }
            langs = Object.keys(feature.properties.label)
            if(langs.length > 0){
                popupContent += `<div class="featureInfo">`
                //Brute force loop all the languages and add them together, separated by their language keys.
                for (const langKey in feature.properties.label) {
                    let allLabelsForLang =
                        feature.properties.label[langKey].length > 1 ? feature.properties.label[langKey].join(" -- ") :
                        feature.properties.label[langKey]
                    popupContent += `<b>${langKey}: ${allLabelsForLang}</b></br>`
                    if(langs.length > 1 && i<langs.length-1){
                        popupContent += `</br>`
                    }
                    i++
                }
                popupContent += `</div>`    
            }
        }
        if (feature.properties.summary) {
            stringToLangMap = {"none":[]}
            i = 0
            if(typeof feature.properties.summary === "string"){
                //console.warn("Detected a 'summary' property with a string value.  'summary' must be a language map.")
                stringToLangMap.none.push(feature.properties.summary)
                feature.properties.summary = JSON.parse(JSON.stringify(stringToLangMap))
            }
            langs = Object.keys(feature.properties.summary)
            if(langs.length > 0){
                popupContent += `<div class="featureInfo">`
                //Brute force loop all the languages and add them together, separated by their language keys.
                for (const langKey in feature.properties.summary) {
                    let allSummariesForLang =
                        feature.properties.summary[langKey].length > 1 ? feature.properties.summary[langKey].join(" -- ") :
                        feature.properties.summary[langKey]
                    popupContent += `<b>${langKey}: ${allSummariesForLang}</b></br>`
                    if(langs.length > 1 && i<langs.length-1){
                        popupContent += `</br>`
                    }
                    i++
                }
                popupContent += `</div>`
            }
        }
        if (feature.properties.thumbnail) {
            let thumbnail = feature.properties.thumbnail[0].id ?? feature.properties.thumbnail[0]["@id"] ?? ""
            popupContent += `<img src="${thumbnail}"\></br>`
        }
        if (feature.properties.manifest) {
            let manifestURI = feature.properties.manifest ?? ""
            popupContent += `<a href="https://projectmirador.org/embed/?iiif-content=${manifestURI}" target="_blank"><img src="https://www.qdl.qa/sites/all/themes/QDLTheme/css/img/logo_mirador.png"/></a>`
            popupContent += `<a href="https://uv-v3.netlify.app/#?c=&m=&s=&cv=&manifest=${manifestURI}" target="_blank"><img src="https://www.qdl.qa/sites/all/themes/QDLTheme/css/img/logo_uv.png"/></a>`
        }
        else if (feature.properties.canvas) {
            let canvasURI = feature.properties.canvas ?? ""
            popupContent += `<a href="https://projectmirador.org/embed/?iiif-content=${canvasURI}" target="_blank"><img src="https://www.qdl.qa/sites/all/themes/QDLTheme/css/img/logo_mirador.png"/></a>`
            popupContent += `<a href="https://uv-v3.netlify.app/#?c=&m=&s=&cv=&manifest=${canvasURI}" target="_blank"><img src="https://www.qdl.qa/sites/all/themes/QDLTheme/css/img/logo_uv.png"/></a>`
        }
        else if (feature.properties.anno) {
            let annoURI = feature.properties.anno ?? ""
            let targetURI = feature.properties.targeting ?? ""
            popupContent += `
                <div class="featureInfo">
                    <a target="_blank" href="${annoURI}">Web Annotation</a><br>
                    <a target="_blank" href="${annoURI}">Targeted Resource</a>
                </div>
            `
        }
        layer.bindPopup(popupContent)
    }
}

VIEWER.getURLParameter = function(variable) {
    var query = window.location.search.substring(1);
    var vars = query.split("&");
    for (var i = 0; i < vars.length; i++) {
        var pair = vars[i].split("=");
        if (pair[0] == variable) { return pair[1]; }
    }
    return (false);
}

//A provided flag to control whether or not fetch referenced resources.
VIEWER.allowFetch = VIEWER.getURLParameter("resolve") === "false" ? false : true

//A provided flag to control whether or not find the navPlaces property throughout the top level resource's relationship hierarchy. 
VIEWER.allowRecurse = VIEWER.getURLParameter("dig") === "false" ? false : true

VIEWER.init()

