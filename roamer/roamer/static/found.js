// "I found an animal": a point in, the nearest lost animals out. Every piece of listing text
// goes in with textContent - names are typed by strangers.
"use strict";

(function () {
  var form = document.getElementById("found-form");
  var status = document.getElementById("found-status");
  var placesList = document.getElementById("found-places");
  var results = document.getElementById("found-results");
  var list = document.getElementById("found-list");
  var none = document.getElementById("found-none");
  var mapElement = document.getElementById("found-map");
  var species = document.getElementById("species");
  var radius = document.getElementById("radius");
  var locate = document.getElementById("use-location");
  var includeStale = document.getElementById("include-stale");

  var map = null;
  var layer = null;
  var here = null;

  var SPECIES = { dog: "Dog", cat: "Cat", other: "Animal" };

  function say(text) { status.textContent = text; }

  function distanceText(m) {
    return m < 1000 ? Math.round(m / 10) * 10 + " m away" : (m / 1000).toFixed(1) + " km away";
  }

  function ensureMap() {
    if (map) return;
    map = roamer.baseMap(mapElement, [Number(mapElement.dataset.lat), Number(mapElement.dataset.lng)],
                         Number(mapElement.dataset.zoom), { scrollWheelZoom: false });
    layer = L.layerGroup().addTo(map);
  }

  function card(pin) {
    var item = document.createElement("li");
    item.className = "found-card";
    var link = document.createElement("a");
    link.href = pin.url;

    if (pin.thumb_url) {
      var img = document.createElement("img");
      img.src = pin.thumb_url;
      img.alt = "";
      link.appendChild(img);
    } else {
      var blank = document.createElement("div");
      blank.className = "found-card-blank";
      blank.textContent = "No photo";
      link.appendChild(blank);
    }

    var text = document.createElement("div");
    var title = document.createElement("strong");
    title.textContent = (pin.name || "Name not known") + " - " +
      (SPECIES[pin.species] || "Animal").toLowerCase();
    text.appendChild(title);

    var far = document.createElement("p");
    far.textContent = distanceText(pin.distance_m) + (pin.approximate ? " (approximate area)" : "");
    text.appendChild(far);

    var seen = document.createElement("p");
    seen.textContent = "Last seen " + roamer.timeAgo(pin.last_seen_at) +
      (pin.area_label ? " - " + pin.area_label : "");
    text.appendChild(seen);

    var badge = document.createElement("span");
    if (pin.verified) {
      badge.className = "badge badge-verified badge-small";
      badge.textContent = "Verified";
    } else {
      badge.className = "badge badge-quiet badge-small";
      badge.textContent = pin.last_confirmed_at
        ? "Not confirmed for " + roamer.timeAgo(pin.last_confirmed_at).replace(" ago", "")
        : "Not confirmed";
    }
    text.appendChild(badge);
    link.appendChild(text);
    item.appendChild(link);
    return item;
  }

  function search() {
    if (!here) return;
    say("Looking for lost animals near there...");
    var params = new URLSearchParams({ lat: here.lat, lng: here.lng, radius_km: radius.value });
    if (species.value) params.set("species", species.value);
    if (includeStale.checked) params.set("include_stale", "true");

    fetch("/api/listings/near?" + params.toString())
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (pins) {
        list.textContent = "";
        none.hidden = pins.length > 0;
        results.hidden = pins.length === 0;
        say(pins.length === 0 ? "" : pins.length === 1 ? "1 lost animal reported nearby." :
            pins.length + " lost animals reported nearby, nearest first.");
        if (!pins.length) return;

        ensureMap();
        map.invalidateSize();
        layer.clearLayers();
        var bounds = L.latLngBounds([here]);
        L.circleMarker(here, { radius: 7, color: "#fff", weight: 2, fillColor: "#2563a8",
                               fillOpacity: 1 }).bindTooltip("You searched here").addTo(layer);
        pins.forEach(function (pin) {
          list.appendChild(card(pin));
          L.marker([pin.lat, pin.lng], { icon: roamer.pinIcon(pin.species, pin.approximate) })
            .bindTooltip(pin.name || "Name not known").addTo(layer);
          bounds.extend([pin.lat, pin.lng]);
        });
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
      })
      .catch(function () { say("Could not search just now. Try again in a moment."); });
  }

  function pick(lat, lng) {
    here = L.latLng(lat, lng);
    placesList.hidden = true;
    search();
  }

  if (!navigator.geolocation) {
    locate.hidden = true;
  } else {
    locate.addEventListener("click", function () {
      say("Finding where you are...");
      locate.disabled = true;
      navigator.geolocation.getCurrentPosition(
        function (p) { locate.disabled = false; pick(p.coords.latitude, p.coords.longitude); },
        function () { locate.disabled = false; say("Your location is not available - type an address instead."); },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }

  // Address search runs on submit only, never as you type: the geocoder's usage policy
  // forbids search-as-you-type, and the server rate-limits it anyway.
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var q = document.getElementById("address").value.trim();
    if (q.length < 3) { say("Type at least a few letters of an address or place."); return; }
    say("Looking up the address...");
    fetch("/api/geocode?" + new URLSearchParams({ q: q }).toString())
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (places) {
        placesList.textContent = "";
        if (!places.length) { say("No place found for that. Try a street name and town."); return; }
        if (places.length === 1) { pick(places[0].lat, places[0].lng); return; }
        say("Which one?");
        places.forEach(function (place) {
          var item = document.createElement("li");
          var button = document.createElement("button");
          button.type = "button";
          button.className = "found-place";
          button.textContent = place.label;
          button.addEventListener("click", function () { pick(place.lat, place.lng); });
          item.appendChild(button);
          placesList.appendChild(item);
        });
        placesList.hidden = false;
      })
      .catch(function () { say("Address search is not available right now. Try your location instead."); });
  });

  species.addEventListener("change", search);
  radius.addEventListener("change", search);
  includeStale.addEventListener("change", search);
})();
