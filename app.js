/* 
 * @author Bryan Haberberger
 * https://github.com/thehabes
 */

VIEWER = {}

VIEWER.resource = {}

VIEWER.mymap = {}

VIEWER.iiifResourceTypes = ["Collection", "Manifest", "Range", "Canvas"]

VIEWER.ld_contexts = ["https://iiif.io/api/presentation/3/context.json", "http://iiif.io/api/presentation/3/context.json"]

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
 * Return the array Feature Collections
 */
VIEWER.findAllFeatures = async function(data, property = "navPlace", allPropertyInstances = []) {
    if (typeof data === "object") {
        if (data.hasOwnProperty(property)) {
            //There is a navPlace with a Feature Collection
            //It could be referenced or embedded...we need it defereferenced
            if (data[property].hasOwnProperty("features")) {
                //It is embedded and we should use it without resolving the URI
                //Add a property to the feature collection saying what type of resource it is on.
                data[property].__fromResource = data.type ?? data["@type"] ?? "Yikes"
                allPropertyInstances.push(data[property])
            } else {
                //It is either referenced or malformed
                let data_uri = data[property].id ?? data[property]["@id"] ?? "Yikes"
                let data_resolved = await fetch(data_uri)
                    .then(resp => resp.json())
                    .catch(err => {
                        console.error(err)
                        return {}
                    })
                if (data_resolved.hasOwnProperty("features")) {
                    //Then this is the one we want
                    data[property] = data_resolved
                }
            }
        }
        for (var key in data) {
            let result
            if (key !== property && data[key] && typeof data[key] === "object") {
                let t = data[key].type ?? data[key]["@type"] ?? "Yikes"
                if (VIEWER.iiifResourceTypes.includes(t)) {
                    //This is a IIIF resource.  It could be embedded or referenced, and we need it dereferenced to use it.
                    //If it does not have items, then it is a referenced resource.
                    if (!data[key].hasOwnProperty("items")) {
                        let iiif_uri = data[key].id ?? data[key]["@id"] ?? ""
                        let iiif_resolved = await fetch(iiif_uri)
                            .then(resp => resp.json())
                            .catch(err => {
                                console.error(err)
                                return {}
                            })
                        //If this resource has items now, then it is resolved and might have navPlace.  Let's move forward with it.
                        if (iiif_resolved.hasOwnProperty("items")) {
                            data[key] = iiif_resolved
                        }
                    }
                }
                result = await VIEWER.findAllFeatures(data[key], property, allPropertyInstances)
                if (result.length) {
                    result.forEach(fc => {
                        let resultType = result.type ?? result["@type"] ?? "Yikes"
                        if (resultType === "FeatureCollection") {
                            if (result.features) {
                                allPropertyInstances.push(result)
                            } 
                            // else {
                            //     //Perhaps it is a referenced navPlace value...try to resolve it
                            //     let fid = result.id ?? result["@id"] ?? "Yikes"
                            //     if (fid) {
                            //         await fetch(fid)
                            //             .then(resp => resp.json())
                            //             .then(featureCollection => {
                            //                 if (featureCollection.features) {
                            //                     allPropertyInstances.push(featureCollection)
                            //                 } else {
                            //                     console.error("Came across a Feature Collection with no Features after it was resolved.  It is being ignored.")
                            //                     console.log(featureCollection)
                            //                 }
                            //             })
                            //             .catch(err => {
                            //                 console.error("Came across a Feature Collection with no Features whose id did not resolve.  It is being ignored.")
                            //                 console.log(result)
                            //             })
                            //     }
                            // }
                        }    
                    })
                }
            }
        }
    }
    VIEWER.resource = data //So that we have everything embedded, since we did the work.
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
 */
VIEWER.verifyResource = function() {
    let resourceType = VIEWER.resource.type ?? VIEWER.resource["@type"] ?? "Yikes"
    if (VIEWER.iiifResourceTypes.includes(resourceType)) {
        //@context value is a string.
        if (typeof VIEWER.resource["@context"] === "string") {
            if (!VIEWER.ld_contexts.includes(VIEWER.resource["@context"])) {
                alert("The IIIF resource type does not have the correct @context, it must be Presentation API 3.")
                return false
            }
        }
        //@context value is an array, one item in the array needs to be one of the supported presentation api uris.  
        else if (Array.isArray(VIEWER.resource["@context"]) && VIEWER.resource["@context"].length > 0) {
            let included = VIEWER.resource["@context"].some(context => {
                return VIEWER.ld_contexts.includes(context)
            })
            if (!included) {
                alert("The IIIF resource type does not have the correct @context.")
            }
            return included
        }
        //@context value is a custom object -- NOT SUPPORTEDS
        else if (isJSON(VIEWER.resource["@context"])) {
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
 * Attempt to resolve a URI.  Return the JSON or the error.
 */
VIEWER.resolveReferenceURI = async function(uri) {
    return fetch(uri)
        .then(resp => resp.json())
        .catch(err => {
            console.error(err)
            return err
        })
}

/**
 * Given the URI of a web resource, resolve it and parse our the GeoJSON-LD within.
 * @param {type} URI of the web resource to dereference and consume.
 * @return {Array}
 */
VIEWER.consumeForGeoJSON = async function(dataURL) {
    let geoJSONFeatures = []

    let dataObj = await fetch(dataURL)
        .then(resp => resp.json())
        .then(man => { return man })
        .catch(err => { return null })

    if (dataObj) {
        VIEWER.resource = JSON.parse(JSON.stringify(dataObj))
        if (!VIEWER.verifyResource()) {
            //We cannot reliably parse the features from this resource.  Return the empty array.
            return geoJSONFeatures
        }
        //Find all Features in this IIIF Presentation API resource.  Resolve referenced values along the way.
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

        if (resourceType === "Manifest" || resourceType === "Range") {
            let resourceGeo = {}
            geos = [] //undoing the plain old smash and grab, we are going to specially format these Features as we go.
            let itemsGeos = []
            let structuresGeos = []
            if (dataObj.hasOwnProperty("navPlace")) {
                //Remember these are feature collections.  We just want to move forward with the features from these feature collections combined.
                if (dataObj.navPlace.features) {
                    //It is embedded
                    resourceGeo = dataObj.navPlace.features
                    //Is there something custom you want to do?  Do you want to add Manifest data to the GeoJSON.properties?
                    resourceGeo = resourceGeo.map(f => {
                        //dataObj is the Manifest or the Range.  Grab a property, like seeAlso
                        //f.properties.seeAlso = dataObj.seeAlso 
                        if (!f.properties.thumb) {
                            //Then lets grab the image URL from the annotation of the first Canvas item if available.  Might not support some Ranges...
                            if (dataObj.items.length && dataObj.items[0].items.length && dataObj.items[0].items[0].items.length) {
                                if (dataObj.items[0].items[0].items[0].body) {
                                    let thumburl = dataObj.items[0].items[0].items[0].body.id ?? ""
                                    f.properties.thumb = thumburl
                                }
                            }
                        }
                        f.properties.__fromResource = resourceType
                        return f
                    })
                } 
                // else {
                //     //It could be a referenced navPlace value
                //     let fid = dataObj.navPlace.id ?? dataObj.navPlace["@id"] ?? "Yikes"
                //     if (fid) {
                //         resourceGeo = await fetch(fid)
                //             .then(resp => resp.json())
                //             .then(featureCollection => {
                //                 //Is there something custom you want to do?  Do you want to add Manifest data to the GeoJSON.properties?
                //                 let featureCollectionGeo = featureCollection.features
                //                 featureCollectionGeo = featureCollectionGeo.map(f => {
                //                     //dataObj is the Canvas.  Grab a property, like seeAlso
                //                     //f.properties.seeAlso = dataObj.seeAlso 
                //                     if (!f.properties.thumb) {
                //                         //Then lets grab the image URL from the painting annotation
                //                         //A possible configuration, maybe you don't ever want an image in the popup.
                //                         if (dataObj.items.length && dataObj.items[0].items.length && dataObj.items[0].items[0].items.length) {
                //                             if (dataObj.items[0].items[0].items[0].body) {
                //                                 let thumburl = dataObj.items[0].items[0].items[0].body.id ?? ""
                //                                 f.properties.thumb = thumburl
                //                             }
                //                         }
                //                     }
                //                     f.properties.__fromResource = resourceType
                //                     return f
                //                 })
                //                 return featureCollectionGeo
                //             })
                //             .catch(err => {
                //                 console.error(err)
                //                 return []
                //             })
                //     }
                // }
                geos.push(resourceGeo)
            }
            /*
             * Also the Canvases in the items.  Note we do not crawl the Ranges (structures), but I suppose we could...
             */
            if (dataObj.hasOwnProperty("structures") && dataObj.structures.length) {
                //FIXME these could also be referenced...
                structuresGeos = dataObj.structures
                    .map(s => {
                        let structureGeo = s.navPlace.features
                        structureGeo = structureGeo.map(f => {
                            f.properties.__fromResource = "Range"
                            return f
                        })
                        return structureGeo
                    })
            }
            if (dataObj.hasOwnProperty("items") && dataObj.items.length) {
                //FIXME these could also be referenced...
                itemsGeos = dataObj.items
                    .filter(item => {
                        //We only care about Canvases, I think.  Ignore everything else
                        let itemType = item.type ?? item["@type"] ?? "Yikes"
                        return (item.hasOwnProperty("navPlace") && itemType === "Canvas")
                    })
                    .map(canvas => {
                        //Is there something custom you want to do?  Do you want to add Manifest data to the features?
                        let canvasGeo = canvas.navPlace.features
                        canvasGeo = canvasGeo.map(f => {
                            //Grab a property from the Canvas, like seeAlso
                            //f.properties.seeAlso = canvas.seeAlso 
                            f.properties.__fromResource = "Canvas"
                            return f
                        })
                        return canvasGeo
                    })
            }
            geoJSONFeatures = [...geos, ...structuresGeos, ...itemsGeos]
            return geoJSONFeatures
        } else if (resourceType === "Canvas") {
            let canvasGeo = {}
            geos = [] ////undoing the plain old smash and grab, we are going to specially format these Features as we go.
            if (dataObj.hasOwnProperty("navPlace")) {
                //Remember these are feature collections.  We just want to move forward with the features.
                if (dataObj.navPlace.features) {
                    //It is embedded
                    canvasGeo = dataObj.navPlace.features
                    //Is there something custom you want to do?  Do you want to add Canvas data to the GeoJSON.properties?
                    geoJSONFeatures = canvasGeo.map(f => {
                        //dataObj is the Manifest.  Grab a property, like seeAlso
                        //f.properties.seeAlso = dataObj.seeAlso 
                        if (!f.properties.thumb) {
                            //Then lets grab the image URL from the painting annotation
                            if (dataObj.items.length && dataObj.items[0].items.length) {
                                if (dataObj.items[0].items[0].body) {
                                    let thumburl = dataObj.items[0].items[0].body.id ?? ""
                                    f.properties.thumb = thumburl
                                }
                            }
                        }
                        f.properties.__fromResource = resourceType
                        return f
                    })
                } 
                // else {
                //     //It could be referenced navPlace value
                //     let fid = dataObj.navPlace.id ?? dataObj.navPlace["@id"] ?? ""
                //     if (fid) {
                //         geoJSONFeatures = await fetch(fid)
                //             .then(resp => resp.json())
                //             .then(featureCollection => {
                //                 let featureCollectionGeo = featureCollection.features
                //                 //Is there something custom you want to do?  Do you want to add Canvas data to the GeoJSON.properties?
                //                 featureCollectionGeo = featureCollectionGeo.map(f => {
                //                     //dataObj is the Canvas.  Grab a property, like seeAlso
                //                     //f.properties.seeAlso = dataObj.seeAlso 
                //                     if (!f.properties.thumb) {
                //                         //Then lets grab the image URL from the painting annotation
                //                         if (dataObj.items.length && dataObj.items[0].items.length) {
                //                             if (dataObj.items[0].items[0].body) {
                //                                 let thumburl = dataObj.items[0].items[0].body.id ?? ""
                //                                 f.properties.thumb = thumburl
                //                             }
                //                         }
                //                     }
                //                     f.properties.__fromResource = resourceType
                //                     return f
                //                 })
                //                 return featureCollectionGeo
                //             })
                //             .catch(err => {
                //                 console.error(err)
                //                 return []
                //             })
                //     }
                // }
                return geoJSONFeatures
            }
        } else if (resourceType === "Collection") {
            //No special support, this one would be VERY complex.  I will resolve referenced navPlace objects.
            //I will not crawl and format all the navPlaces for the collection and its children.
            //Your Features better already have the metdata you intend to display in properties.
            return geoJSONFeatures
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
 * Initialize the application by feeding it a IIIF Resource
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
        //Let's pretend consumeForGeoJSON does everything we want with each feature's properties.
        //For now, I have added the properties to the GeoJSON in canvas_navplace.json
        //VIEWER.resource will be the resolved web resource
        geoJsonData = await VIEWER.consumeForGeoJSON(dataInURL)
            .then(geoMarkers => { return geoMarkers })
            .catch(err => {
                console.error(err)
                return []
            })
    }
    let formattedGeoJsonData = geoJsonData.flat(1) //AnnotationPages and FeatureCollections cause arrays in arrays.  
    let topLevelResourceType = VIEWER.resource["@type"] ?? VIEWER.resource.type ?? "Yikes"
    let allGeos = formattedGeoJsonData.map(function(geoJSON) {
        //Note that it is probably best you format the properties in consumeForGeoJSON() before getting here.
        //Top level resource agnostic
        if (!geoJSON.properties.hasOwnProperty("summary")) {
            geoJSON.properties.summary = VIEWER.resource.summary ?? ""
        }
        //Top level resource agnostic
        if (!geoJSON.properties.hasOwnProperty("label")) {
            geoJSON.properties.label = VIEWER.resource.label ?? ""
        }
        //Top level resource agnostic
        if (!geoJSON.properties.hasOwnProperty("thumb")) {
            geoJSON.properties.thumb = VIEWER.resource.thumb ?? ""
        }
        //Only if top level resource is a Manifest.  If it is a Canvas, you will not know the Manifest id so easily here.
        if (!geoJSON.properties.hasOwnProperty("manifest")) {
            if (topLevelResourceType === "Manifest") {
                geoJSON.properties.manifest = VIEWER.resource["@id"] ?? VIEWER.resource["id"] ?? "Yikes"
            }
        }
        //Only if top level resource is a Canvas.  If it is a Manifest, you will not know the Canvas id so easily here.
        if (!geoJSON.properties.hasOwnProperty("canvas")) {
            if (topLevelResourceType === "Canvas") {
                geoJSON.properties.canvas = VIEWER.resource["@id"] ?? VIEWER.resource["id"] ?? "Sadness"
            }
        }
        return geoJSON
    })
    //Abstracted.  Maybe one day you want to VIEWER.initializeOtherWebMap(latlong, allGeos)
    VIEWER.initializeLeaflet(latlong, allGeos)
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
    if (feature.properties) {
        if (feature.properties.label && Object.keys(feature.properties.label).length) {
            popupContent += `<div class="featureInfo">`
            //let label = feature.properties.label.en[0] ?? "No english label."
            //Brute force loop all the languages and add them together, separated by their language keys.
            for (const langKey in feature.properties.label) {
                let allLabelsForLang =
                    feature.properties.label[langKey].length > 1 ? feature.properties.label[langKey].join(", ") :
                    feature.properties.label[langKey]
                popupContent += `<b>${langKey}: ${allLabelsForLang}</b></br>`
            }
            popupContent += `</div>`
        }
        if (feature.properties.summary && Object.keys(feature.properties.summary).length) {
            popupContent += `<div class="featureInfo">`
            //let summary = feature.properties.summary.en[0] ?? "No english label."
            //Brute force loop all the languages and add them together, separated by their language keys.
            for (const langKey in feature.properties.summary) {
                let allSummariesForLang =
                    feature.properties.summary[langKey].length > 1 ? feature.properties.summary[langKey].join(", ") :
                    feature.properties.summary[langKey]
                popupContent += `<b>${langKey}: ${allSummariesForLang}</b></br>`
            }
            popupContent += `</div>`
        }
        if (feature.properties.thumb) {
            let thumbnail = feature.properties.thumb ?? ""
            popupContent += `<img src="${thumbnail}"\></br>`
        }
        if (feature.properties.manifest) {
            let manifest = feature.properties.manifest ?? ""
            popupContent += `<a href="https://projectmirador.org/embed/?iiif-content=${manifest}" target="_blank"><img src="https://www.qdl.qa/sites/all/themes/QDLTheme/css/img/logo_mirador.png"/></a>`
            popupContent += `<a href="https://uv-v3.netlify.app/#?c=&m=&s=&cv=&manifest=${manifest}" target="_blank"><img src="https://www.qdl.qa/sites/all/themes/QDLTheme/css/img/logo_uv.png"/></a>`
        }
        layer.bindPopup(popupContent)
    }
}

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