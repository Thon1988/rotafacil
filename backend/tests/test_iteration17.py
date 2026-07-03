"""
Iteration 17 — scanner.tsx bug fix regression + static checks.

Bug: scanning a package was auto-marking the stop as "entregue" (delivered).
Fix: scanner now only identifies/announces via TTS; driver must press "Entregue".

Static checks target /app/frontend/app/scanner.tsx. Backend regressions:
- /api/optimize (ortools_haversine) with 5 SP stops
- /api/parse-text with the iteration-12 space-separated payload
- /api/parse-file returns 422 for missing file
- /api/auth/me returns 401 missing_token when no token provided
"""
import os
import re
import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://rota-facil-mobile.preview.emergentagent.com",
).rstrip("/")

SCANNER_PATH = "/app/frontend/app/scanner.tsx"


@pytest.fixture
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ------------------- STATIC #1: CODE-MATCH branch does not auto-deliver -------------------
def test_static_scanner_code_match_no_entregue():
    src = open(SCANNER_PATH, "r").read()
    # locate processCode block
    m = re.search(r"const processCode = useCallback\(([\s\S]*?)\n    \},\s*\n\s*\[stops, speakStop\]\s*\)", src)
    assert m, "processCode useCallback block not found"
    body = m.group(1)
    # Must NOT contain entregue-status mutation inside processCode
    assert 'status: "entregue"' not in body, "processCode must not set status entregue anymore"
    assert "status: 'entregue'" not in body
    # Must contain the SCAN-ONLY comment marker
    assert re.search(r"SCAN ONLY IDENTIFIES", body, re.IGNORECASE), \
        "processCode must document SCAN ONLY IDENTIFIES intent"
    # feedback msg must start with 📦 Parada (not ✅)
    assert "📦 Parada" in body, "feedback should use 📦 emoji"
    # color must reference COLORS.primary (not only COLORS.success)
    assert "COLORS.primary" in body, "feedback color should be COLORS.primary"


# ------------------- STATIC #2: confirmFallback keeps stop pendente -------------------
def test_static_confirm_fallback_no_entregue():
    src = open(SCANNER_PATH, "r").read()
    m = re.search(
        r"const confirmFallback = useCallback\(([\s\S]*?)setPendingFallback\(null\);([\s\S]*?)\}, 2200\);",
        src,
    )
    assert m, "confirmFallback useCallback block not found"
    body = m.group(1) + m.group(2)
    assert 'status: "entregue"' not in body, "confirmFallback must not set status entregue"
    assert "timestamp:" not in body, "confirmFallback must not stamp timestamp (stop stays pendente)"
    # Feedback wording — must include the (identificada) suffix
    assert "(identificada)" in body, "feedback msg must include '(identificada)'"
    assert "(atribuída)" not in body, "old 'atribuída' wording must be removed"
    assert "📦 Parada" in body


# ------------------- STATIC #3: modal button labels & order -------------------
def test_static_modal_confirm_label_is_ok():
    src = open(SCANNER_PATH, "r").read()
    # Old label must not be present
    assert "Marcar Parada" not in src, "old 'Marcar Parada' label must be gone"
    # Fallback modal confirm text must be literally OK
    # find <Text style={styles.modalConfirmText}>OK</Text>
    assert re.search(
        r"<Text style=\{styles\.modalConfirmText\}>\s*OK\s*</Text>", src
    ), "fallback modal confirm text should be OK"
    # Cancel label must remain
    assert re.search(
        r"<Text style=\{styles\.modalCancelText\}>\s*Cancelar\s*</Text>", src
    ), "modalCancelText should read Cancelar"


def test_static_modal_actions_order_cancel_then_confirm():
    """In the fallback modal actions row, Cancelar (gray) must come BEFORE
    OK (orange primary). Locate the fallback-modal modalActions block."""
    src = open(SCANNER_PATH, "r").read()
    # Isolate the fallback modal (has testID="fallback-modal")
    m = re.search(
        r'testID="fallback-modal"[\s\S]*?<View style=\{styles\.modalActions\}>([\s\S]*?)</View>',
        src,
    )
    assert m, "fallback-modal modalActions block not found"
    actions_body = m.group(1)
    cancel_idx = actions_body.find("styles.modalCancel")
    confirm_idx = actions_body.find("styles.modalConfirm")
    assert cancel_idx != -1 and confirm_idx != -1, "both buttons must be present"
    assert cancel_idx < confirm_idx, (
        "modalCancel (Cancelar/gray) must appear BEFORE modalConfirm (OK/orange) "
        "so orange sits on the right (user request)."
    )


