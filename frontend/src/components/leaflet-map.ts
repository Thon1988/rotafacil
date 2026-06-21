import { Stop } from "@/src/types/stop";

export function buildLeafletHTML(stops: Stop[]): string {
  const stopsJson = JSON.stringify(stops);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body, #map { margin:0; padding:0; height:100%; width:100%; background:#0A0A0A; }
  .marker-pin {
    display:flex; align-items:center; justify-content:center;
    width:32px; height:32px; border-radius:50%;
    border:3px solid #fff; color:#fff; font-weight:800;
    font-size:13px; box-shadow:0 4px 10px rgba(0,0,0,0.5);
    font-family: -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
  }
</style>
</head>
<body>
<div id="map"></div>
<script>
  const STOPS = ${stopsJson};
  const map = L.map('map', { zoomControl: false }).setView([-23.5505, -46.6333], 12);

  // Dark tile layer (CartoDB dark matter)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap, © CARTO',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);

  let markers = [];
  let routeLine = null;

  function getColor(status) {
    if (status === 'entregue') return '#16a34a';
    if (status === 'falhou') return '#dc2626';
    return '#ea580c';
  }

  function renderStops(stops) {
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }

    if (!stops || stops.length === 0) return;

    const bounds = [];
    const linePoints = [];

    stops.forEach((s, idx) => {
      if (s.lat == null || s.lon == null) return;
      const color = getColor(s.status);
      const icon = L.divIcon({
        className: 'custom-pin-wrapper',
        html: '<div class="marker-pin" style="background:' + color + ';">' + (idx + 1) + '</div>',
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });
      const marker = L.marker([s.lat, s.lon], { icon }).addTo(map);
      marker.on('click', () => {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'stop_clicked', index: idx }));
        }
      });
      markers.push(marker);
      bounds.push([s.lat, s.lon]);
      if (s.status === 'pendente') linePoints.push([s.lat, s.lon]);
    });

    if (linePoints.length > 1) {
      routeLine = L.polyline(linePoints, { color: '#3b82f6', weight: 4, opacity: 0.85 }).addTo(map);
    }

    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }

  function flyTo(lat, lon, zoom) {
    map.flyTo([lat - 0.005, lon], zoom || 14, { animate: true, duration: 0.8 });
  }

  // Listen for messages from React Native
  function handleMessage(event) {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'update_stops') {
        renderStops(data.stops);
      } else if (data.type === 'fly_to') {
        flyTo(data.lat, data.lon, data.zoom);
      }
    } catch (e) {}
  }
  document.addEventListener('message', handleMessage);
  window.addEventListener('message', handleMessage);

  // Initial render
  renderStops(STOPS);
  // Notify RN that map is ready
  setTimeout(() => {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'map_ready' }));
    }
  }, 300);
</script>
</body>
</html>`;
}
