"""Iteration 10 — OR-Tools TSP fix verification + regressions.

Focus:
  * BUG FIX #1: 87 SP-scattered stops → OR-Tools returns total_distance_km < 100km
  * BUG FIX #2: 5 stops → OR-Tools kicks in (>=3 threshold), reorders if beneficial
  * BUG FIX #3: 2 stops → below threshold, returns as-is/nearest-neighbor
  * BUG FIX #4: 0 pending stops → returns stops unchanged, no metrics required
  * BUG FIX #5: mixed pending/entregue → done stays at head, pending is reordered
  * REGRESSIONS: geocode-batch, parse-text (inline coords + CEP + null), auth/me, parse-file
"""

import os
import random
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or \
           os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set in frontend/.env"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------- Helpers ----------
def _mk_stop(i, lat, lon, status="pendente"):
    return {
        "id": i,
        "codigo": f"BR{i:012d}TEST",
        "endereco": f"Test address {i}, São Paulo, SP",
        "status": status,
        "lat": lat,
        "lon": lon,
    }


# ============ BUG FIX #1: 87 SP stops → < 100 km ============
class TestOptimize87Stops:
    def test_87_stops_ortools_under_100km(self, api):
        random.seed(1234)
        stops = [
            _mk_stop(
                i,
                -23.55 + random.uniform(-0.03, 0.03),
                -46.63 + random.uniform(-0.03, 0.03),
            )
            for i in range(87)
        ]
        payload = {
            "stops": stops,
            "minutes_per_stop": 3,
            "avg_speed_kmh": 30,
            "return_to_start": False,
        }
        t0 = time.time()
        r = api.post(f"{BASE_URL}/api/optimize", json=payload, timeout=90)
        elapsed = time.time() - t0
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:400]}"
        data = r.json()
        assert "metrics" in data and data["metrics"], "metrics missing"
        total_km = data["metrics"]["total_distance_km"]
        print(f"87 stops → {total_km:.1f} km in {elapsed:.1f}s")
        assert 30 <= total_km < 100, f"Expected 30 <= km < 100, got {total_km}"
        assert len(data["stops"]) == 87


