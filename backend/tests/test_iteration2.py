"""Iteration 2 tests: Admin auth, honeypot, PIX flow change, history, stats."""
import os
import uuid
import time
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://rota-facil-mobile.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_USER = "admin"
ADMIN_PASS = "*Mespykes007"

# Direct mongo access to reset audit_logs between tests
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


@pytest.fixture(scope="module")
def db():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(autouse=True)
def reset_audit(db):
    db.audit_logs.delete_many({})
    yield


@pytest.fixture
def session():
    s = requests.Session()
    return s


def _login(session, username, password):
    return session.post(
        f"{API}/admin/login",
        data={"username": username, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )


# ========= ADMIN AUTH =========
class TestAdminAuth:
    def test_login_success_real_admin(self, session):
        r = _login(session, ADMIN_USER, ADMIN_PASS)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "access_token" in data
        # decode without verifying to inspect hp claim
        import base64, json
        token = data["access_token"]
        payload_b64 = token.split(".")[1]
        payload_b64 += "=" * (-len(payload_b64) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload_b64))
        assert claims.get("hp") is False
        assert claims.get("sub") == "admin"

    def test_login_wrong_password_first_two_attempts_401(self, session):
        r1 = _login(session, ADMIN_USER, "wrong1")
        assert r1.status_code == 401
        assert "Credenciais" in r1.text or "invalid" in r1.text.lower()
        r2 = _login(session, ADMIN_USER, "wrong2")
        assert r2.status_code == 401


