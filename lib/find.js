var fs = require('fs')

var geobuf = require('geobuf')
var inside = require('turf-inside')
var moment = require('moment-timezone')
var Pbf = require('pbf')
var point = require('turf-point')
var polyline = require('@mapbox/polyline')

var tzData = require('../data/index.json')


var loadFeatures = function(quadPos) {
  // exact boundaries saved in file
  // parse geojson for exact boundaries
  var filepath = quadPos.split('').join('/')
  var data = new Pbf(fs.readFileSync(__dirname + '/../data/' + filepath + '/geo.buf'))
  var geoJson = geobuf.decode(data)
  return geoJson;
}

var onDemandFeatureProvider = function(quadPos) {
  return loadFeatures(quadPos)
}

var createPreloadedFeatureProvider = function() {
  var toPolyline = function(geoJsonCoordinates) {
    var result = []
    for(var i0=0; i0<geoJsonCoordinates.length; i0++) {
      result.push([])
      if(typeof geoJsonCoordinates[i0][0][0] === 'number') {
        var encoded = polyline.encode(geoJsonCoordinates[i0])
        result[i0].push(encoded)
      }
      else {
        for(var i1=0; i1<geoJsonCoordinates[i0].length; i1++) {
          result[i0].push([])
          var encoded = polyline.encode(geoJsonCoordinates[i0][i1])
          result[i0][i1].push(encoded)
        }
      }
    }
    return result;
  }
  var toGeoJsonCoordinates = function(polylineStructure) {
    var result = [];
    for(var i0=0; i0<polylineStructure.length; i0++) {
      result.push([]);
      if(typeof polylineStructure[i0] === 'string') {
        var decoded = polyline.decode(polylineStructure[i0]);
        console.log("outer decoded is", decoded);
        result[i0].push(decoded)
      }
      else {
        for(var i1=0; i1<polylineStructure[i0].length; i1++) {
          result[i0].push([])
          console.log(typeof polylineStructure[i0][i1]);
          if(typeof polylineStructure[i0][i1] !== 'string') {
            console.log(JSON.stringify(polylineStructure[i0][i1]));
          }
          //var decoded = polyline.decode(polylineStructure[i0][i1])
          //console.log("inner decoded is", decoded);
          //result[i0][i1].push(decoded)
        }
      }
    }
    return result;
  }

  var preloadedFeatures = {}
  var preloadFeaturesRecursive = function(curTzData, quadPos) {
    if (!curTzData) {
    } else if (curTzData === 'f') {
      var geoJson = loadFeatures(quadPos)

      for(var featureIndex=0; featureIndex<geoJson.features.length; featureIndex++) {
        geoJson.features[featureIndex].geometry.coordinates = toPolyline(geoJson.features[featureIndex].geometry.coordinates);
      }
      preloadedFeatures[quadPos] = geoJson
    } else if (typeof curTzData === 'number') {
    } else {
      Object.getOwnPropertyNames(curTzData).forEach(function(value, index) {
        preloadFeaturesRecursive(curTzData[value], quadPos + value)
      })
    }
  }
  preloadFeaturesRecursive(tzData.lookup, '')

  return function(quadPos) {
    // Need to be super careful here to not alter the original storage object with the unpacked polyline
    // (It would cause memory usage to grow substantially over time)
    // But we still want to preserve all the properties of the original object, without having to hard-code expectations
    var clone = {};
    Object.assign(clone, preloadedFeatures[quadPos])
    clone.features = [];
    for(var featureIndex=0; featureIndex<preloadedFeatures[quadPos].features.length; featureIndex++) {
      var feature = preloadedFeatures[quadPos].features[featureIndex];
      clone.features.push({})
      Object.assign(clone.features[featureIndex], feature);
      clone.features[featureIndex].geometry = {};
      Object.assign(clone.features[featureIndex].geometry, feature.geometry);
      clone.features[featureIndex].geometry.coordinates = toGeoJsonCoordinates(feature.geometry.coordinates);
    }
    return clone;
  }
}

var getTimezone = function (lat, lon, options) {
  lat = parseFloat(lat)
  lon = parseFloat(lon)
  options = options || {}
  options.featureProvider = options.featureProvider || onDemandFeatureProvider

  var err

  // validate latitude
  if (isNaN(lat) || lat > 90 || lat < -90) {
    err = new Error('Invalid latitude: ' + lat)
    throw err
  }

  // validate longitude
  if (isNaN(lon) || lon > 180 || lon < -180) {
    err = new Error('Invalid longitude: ' + lon)
    throw err
  }

  // fix edges of the world
  if (lat === 90) {
    lat = 89.9999
  } else if (lat === -90) {
    lat = -89.9999
  }

  if (lon === 180) {
    lon = 179.9999
  } else if (lon === -180) {
    lon = -179.9999
  }

  var pt = point([lon, lat])
  var quadData = {
    top: 90,
    bottom: -90,
    left: -180,
    right: 180,
    midLat: 0,
    midLon: 0
  }
  var quadPos = ''
  var curTzData = tzData.lookup

  while (true) {
    // calculate next quadtree position
    var nextQuad
    if (lat >= quadData.midLat && lon >= quadData.midLon) {
      nextQuad = 'a'
      quadData.bottom = quadData.midLat
      quadData.left = quadData.midLon
    } else if (lat >= quadData.midLat && lon < quadData.midLon) {
      nextQuad = 'b'
      quadData.bottom = quadData.midLat
      quadData.right = quadData.midLon
    } else if (lat < quadData.midLat && lon < quadData.midLon) {
      nextQuad = 'c'
      quadData.top = quadData.midLat
      quadData.right = quadData.midLon
    } else {
      nextQuad = 'd'
      quadData.top = quadData.midLat
      quadData.left = quadData.midLon
    }

    // console.log(nextQuad)
    curTzData = curTzData[nextQuad]
    // console.log()
    quadPos += nextQuad

    // analyze result of current depth
    if (!curTzData) {
      // no timezone in this quad
      return null
    } else if (curTzData === 'f') {
      // get exact boundaries
      var geoJson = options.featureProvider(quadPos)

      for (var i = 0; i < geoJson.features.length; i++) {
        if (inside(pt, geoJson.features[i])) {
          return geoJson.features[i].properties.tzid
        }
      }

      // not within subarea, therefore no valid timezone
      return null
    } else if (typeof curTzData === 'number') {
      // exact match found
      return tzData.timezones[curTzData]
    } else if (typeof curTzData !== 'object') {
      // not another nested quad index, throw error
      err = new Error('Unexpected data type')
      throw err
    }

    // calculate next quadtree depth data
    quadData.midLat = (quadData.top + quadData.bottom) / 2
    quadData.midLon = (quadData.left + quadData.right) / 2
  }
}

module.exports = {
  timezone: getTimezone,
  timezoneMoment: function (lat, lon, timeString, options) {
    var tzName = getTimezone(lat, lon, options)
    if (!tzName) {
      return tzName
    }
    if (timeString) {
      return moment(timeString).tz(tzName)
    } else {
      return moment().tz(tzName)
    }
  },
  createPreloadedFeatureProvider: createPreloadedFeatureProvider
}
