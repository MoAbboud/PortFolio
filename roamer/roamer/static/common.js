// Shared by every page that draws a map. Plain script, no modules, no build step.
"use strict";

window.roamer = (function () {
  var ATTRIBUTION =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  // OpenStreetMap's own tile server. Free, no key, under its usage policy: low traffic,
  // attribution shown, no bulk downloading. A demo is well inside that.
  function baseMap(element, options) {
    var map = L.map(element, options || {});
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: ATTRIBUTION,
    }).addTo(map);
    return map;
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

  return { baseMap: baseMap, pinIcon: pinIcon, timeAgo: timeAgo, localTimes: localTimes };
})();