class TestHoneypot:
    def test_third_failure_returns_honeypot_jwt(self, session):
        # 3 fails from same IP within 60min triggers honeypot
        _login(session, ADMIN_USER, "wrong1")
        _login(session, ADMIN_USER, "wrong2")
        r3 = _login(session, ADMIN_USER, "wrong3")
        assert r3.status_code == 200, f"expected honeypot 200, got {r3.status_code}: {r3.text}"
        token = r3.json()["access_token"]
        import base64, json
        payload_b64 = token.split(".")[1] + "==="
        claims = json.loads(base64.urlsafe_b64decode(payload_b64[:-(len(payload_b64) % 4 or 4)] + "===")[:9999] if False else base64.urlsafe_b64decode(token.split(".")[1] + "==="))
        assert claims.get("hp") is True
        return token

    def test_honeypot_pending_payments_returns_fake_with_decoy(self, session):
        _login(session, ADMIN_USER, "wrong1")
        _login(session, ADMIN_USER, "wrong2")
        token = _login(session, ADMIN_USER, "wrong3").json()["access_token"]
        r = session.get(f"{API}/admin/pending-payments", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        data = r.json()
        assert "items" in data
        assert len(data["items"]) > 0
        assert "_decoy_hint" in data
        assert "/api/admin/level/2" in data["_decoy_hint"]
        # All txids should be FAKE prefixed
        assert all(item["txid"].startswith("FAKE") for item in data["items"])

    def test_real_admin_level_endpoint_returns_404(self, session):
        token = _login(session, ADMIN_USER, ADMIN_PASS).json()["access_token"]
        r = session.get(f"{API}/admin/level/2", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 404

    def test_honeypot_level_returns_fake_with_next_url(self, session):
        _login(session, ADMIN_USER, "wrong1")
        _login(session, ADMIN_USER, "wrong2")
        token = _login(session, ADMIN_USER, "wrong3").json()["access_token"]
        r = session.get(f"{API}/admin/level/2", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        data = r.json()
        assert data["level"] == 2
        assert "next_level_url" in data
        assert "/api/admin/level/3" in data["next_level_url"]
        assert "items" in data and len(data["items"]) > 0


# ========= PIX FLOW =========
class TestPixFlow:
    def test_pix_generate_includes_whatsapp(self, session):
        uid = f"TEST_user_{uuid.uuid4().hex[:8]}"
        r = session.post(f"{API}/pix/generate", json={"user_id": uid})
        assert r.status_code == 200
        data = r.json()
        assert "whatsapp_number" in data and data["whatsapp_number"] == "5511983454007"
        assert "whatsapp_message" in data and "TXID" in data["whatsapp_message"]
        assert "txid" in data
        assert data["pix_string"].startswith("00020101")

    def test_submit_payment_sets_pending_approval_not_active(self, session, db):
        uid = f"TEST_user_{uuid.uuid4().hex[:8]}"
        gen = session.post(f"{API}/pix/generate", json={"user_id": uid}).json()
        txid = gen["txid"]
        r = session.post(f"{API}/pix/submit-payment", json={"user_id": uid, "txid": txid, "customer_name": "TEST User"})
        assert r.status_code == 200
        assert r.json()["status"] == "pending_approval"
        # subscription should report pending=true, active=false
        sub = session.get(f"{API}/subscription/{uid}").json()
        assert sub["active"] is False
        assert sub["pending"] is True

    def test_admin_approve_activates_subscription(self, session, db):
        uid = f"TEST_user_{uuid.uuid4().hex[:8]}"
        gen = session.post(f"{API}/pix/generate", json={"user_id": uid}).json()
        txid = gen["txid"]
        session.post(f"{API}/pix/submit-payment", json={"user_id": uid, "txid": txid, "customer_name": "TEST User"})
        # login as REAL admin
        token = _login(session, ADMIN_USER, ADMIN_PASS).json()["access_token"]
        r = session.post(
            f"{API}/admin/approve-payment",
            json={"txid": txid},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        assert "expires_at" in r.json()
        sub = session.get(f"{API}/subscription/{uid}").json()
        assert sub["active"] is True
        assert sub["days_remaining"] >= 28

    def test_admin_reject_payment(self, session, db):
        uid = f"TEST_user_{uuid.uuid4().hex[:8]}"
        gen = session.post(f"{API}/pix/generate", json={"user_id": uid}).json()
        txid = gen["txid"]
        session.post(f"{API}/pix/submit-payment", json={"user_id": uid, "txid": txid, "customer_name": "X"})
        token = _login(session, ADMIN_USER, ADMIN_PASS).json()["access_token"]
        r = session.post(
            f"{API}/admin/reject-payment",
            json={"txid": txid},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        tx = db.pix_transactions.find_one({"txid": txid})
        assert tx["status"] == "rejected"


# ========= ADMIN ENDPOINTS REAL DATA =========
class TestAdminRealData:
    def test_pending_payments_real_admin(self, session):
        token = _login(session, ADMIN_USER, ADMIN_PASS).json()["access_token"]
        r = session.get(f"{API}/admin/pending-payments", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        data = r.json()
        assert "items" in data
        assert "_decoy_hint" not in data  # real admin gets no decoy

    def test_audit_logs_persist(self, session, db):
        _login(session, ADMIN_USER, "wrongX")
        time.sleep(0.2)
        logs = list(db.audit_logs.find({}))
        assert len(logs) >= 1
        last = logs[-1]
        assert "ip" in last
        assert "user_agent" in last
        assert last["success"] is False


# ========= HISTORY & STATS =========
class TestHistoryStats:
    def test_save_and_get_history(self, session):
        uid = f"TEST_user_{uuid.uuid4().hex[:8]}"
        entry = {
            "user_id": uid,
            "route_id": f"r_{uuid.uuid4().hex[:8]}",
            "started_at": "2026-01-01T10:00:00+00:00",
            "ended_at": "2026-01-01T12:00:00+00:00",
            "total_stops": 10,
            "delivered": 8,
            "failed": 2,
            "stops": [],
        }
        r = session.post(f"{API}/history/save", json=entry)
        assert r.status_code == 200
        # GET back
        rg = session.get(f"{API}/history/{uid}").json()
        assert len(rg["routes"]) == 1
        assert rg["routes"][0]["delivered"] == 8

    def test_stats_aggregate_and_badge(self, session):
        uid = f"TEST_user_{uuid.uuid4().hex[:8]}"
        # save 2 routes with delivered=30 each → week_delivered=60 → "⚡ Em ritmo"
        for i in range(2):
            session.post(f"{API}/history/save", json={
                "user_id": uid, "route_id": f"r{i}_{uuid.uuid4().hex[:6]}",
                "started_at": "2026-01-01T10:00:00+00:00",
                "total_stops": 35, "delivered": 30, "failed": 5, "stops": [],
            })
        r = session.get(f"{API}/stats/{uid}")
        assert r.status_code == 200
        data = r.json()
        assert data["week"]["delivered"] == 60
        assert data["week"]["routes"] == 2
        assert "badge" in data and data["badge"]
        assert data["best_day"] is not None
        assert data["best_day"]["delivered"] == 30
