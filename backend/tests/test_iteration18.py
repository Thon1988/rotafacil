"""
Iteration 18 - Backend regression for:
  1. /api/parse-file line-by-line fallback strips cliente_val + at_code_val
     BEFORE clean_address() runs (server.py lines 510-517).
  2. /api/optimize with a large route (>25 stops) still works via OR-Tools.
"""
import io
import os
import random
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://rota-facil-mobile.preview.emergentagent.com").rstrip("/")


@pytest.fixture
def api_client():
    s = requests.Session()
    return s


# ---------- /api/parse-file fallback strip verification ----------

class TestParseFileFallbackStrip:
    def test_csv_single_line_at_and_customer_stripped(self, api_client):
        """
        CSV with ONE line containing:
          - AT code (AT202607036QXO9)
          - customer name (MILTON AMARAL PEREIRA)
          - tracking code (BR1234567890XY)
          - address (Rua Teste Fallback, 123 - Sao Paulo)
        A single-line CSV forces the fallback path (row-based needs >=2 rows).
        We assert the returned 'endereco' does NOT contain the AT code
        or the customer name (they must be stripped BEFORE clean_address).
        """
        # Single line - no row-numbered format, no >=2 matches -> falls to line-by-line
        csv_body = "AT202607036QXO9; MILTON AMARAL PEREIRA; BR1234567890XY; Rua Teste Fallback, 123 - Sao Paulo\n"
        files = {"file": ("fallback.csv", io.BytesIO(csv_body.encode("utf-8")), "text/csv")}
        r = api_client.post(f"{BASE_URL}/api/parse-file", files=files)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["total"] >= 1, data
        stop = data["stops"][0]
        endereco = stop["endereco"]
        cliente = stop.get("cliente")
        codigo_at = stop.get("codigo_at")

        # Core assertions - the strip fix (server.py L510-517) must have run
        assert "AT202607036QXO9" not in endereco, f"AT code leaked into endereco: {endereco!r}"
        assert "MILTON AMARAL PEREIRA" not in endereco, f"Customer name leaked into endereco: {endereco!r}"
        assert "MILTON" not in endereco.upper() or "PEREIRA" not in endereco.upper(), \
            f"Customer fragment leaked into endereco: {endereco!r}"

        # Sanity - the address content should still be present
        assert "Teste Fallback" in endereco or "Fallback" in endereco or "Rua Teste" in endereco, \
            f"Real address lost: {endereco!r}"

        # Sanity - extracted fields correctly set (side-effect of _extract_customer_and_at)
        assert codigo_at == "AT202607036QXO9", f"codigo_at={codigo_at!r}"
        assert cliente and "MILTON" in cliente.upper(), f"cliente={cliente!r}"

    def test_txt_fallback_multiple_lines(self, api_client):
        """
        Multiple non-row-numbered lines (each one becomes its own stop via the
        fallback path). Verify each line is cleaned independently.
        """
        txt_body = (
            "AT2025010001ABCD1; Ana Silva Costa; ML123456789BR; Av Paulista 1000 - Sao Paulo\n"
            "AT2025010002EFGH2; CARLOS RIBEIRO MENDES; BR998877665501Z; Rua Augusta 500\n"
        )
        files = {"file": ("multi.txt", io.BytesIO(txt_body.encode("utf-8")), "text/plain")}
        r = api_client.post(f"{BASE_URL}/api/parse-file", files=files)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["total"] == 2, data
        for stop in data["stops"]:
            endereco = stop["endereco"]
            assert "AT2025010001" not in endereco and "AT2025010002" not in endereco, \
                f"AT code leaked: {endereco!r}"
            assert "Ana Silva Costa" not in endereco, f"Cliente Ana leaked: {endereco!r}"
            assert "CARLOS RIBEIRO MENDES" not in endereco, f"Cliente Carlos leaked: {endereco!r}"


# ---------- /api/optimize with >25 stops ----------

class TestOptimizeLargeRoute:
    def test_optimize_30_stops_ortools(self, api_client):
        """
        Post 30 stops with lat/lon around Sao Paulo -> optimizer uses
        haversine + OR-Tools (no external Google trip). Assert 200 and
        30 stops returned.
        """
        random.seed(42)
        # Sao Paulo center ~ -23.55, -46.63
        stops = []
        for i in range(30):
            lat = -23.55 + (random.random() - 0.5) * 0.1
            lon = -46.63 + (random.random() - 0.5) * 0.1
            stops.append({
                "id": i,
                "codigo": f"BR{1000000000 + i}TEST",
                "endereco": f"Rua Teste {i}, Sao Paulo",
                "status": "pendente",
                "timestamp": None,
                "lat": lat,
                "lon": lon,
                "cliente": None,
                "codigo_at": None,
            })
        payload = {"stops": stops}
        r = api_client.post(f"{BASE_URL}/api/optimize", json=payload, timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "stops" in data
        assert len(data["stops"]) == 30, f"expected 30 stops, got {len(data['stops'])}"
        assert "metrics" in data
        assert data["metrics"].get("total_distance_km", 0) > 0, data["metrics"]
        # All stops should have their ids preserved (0..29)
        returned_ids = sorted(s["id"] for s in data["stops"])
        assert returned_ids == list(range(30)), returned_ids


# ---------- Basic health guard ----------

class TestHealth:
    def test_auth_me_requires_token(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
