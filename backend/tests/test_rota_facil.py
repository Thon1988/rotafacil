"""Backend tests for Rota Fácil API (Brazil delivery route optimization)."""
import os
import uuid
import pytest
import requests

BASE_URL = "https://rota-facil-mobile.preview.emergentagent.com"
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------- Health ----------
def test_root_metadata(session):
    r = session.get(f"{API}/")
    assert r.status_code == 200
    data = r.json()
    assert data.get("app") == "Rota Fácil API"
    assert "version" in data


# ---------- Parsing ----------
def test_parse_text_br_and_mlb_codes(session):
    text = "BR12345678901 Avenida Paulista 1500 SP\nMLB1234567890 Rua Augusta 200 SP\nLZ123456789BR Av Brasil 50 RJ"
    r = session.post(f"{API}/parse-text", json={"text": text})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["total"] >= 2
    codes = [s["codigo"] for s in data["stops"]]
    assert "BR12345678901" in codes
    assert "MLB1234567890" in codes
    for s in data["stops"]:
        assert s["status"] == "pendente"
        assert s["endereco"] and len(s["endereco"]) > 3


def test_parse_text_empty(session):
    r = session.post(f"{API}/parse-text", json={"text": ""})
    assert r.status_code == 200
    assert r.json()["total"] == 0


def test_parse_file_csv(session):
    csv = "BR99988877766,Rua das Flores 100 SP\nMLB9876543210,Av. Brasil 200 RJ\n"
    files = {"file": ("test.csv", csv.encode("utf-8"), "text/csv")}
    r = requests.post(f"{API}/parse-file", files=files)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["total"] == 2
    codes = [s["codigo"] for s in data["stops"]]
    assert "BR99988877766" in codes


def test_parse_file_txt(session):
    txt = b"BR11122233344 Rua A 10 SP\n"
    files = {"file": ("list.txt", txt, "text/plain")}
    r = requests.post(f"{API}/parse-file", files=files)
    assert r.status_code == 200
    assert r.json()["total"] == 1


# ---------- Geocoding (Nominatim, slow ~1s/addr) ----------
@pytest.mark.timeout(30)
def test_geocode_batch_sao_paulo(session):
    payload = {"addresses": ["Avenida Paulista 1000, São Paulo"]}
    r = session.post(f"{API}/geocode-batch", json=payload, timeout=25)
    assert r.status_code == 200, r.text
    results = r.json()["results"]
    assert len(results) == 1
    res = results[0]
    # May not always find - but if found should have valid coordinates
    if res["found"]:
        assert -25 < res["lat"] < -22
        assert -47 < res["lon"] < -46


# ---------- Optimization ----------
def test_optimize_route_nearest_neighbor(session):
    stops = [
        {"id": 0, "codigo": "BR1", "endereco": "A", "status": "pendente", "lat": -23.55, "lon": -46.63},
        {"id": 1, "codigo": "BR2", "endereco": "B", "status": "pendente", "lat": -23.60, "lon": -46.70},
        {"id": 2, "codigo": "BR3", "endereco": "C", "status": "pendente", "lat": -23.56, "lon": -46.64},
    ]
    r = session.post(f"{API}/optimize", json={"stops": stops})
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data["stops"]) == 3
    # Closest to id=0 is id=2 (very close), then id=1
    assert data["stops"][1]["codigo"] == "BR3"
    assert data["stops"][2]["codigo"] == "BR2"


def test_optimize_route_single_stop(session):
    stops = [{"id": 0, "codigo": "BR1", "endereco": "A", "status": "pendente", "lat": -23.5, "lon": -46.6}]
    r = session.post(f"{API}/optimize", json={"stops": stops})
    assert r.status_code == 200
    assert len(r.json()["stops"]) == 1


# ---------- PIX ----------
@pytest.fixture(scope="module")
def user_and_pix(session):
    user_id = f"TEST_user_{uuid.uuid4().hex[:8]}"
    r = session.post(f"{API}/pix/generate", json={"user_id": user_id})
    assert r.status_code == 200, r.text
    data = r.json()
    return user_id, data


def test_pix_generate_structure(user_and_pix):
    _, data = user_and_pix
    assert data["amount"] == 20.00
    assert "48.223.054/0001-42" == data["pix_key"]
    assert data["merchant_name"] == "ROTA FACIL"
    assert "txid" in data and len(data["txid"]) > 5


def test_pix_brcode_emv_compliant(user_and_pix):
    _, data = user_and_pix
    pix = data["pix_string"]
    assert pix.startswith("00020101021226"), f"Unexpected start: {pix[:30]}"
    # CNPJ digits embedded
    assert "48223054000142" in pix
    # Amount in payload
    assert "5405" in pix and "20.00" in pix
    # CRC16 footer: "6304" + 4 hex chars at end
    assert pix[-8:-4] == "6304"
    crc = pix[-4:]
    assert all(c in "0123456789ABCDEF" for c in crc), f"CRC not hex: {crc}"


def test_pix_confirm_activates_subscription(session, user_and_pix):
    user_id, data = user_and_pix
    txid = data["txid"]

    r = session.post(f"{API}/pix/confirm", json={"user_id": user_id, "txid": txid})
    assert r.status_code == 200, r.text
    confirm = r.json()
    assert confirm["active"] is True
    assert confirm["expires_at"]

    # Verify subscription persisted via GET
    sub_r = session.get(f"{API}/subscription/{user_id}")
    assert sub_r.status_code == 200
    sub = sub_r.json()
    assert sub["active"] is True
    assert 28 <= sub["days_remaining"] <= 30


def test_pix_confirm_invalid_txid(session):
    r = session.post(f"{API}/pix/confirm", json={"user_id": "ghost", "txid": "INVALIDTXID12345"})
    assert r.status_code == 404


def test_subscription_unknown_user(session):
    r = session.get(f"{API}/subscription/UNKNOWN_USER_xyz")
    assert r.status_code == 200
    data = r.json()
    assert data["active"] is False
    assert data["days_remaining"] == 0
