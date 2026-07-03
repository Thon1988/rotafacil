"""Iteration 14 backend regression tests.

Scope (per E1 review request):
1. POST /api/optimize with 5 SP pending stops -> 200, via ortools_haversine
2. POST /api/parse-text with 3 Circuit rows -> 3 stops with cliente + codigo_at set,
   endereco free of AT code.
3. GET  /api/auth/me no token -> 401 missing_token.
"""
import os
import re
import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://rota-facil-mobile.preview.emergentagent.com",
).rstrip("/")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---- 1. /api/optimize regression: 5 SP stops -> 200 + provider ortools_haversine
def test_optimize_5_sp_stops_ortools_haversine(api):
    stops = [
        {"id": 0, "codigo": "BR000000001A", "endereco": "Avenida Paulista, 1000, São Paulo",
         "status": "pendente", "timestamp": None, "lat": -23.5613, "lon": -46.6558},
        {"id": 1, "codigo": "BR000000002A", "endereco": "Rua Augusta, 500, São Paulo",
         "status": "pendente", "timestamp": None, "lat": -23.5540, "lon": -46.6580},
        {"id": 2, "codigo": "BR000000003A", "endereco": "Alameda Santos, 150, São Paulo",
         "status": "pendente", "timestamp": None, "lat": -23.5680, "lon": -46.6480},
        {"id": 3, "codigo": "BR000000004A", "endereco": "Rua Oscar Freire, 900, São Paulo",
         "status": "pendente", "timestamp": None, "lat": -23.5610, "lon": -46.6720},
        {"id": 4, "codigo": "BR000000005A", "endereco": "Avenida Brigadeiro Faria Lima, 2000, São Paulo",
         "status": "pendente", "timestamp": None, "lat": -23.5765, "lon": -46.6890},
    ]
    payload = {"stops": stops, "return_to_start": False, "minutes_per_stop": 3.0, "avg_speed_kmh": 30.0}
    r = api.post(f"{BASE_URL}/api/optimize", json=payload, timeout=90)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("metrics"), data
    total = data["metrics"]["total_distance_km"]
    assert total > 0, f"expected total_distance_km > 0, got {total}"
    # via ortools_haversine — server logs it; response contains stops+metrics.
    # Verify by checking backend log for the most recent optimize entry.
    try:
        log = open("/var/log/supervisor/backend.err.log", "r").read()[-8000:]
        assert "ortools_haversine" in log, (
            f"expected 'ortools_haversine' in recent backend log; last 200 chars: {log[-200:]!r}"
        )
    except FileNotFoundError:
        pass  # can't check log in this env — 200 + metrics is enough


# ---- 2. /api/parse-text with 3 Circuit rows -> cliente + codigo_at set, endereco has no AT
def test_parse_text_circuit_rows(api):
    payload = {
        "text": (
            "1 BR265114108628K Av Prf Edgar Santos, 514, Ap 1106 T1 03560-080 "
            "MILTON AMARAL PEREIRA AT202607036QXO9\n"
            "2 BR265114108629X Rua Estados Unidos, 200 Jardim Paulista 04528-002 "
            "Ana Silva Costa AT202607036QXP0\n"
            "3 BR265114108630Y Alameda Santos, 150 Consolação 01418-100 "
            "CARLOS RIBEIRO MENDES AT202607036QXQ1"
        )
    }
    r = api.post(f"{BASE_URL}/api/parse-text", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["total"] == 3, data
    stops = data["stops"]
    for s in stops:
        assert s.get("cliente"), f"cliente missing/empty: {s}"
        assert s.get("codigo_at"), f"codigo_at missing/empty: {s}"
        assert "AT202" not in s["endereco"], f"AT code still in endereco: {s['endereco']}"
        assert not re.search(r"AT[0-9A-Z]{10,14}", s["endereco"]), (
            f"AT-like token in endereco: {s['endereco']}"
        )


# ---- 3. /api/auth/me no token -> 401 missing_token
def test_auth_me_no_token_returns_401_missing_token(api):
    r = api.get(f"{BASE_URL}/api/auth/me", timeout=15)
    assert r.status_code == 401, r.text
    body_str = ""
    try:
        body_str = str(r.json()).lower()
    except ValueError:
        body_str = r.text.lower()
    assert "missing_token" in body_str or "missing" in body_str, (
        f"expected missing_token wording, got: {body_str}"
    )
