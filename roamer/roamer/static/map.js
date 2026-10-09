// The public map: pins for active listings in view, refetched when the view or a filter
// changes. Every piece of listing text goes in with textContent, never innerHTML - a pet's
// name is typed by a stranger.
"use strict";

(function () {
  var element = document.getElementById("map");
  var filters = document.getElementById("filters");
  var count = document.getElementById("map-count");

  var map = roamer.baseMap(
    element,
    [Number(element.dataset.lat), Number(element.dataset.lng)],
    Number(element.dataset.zoom)
  );
  var cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 40,
    iconCreateFunction: roamer.clusterIcon,
  });
  map.addLayer(cluster);

  var SPECIES = { dog: "Dog", cat: "Cat", other: "Animal" };

  function popup(pin) {
    var box = document.createElement("div");
    box.className = "popup";

    if (pin.thumb_url) {
      var img = document.createElement("img");
      img.className = "popup-photo";
      img.src = pin.thumb_url;
      img.alt = "";
      box.appendChild(img);
    }

    var title = document.createElement("h3");
    title.textContent = (pin.name || "Name not known") + " - lost " +
      (SPECIES[pin.species] || "animal").toLowerCase();
    box.appendChild(title);

    var badge = document.createElement("p");
    if (pin.verified) {
      badge.className = "badge badge-verified badge-small";
      badge.textContent = "Verified";
    } else {
      // Not confirmed lately. Say for how long rather than just withholding the badge.
      badge.className = "badge badge-quiet badge-small";
      badge.textContent = pin.last_confirmed_at
        ? "Not confirmed for " + roamer.timeAgo(pin.last_confirmed_at).replace(" ago", "")
        : "Not confirmed";
    }
    box.appendChild(badge);

    var seen = document.createElement("p");
    seen.textContent = "Last seen " + roamer.timeAgo(pin.last_seen_at) +
      (pin.area_label ? " - " + pin.area_label : "");
    box.appendChild(seen);

    if (pin.approximate) {
      var approx = document.createElement("p");
      approx.textContent = "Approximate area";
      box.appendChild(approx);
    }

    var link = document.createElement("a");
    link.href = pin.url;
    link.textContent = "View listing";
    box.appendChild(link);
    return box;
  }

  var pending = null;

  function load() {
    var params = new URLSearchParams();
    params.set("bbox", map.getBounds().toBBoxString());
    var data = new FormData(filters);
    if (data.get("species")) params.set("species", data.get("species"));
    if (data.get("since_days")) params.set("since_days", data.get("since_days"));
    if (data.get("include_stale")) params.set("include_stale", "true");

    // A drag fires many moveend events. Only the last answer is drawn.
    var mine = (pending = {});
    fetch("/api/listings?" + params.toString())
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .then(function (pins) {
        if (mine !== pending) return;
        cluster.clearLayers();
        pins.forEach(function (pin) {
          L.marker([pin.lat, pin.lng], { icon: roamer.pinIcon(pin.species, pin.approximate) })
            .bindPopup(popup(pin))
            .addTo(cluster);
        });
        count.textContent = pins.length === 1 ? "1 lost animal in view" :
          pins.length + " lost animals in view";
      })
      .catch(function () {
        if (mine === pending) count.textContent = "Could not load listings. Try moving the map.";
      });
  }

  map.on("moveend", load);
  filters.addEventListener("change", load);
  filters.addEventListener("submit", function (event) { event.preventDefault(); });
  load();
})();