# ------------------- REGRESSION #4: /api/optimize 5 SP stops -------------------
def test_optimize_5_sp_stops(api):
    payload = {
        "stops": [
            {"id": 1, "codigo": "BR000000001", "endereco": "Av Paulista 1000, São Paulo, SP", "lat": -23.5615, "lon": -46.6559, "status": "pendente"},
            {"id": 2, "codigo": "BR000000002", "endereco": "R Augusta 200, São Paulo, SP", "lat": -23.5555, "lon": -46.6620, "status": "pendente"},
            {"id": 3, "codigo": "BR000000003", "endereco": "Alameda Santos 500, São Paulo, SP", "lat": -23.5680, "lon": -46.6510, "status": "pendente"},
            {"id": 4, "codigo": "BR000000004", "endereco": "R Oscar Freire 300, São Paulo, SP", "lat": -23.5620, "lon": -46.6710, "status": "pendente"},
            {"id": 5, "codigo": "BR000000005", "endereco": "Av Ibirapuera 2000, São Paulo, SP", "lat": -23.5900, "lon": -46.6600, "status": "pendente"},
        ]
    }
    r = api.post(f"{BASE_URL}/api/optimize", json=payload, timeout=45)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "stops" in data
    assert len(data["stops"]) == 5, f"expected 5 stops, got {len(data['stops'])}"
    # metrics must indicate a real optimization ran
    assert "distance_km" in data or "distance" in data or "metrics" in data or "provider" in data
    # ortools/haversine — provider may or may not be echoed; ensure it's not an error string
    body_str = r.text.lower()
    assert "error" not in body_str[:200], r.text[:400]


# ------------------- REGRESSION #5: /api/parse-text iteration-12 payload -------------------
def test_parse_text_iteration12_payload(api):
    body = {
        "text": (
            "1 BR265114108628K Av Prf Edgar Santos, 514, Ap 1106 T1 03560-080 "
            "MILTON AMARAL PEREIRA AT202607036QXO9\n"
            "2 BR265114108629X Rua Estados Unidos, 200 Jardim Paulista 04528-002 "
            "Ana Silva Costa AT202607036QXP0\n"
            "3 BR265114108630Y Alameda Santos, 150 Consolação 01418-100 "
            "CARLOS RIBEIRO MENDES AT202607036QXQ1"
        )
    }
    r = api.post(f"{BASE_URL}/api/parse-text", json=body, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["total"] == 3, data
    stops = data["stops"]
    assert stops[0]["cliente"] == "MILTON AMARAL PEREIRA", stops[0]
    assert stops[0]["codigo_at"] == "AT202607036QXO9", stops[0]
    assert stops[1]["cliente"] == "Ana Silva Costa", stops[1]
    assert stops[1]["codigo_at"] == "AT202607036QXP0", stops[1]
    assert stops[2]["cliente"] == "CARLOS RIBEIRO MENDES", stops[2]
    assert stops[2]["codigo_at"] == "AT202607036QXQ1", stops[2]


# ------------------- REGRESSION #6a: /api/parse-file 422 without file -------------------
def test_parse_file_missing_returns_422():
    # multipart-less POST → FastAPI raises 422 for missing form file
    r = requests.post(f"{BASE_URL}/api/parse-file", timeout=15)
    assert r.status_code == 422, f"expected 422 got {r.status_code}: {r.text[:200]}"


# ------------------- REGRESSION #6b: /api/auth/me 401 missing_token -------------------
def test_auth_me_missing_token_returns_401(api):
    r = api.get(f"{BASE_URL}/api/auth/me", timeout=15)
    assert r.status_code == 401, f"expected 401 got {r.status_code}: {r.text[:200]}"
    # error detail should mention missing_token
    try:
        detail = r.json().get("detail", "")
    except Exception:
        detail = r.text
    assert "missing_token" in str(detail).lower(), f"detail should mention missing_token: {detail}"
