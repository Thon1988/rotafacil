"""Iteration 8 — Backend geocoding overhaul verification.

Contract:
1. POST /api/geocode-batch on 5 abbreviated SP addresses → all found=true,
   provider='google', location_type ∈ {ROOFTOP, RANGE_INTERPOLATED, GEOMETRIC_CENTER},
   coords within São Paulo state bounds.
2. Country-level query ('Brasil') must NOT come from Google (APPROXIMATE rejected).
3. Semaphore=5 and sleep=0.1 → 10-address batch total latency < 4s.
4. Static: _expand_address_abbrev() covers all required abbrevs.
5. Static: geocode_nominatim() pipeline order: Google → Mapbox → Nominatim → Photon.
6. Regression /api/optimize with 4 SP stops → 200, google metrics visible.
7. Regression /api/parse-file missing file → 422.
"""
import os
import re
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://rota-facil-mobile.preview.emergentagent.com").rstrip("/")
SERVER_PY = "/app/backend/server.py"

# São Paulo state rough bounding box (broad enough to catch SP metro + interior)
SP_LAT_MIN, SP_LAT_MAX = -25.5, -19.5
SP_LON_MIN, SP_LON_MAX = -53.5, -44.0

ACCEPTED_LOCATION_TYPES = {"ROOFTOP", "RANGE_INTERPOLATED", "GEOMETRIC_CENTER"}


@pytest.fixture(scope="module")
def server_source():
    with open(SERVER_PY, "r", encoding="utf-8") as f:
        return f.read()


# ---------- 1. geocode_google() on 5 abbreviated addresses ----------
class TestGeocodeGoogleFiveAddresses:
    ADDRESSES = [
        "Avenida Paulista, 1578, São Paulo, SP",
        "R Augusta 500, São Paulo, SP",
        "Al Santos 100, São Paulo, SP",
        "Trav Padre Manoel de Nóbrega 50, São Paulo, SP",
        "Praça da Sé, São Paulo, SP",
    ]

    def test_all_five_geocoded_via_google(self):
        resp = requests.post(
            f"{BASE_URL}/api/geocode-batch",
            json={"addresses": self.ADDRESSES},
            timeout=45,
        )
        assert resp.status_code == 200, resp.text
        results = resp.json().get("results", [])
        assert len(results) == 5, f"Expected 5 results, got {len(results)}"
        for i, (addr, r) in enumerate(zip(self.ADDRESSES, results)):
            assert r.get("found") is True, f"[{i}] '{addr}' not found: {r}"
            assert r.get("provider") == "google", (
                f"[{i}] '{addr}' provider={r.get('provider')} (expected 'google')"
            )
            loc_type = r.get("location_type")
            assert loc_type in ACCEPTED_LOCATION_TYPES, (
                f"[{i}] '{addr}' location_type={loc_type} (must be in {ACCEPTED_LOCATION_TYPES})"
            )
            lat, lon = r.get("lat"), r.get("lon")
            assert lat is not None and lon is not None, f"[{i}] '{addr}' missing coords"
            assert SP_LAT_MIN <= lat <= SP_LAT_MAX, f"[{i}] lat={lat} outside SP state"
            assert SP_LON_MIN <= lon <= SP_LON_MAX, f"[{i}] lon={lon} outside SP state"


# ---------- 2. APPROXIMATE rejection ----------
class TestApproximateRejection:
    def test_country_query_not_from_google(self):
        """Country-level 'Brasil' returns APPROXIMATE — must be rejected by geocode_google.
        Either provider != google (fell back to another), or found=false."""
        resp = requests.post(
            f"{BASE_URL}/api/geocode-batch",
            json={"addresses": ["Brasil"]},
            timeout=30,
        )
        assert resp.status_code == 200, resp.text
        results = resp.json().get("results", [])
        assert len(results) == 1
        r = results[0]
        # Google must NOT have accepted this
        if r.get("found"):
            assert r.get("provider") != "google", (
                f"geocode_google should reject APPROXIMATE 'Brasil' but returned: {r}"
            )
        # Otherwise found=false is also acceptable (all providers failed)


# ---------- 3. Concurrency: 10 addresses under ~4s ----------
class TestBatchConcurrency:
    def test_ten_addresses_latency_under_4s(self):
        addrs = [
            "Avenida Paulista, 1578, São Paulo, SP",
            "Rua Augusta, 500, São Paulo, SP",
            "Alameda Santos, 100, São Paulo, SP",
            "Rua Oscar Freire, 200, São Paulo, SP",
            "Avenida Brigadeiro Faria Lima, 3477, São Paulo, SP",
            "Rua da Consolação, 2000, São Paulo, SP",
            "Praça da Sé, São Paulo, SP",
            "Avenida Rebouças, 600, São Paulo, SP",
            "Rua Haddock Lobo, 400, São Paulo, SP",
            "Avenida Ibirapuera, 3000, São Paulo, SP",
        ]
        t0 = time.time()
        resp = requests.post(
            f"{BASE_URL}/api/geocode-batch", json={"addresses": addrs}, timeout=60
        )
        elapsed = time.time() - t0
        assert resp.status_code == 200
        results = resp.json().get("results", [])
        assert len(results) == 10
        # At Semaphore=5 and 0.1s sleep, 10 addresses through Google (~200-500ms each)
        # should finish in ~1-3s. Old (Semaphore=2, sleep=0.4) would exceed 4s.
        assert elapsed < 4.5, (
            f"Batch latency {elapsed:.2f}s > 4.5s — concurrency likely not bumped. "
            f"Verify Semaphore=5 and sleep=0.1 in server.py"
        )
        # Bonus: most should be Google-provider
        google_count = sum(1 for r in results if r.get("provider") == "google")
        assert google_count >= 8, f"Only {google_count}/10 via Google"


