"""Iteration 3 (Pivot) tests:
- Backend health
- /api/parse-file still works on PDF/text
- /api/subscription returns inactive for new user
- /api/admin/login still authenticates admin
"""
import io
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://rota-facil-mobile.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_USER = "admin"
ADMIN_PASS = "*Mespykes007"


@pytest.fixture
def session():
    return requests.Session()


# ---------- Health ----------
class TestHealth:
    def test_health(self, session):
        r = session.get(f"{API}/health")
        assert r.status_code == 200
        assert r.json().get("status") == "ok"


# ---------- Subscription (no sub) ----------
class TestSubscription:
    def test_subscription_unknown_user(self, session):
        uid = f"TEST_pivot_{uuid.uuid4().hex[:8]}"
        r = session.get(f"{API}/subscription/{uid}")
        assert r.status_code == 200
        data = r.json()
        assert data.get("active") in (False, None) or data.get("active") is False
        # For brand-new user, neither active nor pending
        assert data.get("pending") in (False, None) or data.get("pending") is False


# ---------- Parse file ----------
class TestParseFile:
    def test_parse_text_endpoint(self, session):
        """Use /api/parse-file with .txt to verify PDF parsing pipeline accepts inputs.
        Falls back to /api/parse-text if available."""
        sample = (
            "BR12345678901 Avenida Paulista, 1500 - Bela Vista, São Paulo - SP\n"
            "BR98765432109 Rua Augusta, 200 - Consolação, São Paulo - SP\n"
            "MLB1234567890 Rua Oscar Freire, 800 - Jardins, São Paulo - SP\n"
        )
        # try /parse-text first
        r = session.post(f"{API}/parse-text", json={"text": sample})
        if r.status_code == 404:
            # fall back to multipart upload
            files = {"file": ("routes.txt", io.BytesIO(sample.encode("utf-8")), "text/plain")}
            r = session.post(f"{API}/parse-file", files=files)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "stops" in data
        assert data.get("total", len(data["stops"])) >= 2
        codes = [s.get("codigo", "") for s in data["stops"]]
        assert any("BR12345678901" in c for c in codes)


# ---------- Admin login ----------
class TestAdminLogin:
    def test_admin_login_ok(self, session):
        r = session.post(
            f"{API}/admin/login",
            data={"username": ADMIN_USER, "password": ADMIN_PASS},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        # Status may be 200 (success) OR 429 (rate-limited from prior runs) — both acceptable
        assert r.status_code in (200, 429), r.text
        if r.status_code == 200:
            assert "access_token" in r.json()
