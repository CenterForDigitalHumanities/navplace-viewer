/* 
 * @author Bryan Haberberger
 * https://github.com/thehabes
 */

import pLimit from './plimit.js'
const limiter = pLimit(5)

let VIEWER = {}

VIEWER.resourceFetchCount = 0

VIEWER.resourceFetchLimit = 1000

VIEWER.allowFetch = true

VIEWER.resource = {}

VIEWER.mymap = {}

VIEWER.iiifResourceTypes = ["Collection", "Manifest", "Range", "Canvas"]

VIEWER.iiifRecurseKeys = ["items", "structures"]

VIEWER.iiif_prezi_contexts = ["https://iiif.io/api/presentation/3/context.json", "http://iiif.io/api/presentation/3/context.json"]

VIEWER.iiif_navplace_contexts = ["http://iiif.io/api/extension/navplace/context.json", "https://iiif.io/api/extension/navplace/context.json"]

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
 * Search all levels of the JSON for all navPlace properties.
 * If you come across a referenced navPlace value, dereference it and embed it to go forward with (so as not to resolve it again)
 * Do the same for any IIIF resource you come across.
 * Note this may not be memory friendly as the iiif-content passed in scaled up and up.
 * 
 * Return the array Feature Collections
 */
VIEWER.findAllFeatures = async function(data, property = "navPlace", allPropertyInstances = [], setResource = true) {
    if(VIEWER.allowFetch && VIEWER.resourceFetchCount > VIEWER.resourceFetchLimit){
        alert(`This object contains or references over ${VIEWER.resourceFetchLimit} resources.  The limit for this viewer is 500.  Make sure your resources do not contain circular references.`)
        VIEWER.allowFetch = false
    }
    if (typeof data === "object") {
        if (Array.isArray(data)) {
            //This is an array, most likely an array of 'items', where each potentially has navPlace
            //Go over each item, and try to find features, rescursively.  Each item may have an items property.
            for (let i = 0; i < data.length; i++) {
                let item = data[i]
                let t2 = item.type ?? item["@type"] ?? "Yikes"
                if (VIEWER.iiifResourceTypes.includes(t2)) {
                    //This is a IIIF resource.  It could be embedded or referenced, and we need it dereferenced to use it.
                    //If it does not have items, then dereference.
                    if (!item.hasOwnProperty("items") && VIEWER.allowFetch) {
                        let iiif_uri = item.id ?? item["@id"] ?? ""
                        let iiif_resolved = await limiter(() => fetch(iiif_uri, {"cache":"default"})
                            .then(resp => resp.json())
                            .catch(err => {
                                console.error(err)
                                return {}
                            })
                            VIEWER.resourceFetchCount += 1
                        )
                        //If this resource has items now, then it is resolved and might have navPlace.  Let's move forward with it.
                        if (iiif_resolved.hasOwnProperty("items")) {
                            item = iiif_resolved
                        }
                    }
                    //We have a IIIF resource object.  It may have navPlace.  It may have 'items' or 'structures'.  Recurse.
                    data[i] = item
                    await VIEWER.findAllFeatures(data[i], property, allPropertyInstances, false)
                }
            }
        } else {
            //This is a JSON object.
            //It may have navPlace
            //It may contain a property like 'items' which may have object with navPlace on them, or even more properties like 'items'
            let t1 = data.type ?? data["@type"] ?? "Yikes"
            let keys = Object.keys(data)
            if (VIEWER.iiifResourceTypes.includes(t1)) {
                //Loop the keys, looks for those properties with Array values, or navPlace
                for await (const key of keys) {
                    if (key === property) {
                        //This is a navPlace object, it may be referenced
                        if (!data[key].hasOwnProperty("features")) {
                            //It is either referenced or malformed
                            let data_uri = data[key].id ?? data[key]["@id"] ?? "Yikes"
                            let data_resolved = await limiter(() => fetch(data_uri, {"cache":"default"})
                                .then(resp => resp.json())
                                .catch(err => {
                                    console.error(err)
                                    return {}
                                })
                            )
                            if (data_resolved.hasOwnProperty("features")) {
                                //Then this is the one we want
                                data[key] = data_resolved
                            }
                        }
                        if(data[key] && data[key].hasOwnProperty("features")){
                            //Add a property to the feature collection so that it knows what type of resource it is on.
                            //The Features will use this later to color themselves based on type.
                            data[key].__fromResource = t1
                            //Essentially, this is our base case.  We have navPlace and do not need to recurse.  We just continue looping the keys.
                            allPropertyInstances.push(data[key])
                        }
                    } 
                    else if (Array.isArray(data[key])) {
                        //Check if this is one of the keys we know to recurse on
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
        VIEWER.resource = data //So that we have everything embedded, since we did the work.
    }
    //In the final recursive call, we have every property instance we came across and add the last one in.
    //This return will be ALL the navPlace Feature Collections we came across.
    return allPropertyInstances
}


/**
 * Search all levels of the JSON for all navPlace properties.
 * If you come across a referenced navPlace value, dereference it and embed it to go forward with (so as not to resolve it again)
 * Do the same for any IIIF resource you come across.
 * Note this may not be memory friendly as the iiif-content passed in scaled up and up.
 * 
 * Return the array Feature Collections
 */
VIEWER.findAllFeatures = async function(data, property = "navPlace", allPropertyInstances = [], setResource = true) {
    if (typeof data === "object") {
        if (Array.isArray(data)) {
            //This is an array, most likely an array of 'items', where each potentially has navPlace
            //Go over each item, and try to find features, rescursively.  Each item may have an items property.
            for (let i = 0; i < data.length; i++) {
                let item = data[i]
                let t2 = item.type ?? item["@type"] ?? "Yikes"
                if (VIEWER.iiifResourceTypes.includes(t2)) {
                    //This is a IIIF resource.  It could be embedded or referenced, and we need it dereferenced to use it.
                    //If it does not have items, then dereference.
                    if (!item.hasOwnProperty("items")) {
                        let iiif_uri = item.id ?? item["@id"] ?? ""
                        let iiif_resolved = await limiter(() =>fetch(iiif_uri, {"cache":"default"})
                            .then(resp => resp.json())
                            .catch(err => {
                                console.error(err)
                                return {}
                            })
                        )
                        //If this resource has items now, then it is resolved and might have navPlace.  Let's move forward with it.
                        if (iiif_resolved.hasOwnProperty("items")) {
                            item = iiif_resolved
                        }
                    }
                    //We have a IIIF resource object.  It may have navPlace.  It may have 'items' or 'structures'.  Recurse.
                    data[i] = item
                    await VIEWER.findAllFeatures(data[i], property, allPropertyInstances, false)
                }
            }
        } else {
            //This is a JSON object.
            //It may have navPlace
            //It may contain a property like 'items' which may have object with navPlace on them, or even more properties like 'items'
            let t1 = data.type ?? data["@type"] ?? "Yikes"
            let keys = Object.keys(data)
            if (VIEWER.iiifResourceTypes.includes(t1)) {
                //Loop the keys, looks for those properties with Array values, or navPlace
                for await (const key of keys) {
                    if (key === property) {
                        //This is a navPlace object, it may be referenced
                        if (!data[key].hasOwnProperty("features")) {
                            //It is either referenced or malformed
                            let data_uri = data[key].id ?? data[key]["@id"] ?? "Yikes"
                            let data_resolved = await limiter(() =>fetch(data_uri, {"cache":"default"})
                                .then(resp => resp.json())
                                .catch(err => {
                                    console.error(err)
                                    return {}
                                })
                            )
                            if (data_resolved.hasOwnProperty("features")) {
                                //Then this is the one we want
                                data[key] = data_resolved
                            }
                        }
                        //Add a property to the feature collection so that it knows what type of resource it is on.
                        //The Features will use this later to color themselves based on type.
                        data[key].__fromResource = t1
                        //Essentially, this is our base case.  We have navPlace and do not need to recurse.  We just continue looping the keys.
                        allPropertyInstances.push(data[key])
                    } 
                    else if (Array.isArray(data[key])) {
                        //Check if this is one of the keys we know to recurse on
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
        VIEWER.resource = data //So that we have everything embedded, since we did the work.
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
    if (VIEWER.iiifResourceTypes.includes(resourceType)) {
        //@context value is a string.
        if (typeof VIEWER.resource["@context"] === "string") {
            if (!VIEWER.iiif_prezi_contexts.includes(VIEWER.resource["@context"])) {
                alert("The IIIF resource type does not have the correct @context, it must be Presentation API 3.")
                return false
            }
            alert("The object you provided does not contain the navPlace JSON-LD context.  We will use it, but please fix this ASAP.")
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
                return false
            }
            if (!includes_prezi_context) {
                alert("The object you provided does not contain the navPlace JSON-LD context.  We will use it, but please fix this ASAP.")
            }
            return includes_prezi_context
        }
        //@context value is a custom object -- NOT SUPPORTED
        else if (VIEWER.isJSON(VIEWER.resource["@context"])) {
            alert("We cannot support custom context objects.  You can include multiple context JSON files.  Please include the latest IIIF Presentation API 3 context.")
            return false
        }
        return true
    } else {
        alert("The data resource type is not supported.  It must be a IIIF Presentation API Resource Type.  Please check the type.")
        return false
    }
}


/**
 * Given the URI of a web resource, resolve it and parse our the GeoJSON-LD within.
 * @param {type} URI of the web resource to dereference and consume.
 * @return {Array}
 */
VIEWER.consumeForGeoJSON = async function(dataURL) {
    let geoJSONFeatures = []

    let dataObj = await limiter(() =>fetch(dataURL, {"cache":"default"})
        .then(resp => resp.json())
        .then(man => { return man })
        .catch(err => { return null })
    )
    if (dataObj) {
        VIEWER.resource = JSON.parse(JSON.stringify(dataObj))
        if (!VIEWER.verifyResource()) {
            //We cannot reliably parse the features from this resource.  Return the empty array.
            return geoJSONFeatures
        }
        //Find all Features in this IIIF Presentation API resource and its items (children).  
        //Resolve referenced values along the way.
        //TODO may have to rethink this if we preference structures[] over items[]. This may mean duplicated embedded Canvases.
        //we wouldn't want to draw both navPlaces.
        let geoJSONFeatures = await VIEWER.findAllFeatures(VIEWER.resource)
        geoJSONFeatures = geoJSONFeatures.reduce((prev, curr) => {
            //Referenced values were already resolved at this point.  If there are no features, there are no features :(
            if (curr.features) {
                //The Feature Collection knows what resource it came from.  Make all of its Features know too.
                curr.features.forEach(f => {
                    f.properties.__fromResource = curr.__fromResource ?? "Yikes"
                })
                return prev.concat(curr.features)
            }
        }, [])
        let resourceType = VIEWER.resource.type ?? VIEWER.resource["@type"] ?? "Yikes"

        //Below this is helping people who did not put their properties in the Features.  This is why we encourage you do that.
        //Imagine being able to delete all this code!
        //It will help along a Manifest, Range or Canvas with navPlaces devoid of properties.
        //DO NOT OVERWRITE an existing feature.properties.property.  Only add these in if the feature.properties.property is not present.
        if (resourceType === "Collection") {
            //No special support, this one would be VERY complex.  Referenced values are resolved and present at least.
            //I will not crawl and format/modify all the navPlaces for the collection and its children.
            //Your Features better already have the metadata you intend to display in properties.
            //If there is a great desire for some kind of thumbnail, we can try to grab one from the first Manifest or something for the Collection level navPlace.
            return geoJSONFeatures
        } else if (resourceType === "Manifest") {
            let geos = [] //For the top level resource.navPlace
            let itemsGeos = [] //For resource.item navPlaces
            let structuresGeos = []// For resource.structures navPlaces
            //We will combine all three of these into one array to feed to the web map.  We choose to "draw everything", brute force!
            if (VIEWER.resource.hasOwnProperty("navPlace")) {
                //Remember these are feature collections.  We want to combine all their features.
                if (VIEWER.resource.navPlace.features) {
                    VIEWER.resource.navPlace.features = VIEWER.resource.navPlace.features.map(f => {
                        //It would be great to have a thumbnail for the web map.  If one is not defined, generate one if possible.
                        //TODO make this work with the thumbnail property!
                        if (!f.properties.thumbnail) {
                            //Then lets grab the image URL from the annotation of the first Canvas item if available.  
                            //Might not support some Ranges...
                            if(VIEWER.resource.thumbnail){
                                f.properties.thumbnail = VIEWER.resource.thumbnail
                            }
                            else if (VIEWER.resource.items.length && VIEWER.resource.items[0].items.length && VIEWER.resource.items[0].items[0].items.length) {
                                if (VIEWER.resource.items[0].items[0].items[0].body) {
                                    let thumburl = VIEWER.resource.items[0].items[0].items[0].body.id ?? ""
                                    f.properties.thumbnail = {"id":thumburl}
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
             * Preference structure geos over Manifest item geos.  This is also done in the findAllFeatures() logic.
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
                                if (!feature.properties.hasOwnProperty("thumbnail")) {
                                    //Then lets grab the image URL from the painting annotation
                                    if(canvas.thumbnail){
                                        feature.properties.thumbnail = canvas.thumbnail
                                    }
                                    else if (canvas.items && canvas.items[0] && canvas.items[0].items && canvas.items[0].items[0].body) {
                                        let thumburl = canvas.items[0].items[0].body.id ?? ""
                                        feature.properties.thumbnail = {"id":thumburl}
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
            geoJSONFeatures = [...geos, ...structuresGeos, ...itemsGeos]
            return geoJSONFeatures
        } 
        else if(resourceType === "Range"){
            //This works much like a Collection.  Range.items contains Canvases or Ranges...
            //Too difficult to have special support. 
            return geoJSONFeatures
        }
        else if (resourceType === "Canvas") {
            let canvasGeo = {}
            if (VIEWER.resource.hasOwnProperty("navPlace")) {
                //Remember these are feature collections.  We just want to move forward with the features.
                if (VIEWER.resource.navPlace.features) {
                    VIEWER.resource.navPlace.features = VIEWER.resource.navPlace.features.map(f => {
                        if (!f.properties.thumbnail) {
                            //Then lets grab the image URL from the annotation of the first Canvas item if available.  
                            //Might not support some Ranges...
                            if(VIEWER.resource.thumbnail){
                                f.properties.thumbnail = VIEWER.resource.thumbnail
                            }
                            else if (VIEWER.resource.items.length && VIEWER.resource.items[0].items.length && VIEWER.resource.items[0].items[0].items.length) {
                                if (VIEWER.resource.items[0].items[0].items[0].body) {
                                    let thumburl = VIEWER.resource.items[0].items[0].items[0].body.id ?? ""
                                    f.properties.thumbnail = {"id":thumburl}
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
        } else {
            // There is no way for me to get the features, I don't know where to look.
            alert("Unable to get GeoJSON Features.  The resource type is unknown and I don't know where to look.")
            return geoJSONFeatures
        }
    } else {
        console.error("URI did not resolve and so was not dereferencable.  There is no data.")
        return geoJSONFeatures
    }
}

/**
 * Initialize the application.
 * @param {type} view
 * @return {undefined}
 */
VIEWER.init = async function() {
    let latlong = [12, 12] //default starting coords
    let geos = []
    let resource = {}
    let geoJsonData = []
    let IIIFdataInURL = VIEWER.getURLParameter("iiif-content")
    let dataInURL = IIIFdataInURL
    //Do we need to Base64 Decode this ever?
    if (!IIIFdataInURL) {
        //Support other patterns?
        dataInURL = VIEWER.getURLParameter("data-uri")
    }
    if (dataInURL) {
        //When this data is returned, it is completely and fully resolved and formatted.
        //Basic properties will be added to the feature popups automatically when possible.
        geoJsonData = await VIEWER.consumeForGeoJSON(dataInURL)
            .then(geoMarkers => { return geoMarkers })
            .catch(err => {
                console.error(err)
                return []
            })
    }
    let formattedGeoJsonData = geoJsonData.flat(1) //AnnotationPages and FeatureCollections cause arrays in arrays.  
    //Abstracted.  Maybe one day you want to VIEWER.initializeOtherWebMap(latlong, allGeos)
    VIEWER.initializeLeaflet(latlong, formattedGeoJsonData)
}

/**
 * Inititalize a Leaflet Web Map with a standard base map. Give it GeoJSON to draw.
 * In this case, the GeoJSON are all Features take from Feature Collections.
 * These Feature Collections were values of navPlace properties.
 * All Features from the outer most objects and their children are present.
 * This may have caused duplicates in some cases.  We aplogoize it is slightly naive for now.
 */
VIEWER.initializeLeaflet = async function(coords, geoMarkers) {
    VIEWER.mymap = L.map('leafletInstanceContainer')
    L.tileLayer('https://api.tiles.mapbox.com/v4/{id}/{z}/{x}/{y}.png?access_token=pk.eyJ1IjoidGhlaGFiZXMiLCJhIjoiY2pyaTdmNGUzMzQwdDQzcGRwd21ieHF3NCJ9.SSflgKbI8tLQOo2DuzEgRQ', {
        attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors, <a href="https://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, Imagery © <a href="https://www.mapbox.com/">Mapbox</a>',
        maxZoom: 19,
        id: 'mapbox.satellite', //mapbox.streets
        accessToken: 'pk.eyJ1IjoidGhlaGFiZXMiLCJhIjoiY2pyaTdmNGUzMzQwdDQzcGRwd21ieHF3NCJ9.SSflgKbI8tLQOo2DuzEgRQ'
    }).addTo(VIEWER.mymap);
    VIEWER.mymap.setView(coords, 2);
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
                    default:
                        appColor = "red"
                }
                if (feature.geometry.type !== "Point") {
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
    let langs = ""
    if (feature.properties) {
        if (feature.properties.label && Object.keys(feature.properties.label).length) {
            popupContent += `<div class="featureInfo">`
            //Brute force loop all the languages and add them together, separated by their language keys.
            langs = Object.keys(feature.properties.label)
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
        if (feature.properties.summary && Object.keys(feature.properties.summary).length) {
            popupContent += `<div class="featureInfo">`
            //Brute force loop all the languages and add them together, separated by their language keys.
            i = 0
            langs = Object.keys(feature.properties.summary)
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
        if (feature.properties.thumbnail) {
            let thumbnail = feature.properties.thumbnail.id ?? feature.properties.thumbnail["@id"] ?? ""
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
        layer.bindPopup(popupContent)
    }
}

/**
 * This is for updating the map view to the coordinates the user provided, as a preview. 
 */ 
VIEWER.goToCoords = function(event) {
    if (leafLat.value && leafLong.value) {
        let lat = leafLat.value
        lat = parseInt(lat * 1000000) / 1000000
        let long = leafLong.value
        long = parseInt(long * 1000000) / 1000000
        let coords = [lat, long]
        VIEWER.mymap.flyTo(coords, 8)
        coords = `lat: ${leafLat.value}, lon: ${leafLong.value}`
        document.getElementById("currentCoords").innerHTML = `[${coords}]`
        window.scrollTo(0, leafletInstanceContainer.offsetTop - 5)
        leafLat.value = lat
        leafLong.value = long
    }
}

/**
 * Check if the given object has a valid IIIF context associated with it
 * @param {type} obj
 * @return {Boolean}
 */
VIEWER.checkForIIIF = function(targetObj) {
    if (targetObj["@context"]) {
        if (Array.isArray(targetObj["@context"])) {
            return targetObj["@context"].includes("http://iiif.io/api/presentation/3/context.json") || targetObj["@context"].includes("http://iiif.io/api/presentation/2/context.json")
        } else if (typeof targetObj["@context"] === "string") {
            return targetObj["@context"] === "http://iiif.io/api/presentation/3/context.json" || targetObj["@context"] === "http://iiif.io/api/presentation/2/context.json"
        }
    }
    return false
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

VIEWER.init()
/**
 * Control for user input of latitude and longitude in the text inputs.
 */ 
leafLat.oninput = VIEWER.updateGeometry
leafLong.oninput = VIEWER.updateGeometry