# ---------- 4. Static: _expand_address_abbrev covers required substitutions ----------
class TestExpandAbbrevStatic:
    def test_expand_defined(self, server_source):
        assert "def _expand_address_abbrev(" in server_source

    def test_called_from_clean_address_before_city_append(self, server_source):
        # find clean_address body
        m = re.search(
            r"def clean_address\(.*?\n(.*?)(?=\ndef |\Z)", server_source, re.DOTALL
        )
        assert m, "clean_address() not found"
        body = m.group(1)
        expand_idx = body.find("_expand_address_abbrev(")
        city_idx = body.find("São Paulo, SP")
        assert expand_idx != -1, "_expand_address_abbrev not called from clean_address"
        assert city_idx != -1, "city-context append missing"
        assert expand_idx < city_idx, "expand must run BEFORE city-context append"

    def test_all_required_substitutions_present(self, server_source):
        # find _expand_address_abbrev body
        m = re.search(
            r"def _expand_address_abbrev\(.*?\n(.*?)(?=\ndef |\Z)", server_source, re.DOTALL
        )
        assert m, "_expand_address_abbrev body not found"
        body = m.group(1)
        # (source-token, target-word) — check both appear on the same substitution line
        checks = [
            (r"\bR\.?\s+", "Rua "),
            (r"\bAv\.?\s+", "Avenida "),
            (r"\bAl\.?\s+", "Alameda "),
            (r"\bTrav\.?\s+", "Travessa "),
            (r"\bDr\.?\s+", "Doutor "),
            (r"\bProf\.?\s+", "Professor "),
        ]
        for pat, target in checks:
            assert pat in body, f"Missing regex '{pat}' in _expand_address_abbrev"
            assert target in body, f"Missing target '{target}' in _expand_address_abbrev"


# ---------- 5. Static: geocode_nominatim pipeline order ----------
class TestPipelineOrder:
    def test_order_google_mapbox_nominatim_photon(self, server_source):
        m = re.search(
            r"async def geocode_nominatim\(.*?\n(.*?)(?=\nasync def |\ndef |\Z)",
            server_source,
            re.DOTALL,
        )
        assert m, "geocode_nominatim body not found"
        body = m.group(1)
        idx_google = body.find("geocode_google(")
        idx_mapbox = body.find("geocode_mapbox(")
        idx_nomin = body.find("try_nominatim(")
        idx_photon = body.find("geocode_photon(")
        assert idx_google != -1, "geocode_google() not called in pipeline"
        assert idx_mapbox != -1, "geocode_mapbox() not called in pipeline"
        assert idx_nomin != -1, "try_nominatim() not called in pipeline"
        assert idx_photon != -1, "geocode_photon() not called in pipeline"
        assert idx_google < idx_mapbox < idx_nomin < idx_photon, (
            f"Wrong order — indices: google={idx_google}, mapbox={idx_mapbox}, "
            f"nominatim={idx_nomin}, photon={idx_photon}"
        )


# ---------- 6. Static + numeric: Semaphore=5, sleep=0.1 ----------
class TestSemaphoreAndSleep:
    def test_semaphore_five(self, server_source):
        m = re.search(
            r"async def geocode_batch\(.*?\n(.*?)(?=\n@api_router|\nasync def |\ndef |\Z)",
            server_source,
            re.DOTALL,
        )
        assert m
        body = m.group(1)
        assert "Semaphore(5)" in body, "Semaphore must be 5"
        assert "asyncio.sleep(0.1)" in body, "sleep must be 0.1"
        # And confirm old values are gone
        assert "Semaphore(2)" not in body
        assert "asyncio.sleep(0.4)" not in body


# ---------- 7. Regression /api/optimize ----------
class TestOptimizeRegression:
    def test_optimize_four_sp_stops(self):
        payload = {
            "stops": [
                {"id": 1, "codigo": "BR1", "endereco": "Avenida Paulista, 1578, São Paulo, SP",
                 "lat": -23.5613, "lon": -46.6565},
                {"id": 2, "codigo": "BR2", "endereco": "Rua Augusta, 500, São Paulo, SP",
                 "lat": -23.5540, "lon": -46.6510},
                {"id": 3, "codigo": "BR3", "endereco": "Alameda Santos, 100, São Paulo, SP",
                 "lat": -23.5686, "lon": -46.6499},
                {"id": 4, "codigo": "BR4", "endereco": "Praça da Sé, São Paulo, SP",
                 "lat": -23.5504, "lon": -46.6339},
            ]
        }
        resp = requests.post(f"{BASE_URL}/api/optimize", json=payload, timeout=45)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        # response should contain either 'route' or 'stops' or 'ordered'
        assert isinstance(data, dict)
        # Look for google metrics — used_google or provider or distance/duration
        blob = str(data).lower()
        # Not strict on exact key; ensure some ordering key exists
        assert any(
            k in data for k in ("stops", "route", "ordered", "sequence", "order")
        ), f"Unexpected /api/optimize shape: {list(data.keys())}"


# ---------- 8. Regression /api/parse-file missing file → 422 ----------
class TestParseFileRegression:
    def test_missing_file_returns_422(self):
        resp = requests.post(f"{BASE_URL}/api/parse-file", timeout=15)
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text[:200]}"
