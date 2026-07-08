import { Stop } from "@/src/types/stop";

/**
 * Builds an HTML document that renders a Google Maps JavaScript API map.
 * (File name kept as `leaflet-map.ts` for backwards compatibility with existing
 * imports; internally uses Google Maps, NOT Leaflet.)
 *
 * The map communicates with the React Native host via postMessage using the
 * same protocol as before:
 *   Host → map:  { type: 'update_stops', stops }  |  { type: 'fly_to', lat, lon, zoom }
 *   Map  → host: { type: 'map_ready' }            |  { type: 'stop_clicked', index }
 */
export function buildLeafletHTML(stops: Stop[]): string {
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "";
  const stopsJson = JSON.stringify(stops);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<style>
  html, body, #map { margin:0; padding:0; height:100%; width:100%; background:#0A0A0A; }
</style>
</head>
<body>
<div id="map"></div>
<script>
  const STOPS = ${stopsJson};
  let map = null;
  let markers = [];
  let polyline = null;

  function postToHost(payload) {
    const msg = JSON.stringify(payload);
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(msg);
    } else if (window.parent && window.parent !== window) {
      window.parent.postMessage(msg, '*');
    }
  }

  function getColor(status) {
    if (status === 'entregue') return '#16a34a';
    if (status === 'falhou') return '#dc2626';
    return '#ea580c';
  }

  // Build a labeled circular marker via SVG data-URI so we don't depend on
  // AdvancedMarker (which requires Map ID + billing config).
  function buildMarkerIcon(label, color) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">'
      + '<circle cx="12" cy="12" r="10" fill="' + color + '" stroke="#ffffff" stroke-width="2"/>'
      + '<text x="12" y="16" text-anchor="middle" font-family="-apple-system,Roboto,sans-serif" '
      + 'font-size="10" font-weight="700" fill="#ffffff">' + String(label) + '</text>'
      + '</svg>';
    return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
  }

  function renderStops(stops) {
    if (!map) return;
    // Clear existing markers/line
    markers.forEach((m) => m.setMap(null));
    markers = [];
    if (polyline) { polyline.setMap(null); polyline = null; }

    if (!stops || stops.length === 0) return;

    const bounds = new google.maps.LatLngBounds();
    const linePath = [];
    let hasAny = false;

    stops.forEach((s, idx) => {
      if (s.lat == null || s.lon == null) return;
      const position = { lat: Number(s.lat), lng: Number(s.lon) };
      const color = getColor(s.status);
      const marker = new google.maps.Marker({
        position: position,
        map: map,
        title: (s.codigo || '') + ' — ' + (s.endereco || ''),
        icon: {
          url: buildMarkerIcon(idx + 1, color),
          scaledSize: new google.maps.Size(24, 24),
          anchor: new google.maps.Point(12, 12),
        },
        optimized: true,
      });
      marker.addListener('click', () => {
        postToHost({ type: 'stop_clicked', index: idx });
      });
      markers.push(marker);
      bounds.extend(position);
      hasAny = true;
      if (s.status === 'pendente') linePath.push(position);
    });

    if (linePath.length > 1) {
      polyline = new google.maps.Polyline({
        path: linePath,
        geodesic: false,
        strokeColor: '#3b82f6',
        strokeOpacity: 0.85,
        strokeWeight: 4,
      });
      polyline.setMap(map);
    }

    if (hasAny) {
      map.fitBounds(bounds, 40);
      // Cap the zoom after fitBounds so single-marker cases don't zoom to street level
      const listener = google.maps.event.addListenerOnce(map, 'idle', function () {
        if (map.getZoom() > 15) map.setZoom(15);
      });
    }
  }

  function flyTo(lat, lon, zoom) {
    if (!map) return;
    map.panTo({ lat: Number(lat) - 0.005, lng: Number(lon) });
    if (zoom) map.setZoom(zoom);
  }

  // Handle messages from React Native host
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

  // Dark-mode Google Maps style
  const DARK_STYLE = [
    { elementType: 'geometry', stylers: [{ color: '#1d2c4d' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#1a3646' }] },
    { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#4b6878' }] },
    { featureType: 'administrative.land_parcel', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ color: '#4b6878' }] },
    { featureType: 'landscape.man_made', elementType: 'geometry.stroke', stylers: [{ color: '#334e87' }] },
    { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#023e58' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#304a7d' }] },
    { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#98a5be' }] },
    { featureType: 'road', elementType: 'labels.text.stroke', stylers: [{ color: '#1d2c4d' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2c6675' }] },
    { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#255763' }] },
    { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#b0d5ce' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
    { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4e6d70' }] }
  ];

  // Global init callback invoked by the Google Maps loader
  window.__initMap = function () {
    map = new google.maps.Map(document.getElementById('map'), {
      center: { lat: -23.5505, lng: -46.6333 },
      zoom: 12,
      disableDefaultUI: true,
      gestureHandling: 'greedy',
      backgroundColor: '#0A0A0A',
      styles: DARK_STYLE,
    });
    // Initial render
    renderStops(STOPS);
    // Notify host
    setTimeout(function () { postToHost({ type: 'map_ready' }); }, 300);
  };
</script>
<script async defer
  src="https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=__initMap&language=pt-BR&region=BR&loading=async"></script>
</body>
</html>`;
}
