/* 
 * @author Bryan Haberberger
 * 
 * 
 */

GEOLOCATOR = {}

GEOLOCATOR.resource = {}

GEOLOCATOR.mymap={}

GEOLOCATOR.updateGeometry=function(event, clickedLat, clickedLong) {
    event.preventDefault()
    let lat = clickedLat ? clickedLat : leafLat.value
    lat = parseInt(lat * 1000000) / 1000000
    let long =  clickedLong ? clickedLong : leafLong.value
    long= parseInt(long * 1000000) / 1000000
    if (lat && long) {
        GEOLOCATOR.mymap.setView([lat, long], 16)
    }
    leafLat.value = lat
    leafLong.value = long
}

/**
 * Given the URI of a web resource, resolve it and draw the GeoJSON-LD within.
 * @param {type} URI of the web resource to dereference and consume.
 * @return {Array}
 */
GEOLOCATOR.consumeForGeoJSON = async function(dataURL){
    let geoJSONFeatures = []
    let dataObj = await fetch(dataURL)
        .then(resp => resp.json())
        .then(man => {return man})
        .catch(err => {return null})
    if(dataObj){
        GEOLOCATOR.resource = JSON.parse(JSON.stringify(dataObj))
        let resourceType = dataObj.type ?? dataObj["@type"] ?? "Yikes"
        /**
         * @context verification and validation.  This could probably be made better with a helper function.
         */
        switch(resourceType){
            case "Collection":
            case "Manifest":
            case "Range":
            case "Canvas":
                if(typeof dataObj["@context"] === "string" && 
                        (dataObj["@context"] !== "https://iiif.io/api/presentation/3/context.json" || dataObj["@context"] !== "http://iiif.io/api/presentation/3/context.json")
                    ){
                    alert("The IIIF resource type does not have the correct @context, it must be Presentation API 3.")
                    return geoJSONFeatures
                }
                else if (Array.isArray(dataObj["@context"]) && dataObj["@context"].length > 0){
                    if(!(dataObj["@context"].includes("http://iiif.io/api/presentation/3/context.json") || dataObj["@context"].includes("https://iiif.io/api/presentation/3/context.json"))){
                        alert("The IIIF resource type does not have the correct @context.")
                        return geoJSONFeatures
                    }
                }
                else if(typeof dataObj["@context"] === "object"){
                    alert("We cannot support custom context objects.  You can include multiple context JSON files.  Please include the latest IIIF Presentation API 3 context.")
                    return geoJSONFeatures
                }
            break
            default:
                alert("The data resource type is not supported.  It must be a IIIF Presentation API 3 'Manifest', 'Canvas', 'Annotation' or 'AnnotationPage'.  Please check the type.")
        }
        let hasNavPlace = false

        //Continue on and process
        if(resourceType === "Collection"){

        }
        else if(resourceType === "Manifest"){
            let manifestGeo = {}
            let geos= []
            let itemsGeos = []
            if(dataObj.hasOwnProperty("navPlace")){
                /**
                 * Remember these are feature collections.  We just want to move forward with the features.
                 * We are doing this so we can combine FeatureCollections with child items' features
                 * If we only draw specifically for the resource handed in and not its children, we could move forward with the feature collection.
                 */ 
                if(dataObj.navPlace.features){
                    //It is embedded
                    manifestGeo = dataObj.navPlace.features
                    //Is there something custom you want to do?  Do you want to add Manifest data to the GeoJSON.properties?
                    manifestGeo = manifestGeo.map(f => {
                        //dataObj is the Manifest.  Grab a property, like seeAlso
                        //f.properties.seeAlso = dataObj.seeAlso 
                        if(!f.properties.thumb){
                            //Then lets grab the image URL from the painting annotation
                            if(dataObj.items.length && dataObj.items[0].items.length && dataObj.items[0].items[0].items.length){
                                if(dataObj.items[0].items[0].items[0].body){
                                    let thumburl = dataObj.items[0].items[0].items[0].body.id ?? ""
                                    f.properties.thumb = thumburl
                                }
                            }
                            
                        }
                        return f
                    })
                }
                else{
                    //It could be referenced
                    let fid = dataObj.navPlace.id ?? dataObj.navPlace["@id"] ?? "Yikes"
                    if(fid){
                        manifestGeo = await fetch(fid)
                        .then(resp => resp.json())
                        .then(featureCollection => {
                            //Is there something custom you want to do?  Do you want to add Manifest data to the GeoJSON.properties?
                            let collectionGeo = featureCollection.features
                            collectionGeo = collectionGeo.map(f => {
                                //dataObj is the Canvas.  Grab a property, like seeAlso
                                //f.properties.seeAlso = dataObj.seeAlso 
                                if(!f.properties.thumb){
                                    //Then lets grab the image URL from the painting annotation
                                    if(dataObj.items.length && dataObj.items[0].items.length && dataObj.items[0].items[0].items.length){
                                        if(dataObj.items[0].items[0].items[0].body){
                                            let thumburl = dataObj.items[0].items[0].items[0].body.id ?? ""
                                            f.properties.thumb = thumburl
                                        }
                                    }
                                    
                                }
                                return f
                            })
                            return collectionGeo
                        })
                        .catch(err => {
                            console.error(err)
                            return []
                        })    
                    }
                }
                geos.push(manifestGeo)
            }
            /*
             * Also the Canvases??
            */
            if(dataObj.hasOwnProperty("items") && dataObj.items.length){
                itemsGeos = dataObj.items
                    .filter(item => {
                        //We only care about Canvases, I think.  Ignore everything else
                        let itemType = item.type ?? item["@type"] ?? "Yikes"
                        return (item.hasOwnProperty("navPlace") && itemType === "Canvas")
                    })
                    .map(canvas => {
                        //Is there something custom you want to do?  Do you want to add Canvas data to the features?
                        let canvasGeo = canvas.navPlace.features
                        canvasGeo = canvasGeo.map(f => {
                            //Grab a property from the Canvas, like seeAlso
                            //f.properties.seeAlso = canvas.seeAlso 
                            if(!f.properties.thumb){
                                //Then lets grab the image URL from the painting annotation
                                if(dataObj.items.length && dataObj.items[0].items.length){
                                    if(dataObj.items[0].items[0].body){
                                        let thumburl = dataObj.items[0].items[0].body.id ?? ""
                                        f.properties.thumb = thumburl
                                    }
                                }
                            }
                            return f
                        })
                        return canvasGeo
                    })
            }
            //Yes, the internal items too...draw it all until we are given a compelling reason not to.
            //If there is a compelling reason, perhaps this could be a config option
            geoJSONFeatures = [...geos, ...itemsGeos]
            return geoJSONFeatures
        }
        else if (resourceType === "Range"){

        }
        else if(resourceType === "Canvas"){
            let canvasGeo = {}
            if(dataObj.hasOwnProperty("navPlace")){
                hasNavPlace = true
                //Remember these are feature collections.  We just want to move forward with the features.
                if(dataObj.navPlace.features){
                    //It is embedded
                    canvasGeo = dataObj.navPlace.features
                    //Is there something custom you want to do?  Do you want to add Canvas data to the GeoJSON.properties?
                    geoJSONFeatures = canvasGeo.map(f => {
                        //dataObj is the Manifest.  Grab a property, like seeAlso
                        //f.properties.seeAlso = dataObj.seeAlso 
                        if(!f.properties.thumb){
                            //Then lets grab the image URL from the painting annotation
                            if(dataObj.items.length && dataObj.items[0].items.length){
                                if(dataObj.items[0].items[0].body){
                                    let thumburl = dataObj.items[0].items[0].body.id ?? ""
                                    f.properties.thumb = thumburl
                                }
                            }
                        }
                        return f
                    })
                }
                else{
                    //It could be referenced
                    let fid = dataObj.navPlace.id ?? dataObj.navPlace["@id"] ?? ""
                    if(fid){
                        geoJSONFeatures = await fetch(fid)
                        .then(resp => resp.json())
                        .then(featureCollection => {
                            let collectionGeo = featureCollection.features
                            //Is there something custom you want to do?  Do you want to add Canvas data to the GeoJSON.properties?
                            collectionGeo = collectionGeo.map(f => {
                                //dataObj is the Canvas.  Grab a property, like seeAlso
                                //f.properties.seeAlso = dataObj.seeAlso 
                                if(!f.properties.thumb){
                                    //Then lets grab the image URL from the painting annotation
                                    if(dataObj.items.length && dataObj.items[0].items.length){
                                        if(dataObj.items[0].items[0].body){
                                            let thumburl = dataObj.items[0].items[0].body.id ?? ""
                                            f.properties.thumb = thumburl
                                        }
                                    }
                                }
                                return f
                            })
                            return collectionGeo
                        })
                        .catch(err => {
                            console.error(err)
                            return []
                        })    
                    }
                }
                return geoJSONFeatures
            }
        }
        else{
            // There is no way for me to get the features, I don't know where to look.
            alert("Unable to get GeoJSON Features.  The resource type is unknown and I don't know where to look.")
            return geoJSONFeatures
        }
    }
    else{
        console.error("URI did not resolve and so was not dereferencable.  There is no data.")
        return geoJSONFeatures
    }
}

