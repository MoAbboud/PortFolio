import { useMemo } from "react";
import { WebView } from "react-native-webview";

export interface MapPin {
  id: number;
  lat: number;
  lon: number;
  emoji: string;
  title: string;
}

const KC_CENTER: [number, number] = [39.0997, -94.5786];

function buildHtml(pins: MapPin[], center: [number, number]): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body, #map { height: 100%; margin: 0; padding: 0; background: #eef0f6; }
  .emoji-pin {
    width: 34px; height: 34px; background: #fff;
    border-radius: 50% 50% 50% 0; transform: rotate(-45deg);
    box-shadow: 0 2px 6px rgba(0,0,0,.3); border: 2px solid #fff;
    display: flex; align-items: center; justify-content: center;
  }
  .emoji-pin span { transform: rotate(45deg); font-size: 18px; }
</style>
</head>
<body>
<div id="map"></div>
<script>
  var pins = ${JSON.stringify(pins)};
  var center = ${JSON.stringify(center)};
  var map = L.map('map', { zoomControl: false }).setView(center, 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap'
  }).addTo(map);
  var pts = [];
  pins.forEach(function (p) {
    var icon = L.divIcon({
      className: '',
      html: '<div class="emoji-pin"><span>' + p.emoji + '</span></div>',
      iconSize: [34, 34], iconAnchor: [17, 34]
    });
    L.marker([p.lat, p.lon], { icon }).addTo(map).on('click', function () {
      if (window.ReactNativeWebView) { window.ReactNativeWebView.postMessage(String(p.id)); }
    });
    pts.push([p.lat, p.lon]);
  });
  if (pts.length > 1) { map.fitBounds(pts, { padding: [50, 50] }); }
  else if (pts.length === 1) { map.setView(pts[0], 13); }
</script>
</body>
</html>`;
}

export function AdventureMap({
  pins,
  onSelectId,
}: {
  pins: MapPin[];
  onSelectId: (id: number) => void;
}) {
  const html = useMemo(
    () => buildHtml(pins, pins[0] ? [pins[0].lat, pins[0].lon] : KC_CENTER),
    [pins],
  );

  return (
    <WebView
      originWhitelist={["*"]}
      source={{ html }}
      onMessage={(event) => {
        const id = Number(event.nativeEvent.data);
        if (id) onSelectId(id);
      }}
      style={{ flex: 1 }}
    />
  );
}
