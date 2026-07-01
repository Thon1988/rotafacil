"""Iteration 7 — /api/geocode-batch regression test (used by route.tsx backgroundGeocode)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "https://rota-facil-mobile.preview.emergentagent.com").rstrip("/")


@pytest.fixture
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestGeocodeBatch:
    def test_geocode_batch_two_addresses(self, api_client):
        payload = {
            "addresses": [
                "Avenida Paulista 1578, São Paulo, SP",
                "Rua Augusta 500, São Paulo, SP",
            ]
        }
        r = api_client.post(f"{BASE_URL}/api/geocode-batch", json=payload, timeout=30)
        assert r.status_code == 200, f"expected 200 got {r.status_code}: {r.text[:400]}"
        data = r.json()
        assert "results" in data, f"missing 'results' in {data}"
        results = data["results"]
        assert len(results) == 2, f"expected 2 results, got {len(results)}"
        for i, item in enumerate(results):
            assert "found" in item, f"result[{i}] missing 'found': {item}"
            assert isinstance(item["found"], bool)
            if item["found"]:
                assert isinstance(item.get("lat"), (int, float)), f"lat not numeric: {item}"
                assert isinstance(item.get("lon"), (int, float)), f"lon not numeric: {item}"
                # São Paulo bounds sanity
                assert -24.5 < item["lat"] < -23.0, f"lat out of SP bounds: {item['lat']}"
                assert -47.0 < item["lon"] < -46.0, f"lon out of SP bounds: {item['lon']}"
        # At least ONE of the two well-known SP addresses should resolve
        assert any(r["found"] for r in results), f"no address resolved: {results}"

    def test_geocode_batch_empty(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/geocode-batch", json={"addresses": []}, timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert data.get("results") == []