/**
 * Initialize the application by feeding it a IIIF Resource
 * @param {type} view
 * @return {undefined}
 */
GEOLOCATOR.init =  async function(){
    let latlong = [12, 12] //default starting coords
    let geos = []
    let resource = {}
    //document.getElementById("leafLat").oninput = GEOLOCATOR.updateGeometry
    //document.getElementById("leafLong").oninput = GEOLOCATOR.updateGeometry
    let geoJsonData = []
    let IIIFdataInURL = GEOLOCATOR.getURLVariable("iiif-content")
    let dataInURL = IIIFdataInURL
    if(!IIIFdataInURL){
        //Support other patterns?
        dataInURL = GEOLOCATOR.getURLVariable("data-uri")
    }
    if(dataInURL){
        //Let's pretend consumeForGeoJSON does everything we want with each feature's properties.
        //For now, I have added the properties to the GeoJSON in canvas_navplace.json
        //GEOLOCATOR.resource will be the resolved web resource
        geoJsonData = await GEOLOCATOR.consumeForGeoJSON(dataInURL)
        .then(geoMarkers => {return geoMarkers})
        .catch(err => {
            console.error(err)
            return []
        })
    }
    let formattedGeoJsonData = geoJsonData.flat(1) //AnnotationPages and FeatureCollections cause arrays in arrays.  
    let topLevelResourceType = GEOLOCATOR.resource["@type"] ?? GEOLOCATOR.resource.type ?? "Yikes"
    let allGeos = formattedGeoJsonData.map(function(geoJSON){ 
        //Note that it is probably best you format the properties in consumeForGeoJSON() before getting here.
        //Top level resource agnostic
        if(!geoJSON.properties.hasOwnProperty("summary")){
            geoJSON.properties.summary = GEOLOCATOR.resource.summary ?? ""
        }
        //Top level resource agnostic
        if(!geoJSON.properties.hasOwnProperty("label")){
            geoJSON.properties.label = GEOLOCATOR.resource.label ?? ""
        }
        //Top level resource agnostic
        if(!geoJSON.properties.hasOwnProperty("thumb")){
            geoJSON.properties.thumb = GEOLOCATOR.resource.thumb ?? ""
        }
        //Only if top level resource is a Manifest.  If it is a Canvas, you will not know the Manifest id so easily here.
        if(!geoJSON.properties.hasOwnProperty("manifest")){
            if(topLevelResourceType === "Manifest"){
                geoJSON.properties.manifest = GEOLOCATOR.resource["@id"] ?? GEOLOCATOR.resource["id"] ?? "Yikes"
            }
        }
        //Only if top level resource is a Canvas.  If it is a Manifest, you will not know the Canvas id so easily here.
        if(!geoJSON.properties.hasOwnProperty("canvas")){
            if(topLevelResourceType === "Canvas"){
                geoJSON.properties.canvas = GEOLOCATOR.resource["@id"] ?? GEOLOCATOR.resource["id"] ?? "Sadness"
            }
        }
        return geoJSON
    })
    GEOLOCATOR.initializeLeaflet(latlong, allGeos)
}
    
