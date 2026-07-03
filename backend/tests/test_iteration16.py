"""
Iteration 16 — verify Circuit PDF Notes-column bug fix + regression endpoints.

Bug fix under test: parse_pdf table extraction previously constructed each line as
`first_cell address code_match` which dropped the Notes column (which on Circuit
PDFs carries the customer name + phone + CEP). Now server.py appends `notes_extra`
(Notes column minus the code) — verify by simulating what parse-text sees when
that merged text is fed to /api/parse-text.
"""

import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://rota-facil-mobile.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


# ---------- BUG FIX: /api/parse-text with Notes-column merged content ----------
class TestCircuitPDFNotesFix:
    def test_parse_text_with_customer_and_cep_resolves_latlon(self):
        payload = {
            "text": (
                "1 Rua Miguel Yunes, 200 BR265114108628K MARIA SILVA COSTA 04785-010\n"
                "2 Avenida Prof Edgar Santos, 514 BR265114108629X PEDRO OLIVEIRA 03560-080"
            )
        }
        r = requests.post(f"{API}/parse-text", json=payload, timeout=45)
        assert r.status_code == 200, r.text
        data = r.json()
        stops = data["stops"]
        assert data["total"] == 2, f"expected 2 stops, got {data['total']}: {stops}"
        assert len(stops) == 2

        # First stop assertions
        s1 = stops[0]
        assert "BR265114108628K" in s1["codigo"].upper()
        assert s1.get("cliente"), f"stop1 cliente missing: {s1}"
        assert "MARIA" in (s1.get("cliente") or "").upper()
        assert s1.get("lat") is not None and s1.get("lon") is not None, (
            f"stop1 lat/lon not resolved via CEP: {s1}"
        )
        # 04785-010 is São Paulo (Interlagos) — sanity-check lat is in SP band
        assert -24.5 < s1["lat"] < -23.0, f"stop1 lat out of SP band: {s1['lat']}"

        # Second stop assertions
        s2 = stops[1]
        assert "BR265114108629X" in s2["codigo"].upper()
        assert s2.get("cliente"), f"stop2 cliente missing: {s2}"
        assert "PEDRO" in (s2.get("cliente") or "").upper()
        assert s2.get("lat") is not None and s2.get("lon") is not None, (
            f"stop2 lat/lon not resolved via CEP: {s2}"
        )
        assert -24.5 < s2["lat"] < -23.0, f"stop2 lat out of SP band: {s2['lat']}"


# ---------- BUG FIX (static): server.py contains notes_extra append logic ----------
class TestServerHasNotesExtraFix:
    def test_parse_pdf_appends_notes_extra(self):
        with open("/app/backend/server.py", "r") as f:
            src = f.read()
        assert 'notes_extra = notes_blob or ""' in src
        assert 'line_parts.append(notes_extra)' in src
        assert 're.escape(code_match)' in src
        assert 'notes_extra, flags=re.IGNORECASE' in src
        # code_match SEQ guard
        assert 'code_match.startswith("SEQ")' in src or "code_match.startswith('SEQ')" in src


# ---------- REGRESSION: /api/optimize with 5 SP pending stops ----------
class TestOptimizeRegression:
    def test_optimize_five_sp_stops(self):
        stops = [
            {"id": 0, "codigo": "TEST_A", "endereco": "Av Paulista 1000 SP", "status": "pendente",
             "lat": -23.5613, "lon": -46.6558},
            {"id": 1, "codigo": "TEST_B", "endereco": "Rua Augusta 500 SP", "status": "pendente",
             "lat": -23.5545, "lon": -46.6620},
            {"id": 2, "codigo": "TEST_C", "endereco": "Rua da Consolação 2200 SP", "status": "pendente",
             "lat": -23.5502, "lon": -46.6650},
            {"id": 3, "codigo": "TEST_D", "endereco": "Av Rebouças 300 SP", "status": "pendente",
             "lat": -23.5665, "lon": -46.6805},
            {"id": 4, "codigo": "TEST_E", "endereco": "Rua Oscar Freire 700 SP", "status": "pendente",
             "lat": -23.5626, "lon": -46.6712},
        ]
        payload = {
            "stops": stops,
            "start_lat": -23.5505,
            "start_lon": -46.6333,
            "return_to_start": False,
            "minutes_per_stop": 3,
            "avg_speed_kmh": 30,
        }
        r = requests.post(f"{API}/optimize", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "stops" in data and len(data["stops"]) == 5
        assert "metrics" in data
        # provider hint may not be in response, but total_distance_km must be set
        assert data["metrics"]["total_distance_km"] > 0


# ---------- REGRESSION: /api/geocode-batch with 3 SP addresses ----------
class TestGeocodeBatchRegression:
    def test_geocode_batch_three_sp(self):
        payload = {
            "addresses": [
                "Av Paulista 1578, Bela Vista, São Paulo, SP",
                "Rua Augusta 2690, Cerqueira César, São Paulo, SP",
                "Av Brigadeiro Faria Lima 2000, Jardim Paulistano, São Paulo, SP",
            ]
        }
        r = requests.post(f"{API}/geocode-batch", json=payload, timeout=45)
        assert r.status_code == 200, r.text
        data = r.json()
        results = data.get("results") or []
        assert len(results) == 3
        for i, res in enumerate(results):
            assert res.get("found") is True, f"addr {i} not found: {res}"
            assert res.get("provider") == "google", f"addr {i} provider={res.get('provider')}"
            assert res.get("lat") is not None and res.get("lon") is not None


# ---------- REGRESSION: /api/auth/me no token → 401 missing_token ----------
class TestAuthMeRegression:
    def test_auth_me_no_token_returns_401(self):
        r = requests.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 401, r.text
        body = r.json()
        # FastAPI-style detail
        detail = body.get("detail") or body
        detail_str = str(detail).lower()
        assert "missing_token" in detail_str or "missing" in detail_str, body
