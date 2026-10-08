// The small map on a listing page: a pin, or a circle when the owner gave only an area.
"use strict";

(function () {
  roamer.localTimes();

  var element = document.getElementById("listing-map");
  if (!element) return;

  var at = L.latLng(Number(element.dataset.lat), Number(element.dataset.lng));
  var map = roamer.baseMap(element, at, 16, { scrollWheelZoom: false });

  // The search circles, when the species has one: where most lost animals of this kind were
  // found in a published study. Drawn first, so the pin or the approximate area sits on top.
  var outer = Number(element.dataset.searchOuter || 0);
  var inner = Number(element.dataset.searchInner || 0);
  if (outer) {
    L.circle(at, {
      radius: outer, color: "#2b2f36", weight: 1.5, dashArray: "6 6",
      fillColor: "#2b2f36", fillOpacity: 0.05, interactive: false,
    }).addTo(map);
    L.circle(at, {
      radius: inner, color: "#2b2f36", weight: 1.5,
      fillColor: "#2b2f36", fillOpacity: 0.08, interactive: false,
    }).addTo(map);
  }

  var approximate = element.dataset.approximate === "true";
  var radius = Number(element.dataset.radius);
  // Fit to computed bounds, not to circle.getBounds(): that only works once the circle is on
  // a map with a view, and asking it earlier left the map grey and empty.
  var fitTo = Math.max(outer, approximate ? radius : 0);
  if (fitTo) {
    map.fitBounds(at.toBounds(fitTo * 2), { padding: [20, 20] });
  }
  if (approximate) {
    L.circle(at, { radius: radius, color: "#c2410c", weight: 2, fillOpacity: 0.15 }).addTo(map);
  } else {
    L.marker(at).addTo(map);
  }
})();