GEOLOCATOR.initializeLeaflet = async function(coords, geoMarkers){
    GEOLOCATOR.mymap = L.map('leafletInstanceContainer')   
    L.tileLayer('https://api.tiles.mapbox.com/v4/{id}/{z}/{x}/{y}.png?access_token=pk.eyJ1IjoidGhlaGFiZXMiLCJhIjoiY2pyaTdmNGUzMzQwdDQzcGRwd21ieHF3NCJ9.SSflgKbI8tLQOo2DuzEgRQ', {
        attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors, <a href="https://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, Imagery © <a href="https://www.mapbox.com/">Mapbox</a>',
        maxZoom: 19,
        id: 'mapbox.satellite', //mapbox.streets
        accessToken: 'pk.eyJ1IjoidGhlaGFiZXMiLCJhIjoiY2pyaTdmNGUzMzQwdDQzcGRwd21ieHF3NCJ9.SSflgKbI8tLQOo2DuzEgRQ'
    }).addTo(GEOLOCATOR.mymap);
    GEOLOCATOR.mymap.setView(coords,2);

    L.geoJSON(geoMarkers, {
        pointToLayer: function (feature, latlng) {
            let appColor = "#08c49c"
            return L.circleMarker(latlng, {
                radius: 8,
                fillColor: appColor,
                color: "#000",
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8
            });
        },
        onEachFeature: GEOLOCATOR.pointEachFeature
    }).addTo(GEOLOCATOR.mymap)
    leafletInstanceContainer.style.backgroundImage = "none"
    loadingMessage.classList.add("is-hidden")

}

