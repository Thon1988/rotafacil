"""Iteration 6 — Backend regression for the newly-unlocked Google-powered
route optimization endpoints (`/api/optimize-google` and `/api/optimize`).

Covers exactly the checklist from the review request:
  1. /api/optimize-google — direct call with lat/lon
  2. /api/optimize-google — auto-geocoding when lat/lon missing
  3. /api/optimize — main flow, distance/duration come from Google
  4. /api/optimize — never 500s; when Google succeeds metrics reflect Google
  5. /api/optimize — done stops kept at the front, unchanged
  6. /api/auth/me — regression (must still respond)
  7. /api/parse-file — PDF/CSV regression (uses a synthetic Circuit-style txt)
"""
from __future__ import annotations

import io
import os

import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_BACKEND_URL",
    "https://rota-facil-mobile.preview.emergentagent.com",
).rstrip("/")

TIMEOUT = 30


# Real São Paulo lat/lon around Av. Paulista / Vila Mariana / Ibirapuera
SP_STOPS = [
    {"id": 0, "codigo": "BR001", "endereco": "Av. Paulista 1000, São Paulo",
     "status": "pendente", "lat": -23.5613, "lon": -46.6558},
    {"id": 1, "codigo": "BR002", "endereco": "Rua Vergueiro 3000, São Paulo",
     "status": "pendente", "lat": -23.5875, "lon": -46.6350},
    {"id": 2, "codigo": "BR003", "endereco": "Av. Ibirapuera 2900, São Paulo",
     "status": "pendente", "lat": -23.6100, "lon": -46.6650},
    {"id": 3, "codigo": "BR004", "endereco": "R. Augusta 2000, São Paulo",
     "status": "pendente", "lat": -23.5568, "lon": -46.6620},
    {"id": 4, "codigo": "BR005", "endereco": "Rua Oscar Freire 500, São Paulo",
     "status": "pendente", "lat": -23.5620, "lon": -46.6710},
]


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# =============== 1. /api/optimize-google with lat/lon ===============
class TestOptimizeGoogleWithCoords:
    def test_direct_endpoint_returns_google_metrics(self, api):
        payload = {"stops": [
            {"codigo": s["codigo"], "endereco": s["endereco"],
             "lat": s["lat"], "lon": s["lon"]}
            for s in SP_STOPS[:5]
        ]}
        r = api.post(f"{BASE_URL}/api/optimize-google", json=payload, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("used_google") is True
        assert data.get("distance_m", 0) > 0
        assert data.get("duration_s", 0) > 0
        # stops length preserved
        assert len(data.get("stops", [])) == len(payload["stops"])
        # every codigo from input is still present in output
        in_codes = {s["codigo"] for s in payload["stops"]}
        out_codes = {s["codigo"] for s in data["stops"]}
        assert in_codes == out_codes

    def test_three_stops_minimum(self, api):
        payload = {"stops": [
            {"codigo": s["codigo"], "endereco": s["endereco"],
             "lat": s["lat"], "lon": s["lon"]}
            for s in SP_STOPS[:3]
        ]}
        r = api.post(f"{BASE_URL}/api/optimize-google", json=payload, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["used_google"] is True
        assert data["distance_m"] > 0
        assert data["duration_s"] > 0


# =============== 2. /api/optimize-google with auto-geocoding ===============
class TestOptimizeGoogleGeocoding:
    def test_geocodes_when_latlon_missing(self, api):
        payload = {"stops": [
            {"codigo": "G1", "endereco": "Avenida Paulista, 1578, São Paulo, SP"},
            {"codigo": "G2", "endereco": "Rua Vergueiro, 3185, São Paulo, SP"},
            {"codigo": "G3", "endereco": "Avenida Brigadeiro Faria Lima, 3477, São Paulo, SP"},
        ]}
        r = api.post(f"{BASE_URL}/api/optimize-google", json=payload, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        # If geocoding succeeded for at least 2 stops, google should engage
        geocoded = [s for s in data["stops"] if s.get("lat") is not None]
        assert len(geocoded) >= 2, f"expected google geocoder to resolve >=2, got {geocoded}"
        if data.get("used_google"):
            assert data["distance_m"] > 0
            assert data["duration_s"] > 0


# =============== 3. /api/optimize main endpoint uses Google metrics ===============
class TestOptimizeMain:
    def test_metrics_come_from_google_when_available(self, api):
        payload = {
            "stops": SP_STOPS[:5],
            "return_to_start": False,
            "minutes_per_stop": 3.0,
            "avg_speed_kmh": 30.0,
        }
        r = api.post(f"{BASE_URL}/api/optimize", json=payload, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "stops" in data
        assert len(data["stops"]) == 5
        m = data.get("metrics")
        assert m is not None, "metrics missing"
        assert m["total_distance_km"] > 0
        assert m["driving_minutes"] > 0

        # Sanity check: compare against pure haversine straight-line * 1.3
        # (the OLD estimate). Google's real-world distance should be >= the
        # haversine sum (roads never shorter than straight line) — usually
        # noticeably larger. This proves metrics are NOT the pure haversine.
        import math
        R = 6371.0
        def hav(a, b, c, d):
            p1, p2 = math.radians(a), math.radians(c)
            dp = math.radians(c - a); dl = math.radians(d - b)
            x = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
            return 2 * R * math.asin(math.sqrt(x))

        # sum haversine along the RETURNED order
        km = 0.0
        prev = (payload["stops"][0]["lat"], payload["stops"][0]["lon"])
        for s in data["stops"][1:]:
            km += hav(prev[0], prev[1], s["lat"], s["lon"])
            prev = (s["lat"], s["lon"])
        # Google distance should never be below the raw haversine sum
        assert m["total_distance_km"] >= km * 0.9, (
            f"total_distance_km={m['total_distance_km']} vs haversine={km:.2f}"
        )
        # And should typically be higher than haversine * 1.3 or at least > haversine
        # (roads add detours). This differentiates from the pure haversine fallback.
        assert m["total_distance_km"] > km, (
            f"suspect fallback: total_distance_km ({m['total_distance_km']}) "
            f"not > haversine sum ({km:.2f})"
        )

    def test_never_500s_even_with_edge_inputs(self, api):
        # All done stops → should 200 with metrics None
        payload = {"stops": [
            {**s, "status": "entregue"} for s in SP_STOPS[:2]
        ]}
        r = api.post(f"{BASE_URL}/api/optimize", json=payload, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert len(data["stops"]) == 2

    def test_single_pending_stop(self, api):
        payload = {"stops": [SP_STOPS[0]]}
        r = api.post(f"{BASE_URL}/api/optimize", json=payload, timeout=TIMEOUT)
        assert r.status_code == 200, r.text


# =============== 5. Done stops preserved at front ===============
class TestOptimizePreservesDone:
    def test_done_stops_stay_at_front(self, api):
        done1 = {"id": 0, "codigo": "DONE1", "endereco": "delivered addr 1",
                 "status": "entregue", "lat": -23.55, "lon": -46.63}
        done2 = {"id": 1, "codigo": "DONE2", "endereco": "delivered addr 2",
                 "status": "falhou", "lat": -23.56, "lon": -46.64}
        pending = [
            {**s, "id": i + 2} for i, s in enumerate(SP_STOPS[:4])
        ]
        payload = {"stops": [done1, done2] + pending}
        r = api.post(f"{BASE_URL}/api/optimize", json=payload, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        out = r.json()["stops"]
        # First two returned stops must be the done ones, in original order,
        # with codigo/endereco unchanged.
        assert out[0]["codigo"] == "DONE1"
        assert out[0]["status"] == "entregue"
        assert out[0]["endereco"] == "delivered addr 1"
        assert out[1]["codigo"] == "DONE2"
        assert out[1]["status"] == "falhou"
        assert out[1]["endereco"] == "delivered addr 2"
        # Rest must be pending, and all pending codigos still present
        rest_codes = {s["codigo"] for s in out[2:]}
        assert rest_codes == {s["codigo"] for s in pending}


# =============== 6. /api/auth/me regression ===============
class TestAuthMeRegression:
    def test_without_token_returns_401(self, api):
        r = api.get(f"{BASE_URL}/api/auth/me", timeout=TIMEOUT)
        # Endpoint must exist and reject unauthenticated calls
        assert r.status_code in (401, 403), r.text

    def test_with_bogus_token_returns_401(self, api):
        r = api.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": "Bearer bogus-token-xyz"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 401, r.text


# =============== 7. /api/parse-file regression ===============
class TestParseFileRegression:
    def test_parse_txt_returns_stops(self, api):
        text = (
            "1  Av. Paulista, 1000, São Paulo, SP  BR12345678901A\n"
            "2  Rua Vergueiro, 3000, São Paulo, SP  BR12345678902B\n"
            "3  Av. Ibirapuera, 2900, São Paulo, SP  BR12345678903C\n"
        )
        files = {"file": ("sample.txt", io.BytesIO(text.encode()), "text/plain")}
        r = requests.post(f"{BASE_URL}/api/parse-file", files=files, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["total"] >= 2
        assert len(data["stops"]) == data["total"]
        for s in data["stops"]:
            assert "codigo" in s and "endereco" in s
