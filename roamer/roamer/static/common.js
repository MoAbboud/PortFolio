// Shared by every page that draws a map. Plain script, no modules, no build step.
"use strict";

window.roamer = (function () {
  var OSM =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  // OpenFreeMap's Positron: white and grey, so the pins are the colour on the page. Free,
  // no key, no account, commercial use allowed; attribution required, and given here.
  var POSITRON = "https://tiles.openfreemap.org/styles/positron";
  var POSITRON_ATTRIBUTION =
    '<a href="https://openfreemap.org">OpenFreeMap</a> ' +
    '&copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> ' +
    "Data from " + OSM;

  function canDrawVector() {
    if (!window.maplibregl || !L.maplibreGL) return false;
    try {
      var canvas = document.createElement("canvas");
      return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
    } catch (e) {
      return false;
    }
  }

  // The view has to be set before the base map is added: the MapLibre layer reads the map's
  // centre as it is added and throws on a map that has none. The first version added the
  // layer first, which the old raster tiles tolerated, and the map page came up blank.
  function baseMap(element, center, zoom, options) {
    // maxZoom on the map itself: markercluster refuses a map without one ("Map has no
    // maxZoom specified"), and only the raster layer used to supply it.
    var map = L.map(element, L.extend({ maxZoom: 19 }, options)).setView(center, zoom);
    if (canDrawVector()) {
      try {
        L.maplibreGL({ style: POSITRON, attribution: POSITRON_ATTRIBUTION }).addTo(map);
        return map;
      } catch (e) {
        // Fall through to the raster tiles. A blank map is the one outcome not allowed.
      }
    }
    // The fallback: OpenStreetMap's own raster tiles, greyed out with CSS (.tiles-muted in
    // style.css) so the page looks the same in spirit. Free, no key, under OSM's usage
    // policy.
    element.classList.add("tiles-muted");
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: OSM,
    }).addTo(map);
    return map;
  }

  // Cluster bubbles in the site's own ink rather than markercluster's green, yellow and
  // orange, which fought the muted map.
  function clusterIcon(cluster) {
    var count = cluster.getChildCount();
    var size = count < 10 ? 34 : count < 100 ? 40 : 46;
    return L.divIcon({
      className: "",
      html: '<div class="cluster" style="width:' + size + "px;height:" + size +
        "px;line-height:" + size + 'px">' + count + "</div>",
      iconSize: [size, size],
    });
  }

  function pinIcon(species, approximate) {
    var letter = { dog: "D", cat: "C", other: "?" }[species] || "?";
    return L.divIcon({
      className: "",
      html:
        '<div class="pin pin-' + species + (approximate ? " pin-approximate" : "") + '">' +
        letter + "</div>",
      iconSize: [26, 26],
      iconAnchor: [13, 13],
      popupAnchor: [0, -14],
    });
  }

  function timeAgo(iso) {
    var seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    var units = [["day", 86400], ["hour", 3600], ["minute", 60]];
    for (var i = 0; i < units.length; i++) {
      if (seconds >= units[i][1]) {
        var n = Math.floor(seconds / units[i][1]);
        return n + " " + units[i][0] + (n === 1 ? "" : "s") + " ago";
      }
    }
    return "just now";
  }

  // <time data-local datetime="..."> gets the viewer's own local date and time, which the
  // server cannot know.
  function localTimes() {
    var nodes = document.querySelectorAll("time[data-local]");
    for (var i = 0; i < nodes.length; i++) {
      var when = new Date(nodes[i].getAttribute("datetime"));
      nodes[i].textContent =
        "(" + when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) + ")";
    }
  }

  return {
    baseMap: baseMap,
    clusterIcon: clusterIcon,
    pinIcon: pinIcon,
    timeAgo: timeAgo,
    localTimes: localTimes,
  };
})();
