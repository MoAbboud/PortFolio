// The listing form: a map to drop and drag the last-seen pin, "use my location", and the
// browser's local date and time turned into an unambiguous UTC timestamp before posting.
"use strict";

(function () {
  var form = document.getElementById("listing-form");
  var element = document.getElementById("pick-map");
  var latInput = document.getElementById("last_seen_lat");
  var lngInput = document.getElementById("last_seen_lng");
  var localInput = document.getElementById("last_seen_local");
  var isoInput = document.getElementById("last_seen_at");

  var map = roamer.baseMap(element).setView(
    [Number(element.dataset.lat), Number(element.dataset.lng)],
    Number(element.dataset.zoom)
  );
  var marker = null;

  function place(latlng) {
    var lat = Number(latlng.lat.toFixed(6));
    var lng = Number(L.Util.wrapNum(latlng.lng, [-180, 180], true).toFixed(6));
    latInput.value = lat;
    lngInput.value = lng;
    if (marker) {
      marker.setLatLng([lat, lng]);
    } else {
      marker = L.marker([lat, lng], { draggable: true }).addTo(map);
      marker.on("dragend", function () { place(marker.getLatLng()); });
    }
  }

  map.on("click", function (event) { place(event.latlng); });

  // After a failed submit the page comes back with the pin's coordinates still in the
  // hidden fields; put the pin back where it was.
  if (latInput.value && lngInput.value) {
    var restored = L.latLng(Number(latInput.value), Number(lngInput.value));
    place(restored);
    map.setView(restored, 16);
  }

  var locate = document.getElementById("use-location");
  if (!navigator.geolocation) {
    locate.hidden = true;
  } else {
    locate.addEventListener("click", function () {
      locate.disabled = true;
      navigator.geolocation.getCurrentPosition(
        function (position) {
          var here = L.latLng(position.coords.latitude, position.coords.longitude);
          place(here);
          map.setView(here, 17);
          locate.disabled = false;
        },
        function () {
          locate.disabled = false;
          locate.textContent = "Location not available - click the map instead";
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }

  // Default "when" to now, in the browser's own time zone, if nothing is filled in yet.
  if (!localInput.value) {
    var now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    localInput.value = now.toISOString().slice(0, 16);
  }

  form.addEventListener("submit", function () {
    // datetime-local has no time zone. new Date() reads it in the browser's zone, and
    // toISOString() sends it as UTC, so the server never has to guess whose evening it was.
    isoInput.value = localInput.value ? new Date(localInput.value).toISOString() : "";
  });
})();
