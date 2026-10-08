// The small map on a listing page: a pin, or a circle when the owner gave only an area.
"use strict";

(function () {
  roamer.localTimes();

  var element = document.getElementById("listing-map");
  if (!element) return;

  var at = L.latLng(Number(element.dataset.lat), Number(element.dataset.lng));
  var map = roamer.baseMap(element, at, 16, { scrollWheelZoom: false });

  if (element.dataset.approximate === "true") {
    var radius = Number(element.dataset.radius);
    // Fit to the point and radius, not to circle.getBounds(): that only works once the
    // circle is on a map with a view, and asking it earlier left the map grey and empty.
    map.fitBounds(at.toBounds(radius * 2), { padding: [20, 20] });
    L.circle(at, { radius: radius, color: "#c2410c", weight: 2, fillOpacity: 0.15 }).addTo(map);
  } else {
    L.marker(at).addTo(map);
  }
})();
