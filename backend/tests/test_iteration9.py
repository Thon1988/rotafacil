"""Iteration 9 backend tests — batched fixes for Rota+Rápida.

Covers:
- BACKEND #4 admin-level rejection (_is_admin_place_reject) in try_nominatim + geocode_photon
- BACKEND #5 inline coord detection + CEP fallback in parse-text
- BACKEND #5 lat/lon bounds guard
- BACKEND #7 geocode_google_places existence + call to Places Text Search
- BACKEND #8 pipeline order (geocode_google → geocode_google_places → mapbox → nominatim → photon)
- Regressions: /api/optimize with 4 SP stops, /api/parse-file 422 on empty, /api/auth/me 401
"""
import os
import re
import sys
import inspect
import asyncio
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://rota-facil-mobile.preview.emergentagent.com").rstrip("/")
SERVER_PY = "/app/backend/server.py"

# Add backend to sys.path so we can import server directly for unit tests
sys.path.insert(0, "/app/backend")


@pytest.fixture(scope="module")
def source():
    with open(SERVER_PY, "r", encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------- BACKEND #4 — Admin-level rejection ----------
class TestAdminRejectionStatic:
    def test_is_admin_place_reject_defined(self, source):
        assert "def _is_admin_place_reject(" in source, "_is_admin_place_reject must be defined in server.py"

    def test_admin_reject_used_in_try_nominatim(self, source):
        # Locate try_nominatim inner function and verify _is_admin_place_reject called
        m = re.search(r"async def try_nominatim\(.*?\n(.*?)(?=\n    # Attempt 1: Nominatim full)", source, re.S)
        assert m, "try_nominatim inner function not found"
        block = m.group(1)
        assert "_is_admin_place_reject" in block, "_is_admin_place_reject not invoked inside try_nominatim"

    def test_admin_reject_used_in_geocode_photon(self, source):
        m = re.search(r"async def geocode_photon\(.*?\n(.*?)(?=\nasync def |\ndef )", source, re.S)
        assert m, "geocode_photon function not found"
        block = m.group(1)
        assert "_is_admin_place_reject" in block, "_is_admin_place_reject not invoked inside geocode_photon"


class TestAdminRejectionUnit:
    """Directly call _is_admin_place_reject with admin-level fixtures."""

    def test_reject_city(self):
        from server import _is_admin_place_reject
        assert _is_admin_place_reject({"class": "place", "type": "city"}) is True

    def test_reject_state(self):
        from server import _is_admin_place_reject
        assert _is_admin_place_reject({"class": "place", "type": "state"}) is True

    def test_reject_country(self):
        from server import _is_admin_place_reject
        assert _is_admin_place_reject({"class": "place", "type": "country"}) is True

    def test_reject_boundary_class(self):
        from server import _is_admin_place_reject
        assert _is_admin_place_reject({"class": "boundary", "type": "administrative"}) is True

    def test_accept_street(self):
        from server import _is_admin_place_reject
        # highway/road should NOT be rejected
        assert _is_admin_place_reject({"class": "highway", "type": "residential"}) is False


class TestAdminRejectionAPI:
    """End-to-end: batch geocoding of admin-only queries should NOT return a Nominatim/Photon place-city hit."""

    def test_admin_only_batch(self, api_client):
        addresses = ["Brasil", "São Paulo estado", "América do Sul"]
        r = api_client.post(
            f"{BASE_URL}/api/geocode-batch",
            json={"addresses": addresses},
            timeout=120,
        )
        assert r.status_code == 200, f"unexpected status {r.status_code}: {r.text[:200]}"
        data = r.json()
        results = data.get("results") or data.get("stops") or data
        # accept either shape — just make sure we have a list
        if isinstance(results, dict):
            results = results.get("results") or []
        assert isinstance(results, list)
        # Ensure no result declares provider='nominatim' or 'photon' returning admin-level match.
        # Since only Google Places may return a hit (bona fide street), any provider that isn't
        # google/google_places/mapbox with an admin-shaped display should be rejected.
        # We don't have introspection to display_name for admin, so we just ensure the pipeline
        # returns either found=false OR a plausible upstream provider.
        for i, res in enumerate(results):
            if res.get("found"):
                # a hit is acceptable ONLY if provider is google/google_places/mapbox
                provider = (res.get("provider") or "").lower()
                # A missing provider means mapbox/nominatim/photon happy-path; log for visibility
                # Assertion: must not be admin-level from OSM (nominatim/photon).
                if provider in ("nominatim", "photon"):
                    pytest.fail(
                        f"Address '{addresses[i]}' matched via {provider} which should have been "
                        f"rejected as admin-level. Result: {res}"
                    )


# ---------- BACKEND #5 — Inline coord + CEP fallback ----------
class TestInlineCoordParsing:
    def test_parse_text_inline_coords_and_cep(self, api_client):
        payload = {
            "text": (
                "BR123456789012 Rua das Flores 100 -23.5893 -46.6337 CEP 04101-000\n"
                "BR123456789013 Rua das Rosas 200 CEP 04102-000\n"
                "BR123456789014 Rua dos Cravos 300"
            )
        }
        r = api_client.post(f"{BASE_URL}/api/parse-text", json=payload, timeout=60)
        assert r.status_code == 200, f"unexpected: {r.text[:300]}"
        data = r.json()
        stops = data.get("stops") or []
        assert len(stops) == 3, f"expected 3 stops, got {len(stops)}: {stops}"

        # Stop 0: inline coords
        s0 = stops[0]
        assert s0.get("lat") is not None and s0.get("lon") is not None, f"stop0 must have inline coords: {s0}"
        assert abs(s0["lat"] - (-23.5893)) < 0.001, f"lat mismatch: {s0['lat']}"
        assert abs(s0["lon"] - (-46.6337)) < 0.001, f"lon mismatch: {s0['lon']}"

        # Stop 1: CEP 04102-000 resolved via ViaCEP
        s1 = stops[1]
        assert s1.get("lat") is not None and s1.get("lon") is not None, f"stop1 must have CEP-resolved coords: {s1}"
        # São Paulo bounds
        assert -24.5 < s1["lat"] < -23.0, f"CEP-resolved lat outside SP: {s1['lat']}"
        assert -47.5 < s1["lon"] < -46.0, f"CEP-resolved lon outside SP: {s1['lon']}"

        # Stop 2: no coords, no CEP → lat/lon must be null
        s2 = stops[2]
        assert s2.get("lat") is None and s2.get("lon") is None, f"stop2 should have no coords: {s2}"

    def test_parse_text_bounds_guard(self, api_client):
        # 50.0, 100.0 is outside Brazilian bounds
        payload = {"text": "BR123456789012 Rua das Flores 100 50.0 100.0"}
        r = api_client.post(f"{BASE_URL}/api/parse-text", json=payload, timeout=30)
        assert r.status_code == 200
        stops = r.json().get("stops") or []
        assert len(stops) == 1
        assert stops[0].get("lat") is None and stops[0].get("lon") is None, (
            f"out-of-bounds coords must be rejected: {stops[0]}"
        )


# ---------- BACKEND #7 — geocode_google_places ----------
class TestGoogleTextSearchFallback:
    def test_function_defined(self, source):
        assert "async def geocode_google_places(address: str)" in source, \
            "geocode_google_places must be defined with correct signature"

    def test_uses_text_search_endpoint(self, source):
        m = re.search(
            r"async def geocode_google_places\(.*?\n(.*?)(?=\nasync def |\ndef )",
            source,
            re.S,
        )
        assert m, "geocode_google_places body not extracted"
        body = m.group(1)
        assert "maps.googleapis.com/maps/api/place/textsearch/json" in body, \
            "must call Places Text Search endpoint"
        assert '"region": "br"' in body or "'region': 'br'" in body, "region=br missing"
        assert '"language": "pt-BR"' in body or "'language': 'pt-BR'" in body, "language=pt-BR missing"
        assert "-23.5505,-46.6333" in body, "SP location bias missing"
        assert '"radius": 50000' in body or "'radius': 50000" in body, "radius=50000 missing"

    def test_prefers_street_types(self, source):
        m = re.search(
            r"async def geocode_google_places\(.*?\n(.*?)(?=\nasync def |\ndef )",
            source,
            re.S,
        )
        body = m.group(1)
        assert "street_address" in body and "premise" in body and "route" in body, (
            "preferred_types must include street_address, premise, route"
        )

    def test_live_call_google_places(self):
        """Live call — requires GOOGLE_MAPS_API_KEY. Uses an SP address that Google Geocoding likely resolves too,
        but we call geocode_google_places directly so pipeline order doesn't matter."""
        from server import geocode_google_places
        result = asyncio.get_event_loop().run_until_complete(
            geocode_google_places("Rua Augusta 500 Consolação São Paulo")
        )
        if result is None:
            pytest.skip("Google Places returned no result (possibly quota/network) — skipping live check")
        assert result.get("provider") == "google_places", f"provider mismatch: {result}"
        assert result["lat"] < -23 and result["lon"] < -46, f"lat/lon not in SP: {result}"


# ---------- BACKEND #8 — Pipeline order ----------
class TestPipelineOrder:
    def test_pipeline_order_google_then_places_then_mapbox_then_nominatim_then_photon(self, source):
        # Find geocode_nominatim() function body and verify order of provider calls
        m = re.search(
            r"async def geocode_nominatim\(.*?\n(.*?)(?=\n@api_router|\nasync def |\ndef )",
            source,
            re.S,
        )
        assert m, "geocode_nominatim function body not extracted"
        body = m.group(1)

        idx_google = body.find("geocode_google(")
        idx_places = body.find("geocode_google_places(")
        idx_mapbox = body.find("geocode_mapbox(")
        idx_nomin = body.find("try_nominatim(")
        idx_photon = body.find("geocode_photon(")

        assert idx_google > 0, "geocode_google not called"
        assert idx_places > idx_google, "geocode_google_places must be called AFTER geocode_google"
        assert idx_mapbox > idx_places, "geocode_mapbox must be called AFTER geocode_google_places"
        assert idx_nomin > idx_mapbox, "try_nominatim must be called AFTER geocode_mapbox"
        assert idx_photon > idx_nomin, "geocode_photon must be called AFTER try_nominatim"


# ---------- Regressions ----------
class TestRegressions:
    def test_optimize_returns_metrics(self, api_client):
        payload = {
            "stops": [
                {"id": 0, "codigo": "TEST_A", "endereco": "Av Paulista 1000, São Paulo, SP",
                 "lat": -23.5613, "lon": -46.6558, "status": "pendente"},
                {"id": 1, "codigo": "TEST_B", "endereco": "Rua Augusta 500, São Paulo, SP",
                 "lat": -23.5545, "lon": -46.6626, "status": "pendente"},
                {"id": 2, "codigo": "TEST_C", "endereco": "Praça da Sé, São Paulo, SP",
                 "lat": -23.5504, "lon": -46.6339, "status": "pendente"},
                {"id": 3, "codigo": "TEST_D", "endereco": "Alameda Santos 100, São Paulo, SP",
                 "lat": -23.5675, "lon": -46.6489, "status": "pendente"},
            ],
            "return_to_start": False,
            "minutes_per_stop": 3,
            "avg_speed_kmh": 30,
        }
        r = api_client.post(f"{BASE_URL}/api/optimize", json=payload, timeout=60)
        assert r.status_code == 200, f"unexpected: {r.status_code} {r.text[:200]}"
        data = r.json()
        assert "stops" in data
        assert "metrics" in data
        assert data["metrics"].get("total_distance_km") is not None

    def test_parse_file_missing_file_returns_422(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/parse-file", timeout=15)
        assert r.status_code == 422, f"expected 422 on missing file, got {r.status_code}"

    def test_auth_me_missing_token_401(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/auth/me", timeout=15)
        assert r.status_code == 401, f"expected 401, got {r.status_code}"
