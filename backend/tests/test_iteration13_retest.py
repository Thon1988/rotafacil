"""Iteration 13 — RE-TEST of iteration 12 AT-code stripping bug fix.

Focus (per E1 request):
1. /api/parse-text — 3 Circuit rows: verify cliente, codigo_at, endereco has NO
   AT code and NO customer name leakage.
2. STATIC — server.py line ~199 CODE/NOISE pattern uses AT[0-9A-Z]{10,14};
   line ~447 uses _AT_CODE_RE.sub.
3. Regression /api/optimize — 5 SP stops → 200 with metrics.total_distance_km > 0.
4. Regression /api/geocode-batch — 3 SP addresses → provider='google' all.
5. Regression /api/auth/me no token → 401 with missing_token wording.
"""
import os
import re
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://rota-facil-mobile.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---- 1. parse-text: cliente + codigo_at extraction, no AT / no name in endereco
def test_parse_text_strips_at_code_and_name_from_endereco(api):
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

    expected = [
        ("MILTON AMARAL PEREIRA", "AT202607036QXO9"),
        ("Ana Silva Costa", "AT202607036QXP0"),
        ("CARLOS RIBEIRO MENDES", "AT202607036QXQ1"),
    ]
    # order by codigo for stable mapping
    stops_by_at = {s["codigo_at"]: s for s in stops}
    for name, at in expected:
        assert at in stops_by_at, f"{at} not found in {stops_by_at.keys()}"
        stop = stops_by_at[at]
        # (a) cliente correct
        assert stop["cliente"] == name, f"cliente mismatch for {at}: {stop}"
        # (b) codigo_at correct
        assert stop["codigo_at"] == at
        # (c) endereco has NO AT code — no 'AT202' substring per stop
        endereco = stop["endereco"]
        assert "AT202" not in endereco, f"AT code still in endereco: {endereco}"
        # Extra: any AT[0-9A-Z]{10,14} pattern?
        assert not re.search(r"AT[0-9A-Z]{10,14}", endereco), f"AT-like token in endereco: {endereco}"
        # (d) endereco has NO customer name leakage
        assert name not in endereco, f"customer name {name!r} leaked into endereco: {endereco}"
        # sanity: endereco should still contain some street token
        assert len(endereco) >= 10, f"endereco too short/empty: {endereco}"


# ---- 2. STATIC — line ~199 NOISE_PATTERNS and line ~447 use the right regex
def test_static_at_pattern_uses_10_to_14_range():
    src = open("/app/backend/server.py", "r").read()
    # NOISE_PATTERNS list should contain AT[0-9A-Z]{10,14}
    assert re.search(r'r"AT\[0-9A-Z\]\{10,14\}"', src), \
        "NOISE_PATTERNS entry AT[0-9A-Z]{10,14} not found"
    # Must NOT contain the old broken pattern
    assert r"AT\d{10}[A-Z]{2,4}\d*" not in src, "old broken AT regex still present"
    # extract_codes_and_addresses uses _AT_CODE_RE.sub
    assert "_AT_CODE_RE.sub" in src, "_AT_CODE_RE.sub not used"
    # cliente strip line present
    assert "re.sub(re.escape(cliente_val)" in src, "cliente_val strip from raw not found"


# ---- 3. Regression /api/optimize with 5 SP stops
def test_optimize_5_sp_stops_regression(api):
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
    r = api.post(f"{BASE_URL}/api/optimize", json=payload, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("metrics"), data
    total = data["metrics"]["total_distance_km"]
    assert total > 0, f"expected total_distance_km > 0, got {total}"
    # provider hint (any of these acceptable)
    prov = data.get("provider") or data["metrics"].get("provider") or ""
    print(f"optimize total_km={total} provider={prov}")


# ---- 4. Regression /api/geocode-batch — 3 SP addresses provider=google
def test_geocode_batch_google_provider(api):
    payload = {
        "addresses": [
            "Avenida Paulista, 1000, São Paulo, SP",
            "Rua Augusta, 500, São Paulo, SP",
            "Alameda Santos, 150, São Paulo, SP",
        ]
    }
    r = api.post(f"{BASE_URL}/api/geocode-batch", json=payload, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    results = data.get("results", [])
    assert len(results) == 3, results
    for res in results:
        assert res.get("provider") == "google", res


# ---- 5. Regression /api/auth/me no token → 401
def test_auth_me_no_token_401(api):
    r = api.get(f"{BASE_URL}/api/auth/me", timeout=15)
    assert r.status_code == 401, r.text
    try:
        body = r.json()
        body_str = str(body).lower()
        # accept 'missing_token' or a similar auth-missing marker
        assert "missing" in body_str or "token" in body_str or "unauthor" in body_str, body
    except ValueError:
        # non-JSON body — still ok if 401
        pass
