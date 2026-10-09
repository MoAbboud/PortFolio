// The "home" answer: an optional pin for where the animal was found, and when.
// The map is only drawn when the details are opened - a hidden Leaflet map has no size.
"use strict";

(function () {
  var details = document.querySelector(".found-details");
  var element = document.getElementById("found-pick-map");
  var latInput = document.getElementById("found_lat");
  var lngInput = document.getElementById("found_lng");
  var clear = document.getElementById("found-clear");
  var localInput = document.getElementById("found_local");
  var isoInput = document.getElementById("found_at");
  var form = document.getElementById("home-form");
  if (!details || !element) return;

  var map = null;
  var marker = null;

  function place(latlng) {
    latInput.value = latlng.lat.toFixed(6);
    lngInput.value = L.Util.wrapNum(latlng.lng, [-180, 180], true).toFixed(6);
    if (marker) {
      marker.setLatLng(latlng);
    } else {
      marker = L.marker(latlng, { draggable: true }).addTo(map);
      marker.on("dragend", function () { place(marker.getLatLng()); });
    }
    clear.hidden = false;
  }

  function open() {
    if (map) { map.invalidateSize(); return; }
    var lastSeen = [Number(element.dataset.lat), Number(element.dataset.lng)];
    map = roamer.baseMap(element, lastSeen, 15);
    // Where it was last seen, for reference. Not a guess at where it was found.
    L.circleMarker(lastSeen, { radius: 6, color: "#c2410c", weight: 2, fillOpacity: 0.2 })
      .bindTooltip("Last seen here").addTo(map);
    map.on("click", function (event) { place(event.latlng); });
  }

  details.addEventListener("toggle", function () { if (details.open) open(); });
  if (details.open) open();

  clear.addEventListener("click", function () {
    if (marker) { map.removeLayer(marker); marker = null; }
    latInput.value = "";
    lngInput.value = "";
    clear.hidden = true;
  });

  form.addEventListener("submit", function () {
    // datetime-local has no zone; sent as UTC from the browser's own zone. Empty means "now".
    isoInput.value = localInput.value ? new Date(localInput.value).toISOString() : "";
  });
})();