# ============ BUG FIX #2: 5 SP stops → OR-Tools ============
class TestOptimize5Stops:
    def test_5_stops_uses_ortools(self, api):
        # 5 SP stops with distinct coords — worst-order input to force reorder benefit
        raw = [
            (-23.5300, -46.6800),
            (-23.5900, -46.6200),
            (-23.5350, -46.6300),
            (-23.5850, -46.6700),
            (-23.5550, -46.6500),
        ]
        stops = [_mk_stop(i, lat, lon) for i, (lat, lon) in enumerate(raw)]
        r = api.post(
            f"{BASE_URL}/api/optimize",
            json={"stops": stops, "minutes_per_stop": 3, "avg_speed_kmh": 30},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert len(data["stops"]) == 5
        assert data.get("metrics") is not None
        assert data["metrics"]["total_distance_km"] > 0


# ============ BUG FIX #3: 2 stops below threshold ============
class TestOptimize2Stops:
    def test_2_stops_below_threshold(self, api):
        stops = [
            _mk_stop(0, -23.55, -46.63),
            _mk_stop(1, -23.56, -46.64),
        ]
        r = api.post(f"{BASE_URL}/api/optimize", json={"stops": stops}, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert len(data["stops"]) == 2


# ============ BUG FIX #4: 0 pending ============
class TestOptimize0Pending:
    def test_all_done_returns_unchanged(self, api):
        stops = [
            _mk_stop(0, -23.55, -46.63, status="entregue"),
            _mk_stop(1, -23.56, -46.64, status="entregue"),
        ]
        r = api.post(f"{BASE_URL}/api/optimize", json={"stops": stops}, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert len(data["stops"]) == 2
        # No metrics required when nothing to optimize
        assert all(s["status"] == "entregue" for s in data["stops"])


# ============ BUG FIX #5: mixed done + pending ============
class TestOptimizeMixed:
    def test_done_stays_at_head_pending_reordered(self, api):
        stops = [
            _mk_stop(0, -23.5300, -46.6300, status="entregue"),
            _mk_stop(1, -23.5900, -46.6500, status="entregue"),
            _mk_stop(2, -23.5500, -46.6200),  # pending
            _mk_stop(3, -23.5700, -46.6800),  # pending
            _mk_stop(4, -23.5350, -46.6650),  # pending
            _mk_stop(5, -23.5750, -46.6350),  # pending
        ]
        r = api.post(f"{BASE_URL}/api/optimize", json={"stops": stops}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        result = data["stops"]
        assert len(result) == 6
        # First 2 are the done ones
        assert result[0]["status"] == "entregue"
        assert result[1]["status"] == "entregue"
        # Remaining 4 are pending
        assert all(s["status"] == "pendente" for s in result[2:])


# ============ REGRESSION: /api/geocode-batch ============
class TestGeocodeBatch:
    def test_batch_3_sp_addresses(self, api):
        payload = {
            "addresses": [
                "Av. Paulista 1000, São Paulo, SP",
                "R. Augusta 500, Consolação, São Paulo",
                "Rua Oscar Freire 200, Jardins, São Paulo",
            ]
        }
        r = api.post(f"{BASE_URL}/api/geocode-batch", json=payload, timeout=45)
        assert r.status_code == 200, r.text
        results = r.json().get("results", [])
        assert len(results) == 3
        for i, res in enumerate(results):
            assert res.get("found") is True, f"Addr {i} not found: {res}"
            assert res.get("provider") == "google", f"Addr {i} provider != google: {res.get('provider')}"
            assert res.get("lat") is not None and res.get("lon") is not None
            # SP bounds
            assert -24.5 < res["lat"] < -23.0, f"Addr {i} lat out of SP: {res['lat']}"
            assert -47.5 < res["lon"] < -46.0, f"Addr {i} lon out of SP: {res['lon']}"


# ============ REGRESSION: /api/parse-text ============
class TestParseText:
    def test_inline_coords_cep_and_null(self, api):
        text = (
            "1 Rua Exemplo -23.5893, -46.6337 BR000000000001A\n"
            "2 Rua Segunda 01310-100 BR000000000002B\n"
            "3 Endereço sem geo BR000000000003C\n"
        )
        r = api.post(f"{BASE_URL}/api/parse-text", json={"text": text}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        stops = data.get("stops", [])
        assert len(stops) == 3, f"Expected 3 stops, got {len(stops)}"
        # Stop 0 — exact inline coords
        assert stops[0]["lat"] == pytest.approx(-23.5893, abs=0.001)
        assert stops[0]["lon"] == pytest.approx(-46.6337, abs=0.001)
        # Stop 1 — CEP-resolved (SP bounds)
        s1 = stops[1]
        assert s1.get("lat") is not None and s1.get("lon") is not None, f"stop 1 CEP not resolved: {s1}"
        assert -24.5 < s1["lat"] < -23.0
        assert -47.5 < s1["lon"] < -46.0
        # Stop 2 — no geo
        assert stops[2].get("lat") is None
        assert stops[2].get("lon") is None


# ============ REGRESSION: auth/me + parse-file ============
class TestAuthMe:
    def test_missing_token_401(self, api):
        r = api.get(f"{BASE_URL}/api/auth/me", timeout=10)
        assert r.status_code == 401
        body = r.json()
        detail = body.get("detail", "")
        assert "missing_token" in str(detail).lower() or "missing" in str(detail).lower(), \
            f"Unexpected detail: {detail}"


class TestParseFileMissing:
    def test_parse_file_no_file_422(self, api):
        # Use non-JSON POST (multipart) with no file field
        r = requests.post(f"{BASE_URL}/api/parse-file", timeout=10)
        assert r.status_code == 422, f"Expected 422, got {r.status_code}: {r.text[:200]}"