GEOLOCATOR.pointEachFeature = function (feature, layer) {
    let popupContent = ""
    if (feature.properties){
        if(feature.properties.label && Object.keys(feature.properties.label).length){
            popupContent += `<div class="featureInfo">`
            //let label = feature.properties.label.en[0] ?? "No english label."
            //Brute force loop all the languages and add them together, separated by their language keys.
            for(const langKey in feature.properties.label){
                let allLabelsForLang = 
                    feature.properties.label[langKey].length > 1 ? feature.properties.label[langKey].join(", ") :
                    feature.properties.label[langKey]
                popupContent += `<b>${langKey}: ${allLabelsForLang}</b></br>`
            }
            popupContent += `</div>`
        }
        if(feature.properties.summary && Object.keys(feature.properties.summary).length){
            popupContent += `<div class="featureInfo">`
            //let summary = feature.properties.summary.en[0] ?? "No english label."
            //Brute force loop all the languages and add them together, separated by their language keys.
            for(const langKey in feature.properties.summary){
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

GEOLOCATOR.goToCoords = function(event){
    if(leafLat.value && leafLong.value){
        let coords = [leafLat.value, leafLong.value]
        GEOLOCATOR.mymap.flyTo(coords,8)
        document.getElementById("currentCoords").innerHTML = "["+coords.toString()+"]"
        window.scrollTo(0, leafletInstanceContainer.offsetTop - 5)
    }
}
                      
/**
 * Check if the given object has a valid IIIF context associated with it
 * @param {type} obj
 * @return {Boolean}
 */
GEOLOCATOR.checkForIIIF = function(targetObj){
    if(targetObj["@context"]){
        if(Array.isArray(targetObj["@context"])){
            return targetObj["@context"].includes("http://iiif.io/api/presentation/3/context.json") || targetObj["@context"].includes("http://iiif.io/api/presentation/2/context.json")
        }
        else if(typeof targetObj["@context"] === "string"){
           return targetObj["@context"] === "http://iiif.io/api/presentation/3/context.json" || targetObj["@context"] === "http://iiif.io/api/presentation/2/context.json" 
        }
    }
    return false
}

GEOLOCATOR.getURLVariable = function(variable)
    {
        var query = window.location.search.substring(1);
        var vars = query.split("&");
        for (var i=0;i<vars.length;i++) {
                var pair = vars[i].split("=");
                if(pair[0] == variable){return pair[1];}
        }
        return(false);
    }
