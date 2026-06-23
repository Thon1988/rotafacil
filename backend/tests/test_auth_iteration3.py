"""Iteration 3 backend tests — Google Auth + Trial + Device Fingerprint.

Covers the new /api/auth/* endpoints (fault paths only — real Google sign-in
cannot be completed in CI) plus regression checks on /health, /parse-file,
/subscription/{id}, and /admin/login. Also verifies the Mongo indexes
created at startup.
"""
from __future__ import annotations

import io
import os
import uuid

import pytest
import requests
from pymongo import MongoClient

# Backend public URL (read from frontend .env via env var; fall back to
# the EXPO_PUBLIC_BACKEND_URL we have in frontend/.env).
BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://rota-facil-mobile.preview.emergentagent.com"
).rstrip("/")


@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# --- /api/auth/google-session fault paths ---
class TestGoogleSessionFaults:
    def test_missing_session_token_returns_422(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/google-session", json={})
        assert r.status_code == 422, f"expected 422, got {r.status_code}: {r.text[:200]}"

    def test_short_session_token_returns_422(self, api_client):
        # min_length=8 → "short" should fail validation
        r = api_client.post(
            f"{BASE_URL}/api/auth/google-session",
            json={"session_token": "short"},
        )
        assert r.status_code == 422, f"expected 422, got {r.status_code}: {r.text[:200]}"

    def test_invalid_session_token_returns_401(self, api_client):
        # Valid length but bogus token — Emergent verify must reject it
        bogus = uuid.uuid4().hex + uuid.uuid4().hex  # 64 hex chars
        r = api_client.post(
            f"{BASE_URL}/api/auth/google-session",
            json={
                "session_token": bogus,
                "device_fingerprint": "test_fp_iter3",
                "device_info": {"os": "test"},
            },
            timeout=15,
        )
        # Backend should map invalid Emergent token → 401 invalid_session_token.
        # If upstream is unreachable it returns 502 (auth_provider_unreachable).
        assert r.status_code in (401, 502), (
            f"expected 401 or 502, got {r.status_code}: {r.text[:200]}"
        )
        if r.status_code == 401:
            body = r.json()
            assert body.get("detail") == "invalid_session_token", body


# --- /api/auth/me fault paths ---
class TestAuthMe:
    def test_me_without_header_returns_401(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text[:200]}"
        assert r.json().get("detail") == "missing_token"

    def test_me_with_non_bearer_header_returns_401(self, api_client):
        r = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": "Basic foo"},
        )
        assert r.status_code == 401
        assert r.json().get("detail") == "missing_token"

    def test_me_with_empty_bearer_returns_401(self, api_client):
        r = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": "Bearer "},
        )
        # Either "invalid_token" (empty token after split) or "missing_token"
        assert r.status_code == 401
        assert r.json().get("detail") in ("invalid_token", "missing_token")

    def test_me_with_bogus_bearer_returns_401(self, api_client):
        r = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {uuid.uuid4().hex}"},
        )
        assert r.status_code == 401
        assert r.json().get("detail") == "invalid_session"


# --- /api/auth/logout idempotent ---
class TestAuthLogout:
    def test_logout_no_auth_returns_200(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/logout")
        assert r.status_code == 200
        assert r.json() == {"ok": True}

    def test_logout_bogus_bearer_returns_200(self, api_client):
        r = requests.post(
            f"{BASE_URL}/api/auth/logout",
            headers={"Authorization": f"Bearer {uuid.uuid4().hex}"},
        )
        assert r.status_code == 200
        assert r.json() == {"ok": True}


# --- Mongo indexes (assert all expected indexes exist) ---
class TestMongoIndexes:
    @pytest.fixture(scope="class")
    def db(self):
        mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
        db_name = os.environ.get("DB_NAME", "test_database")
        client = MongoClient(mongo_url, serverSelectionTimeoutMS=5000)
        # Make sure backend has had a chance to create indexes by pinging /health
        try:
            requests.get(f"{BASE_URL}/api/health", timeout=5)
        except Exception:
            pass
        yield client[db_name]
        client.close()

    def test_users_email_unique(self, db):
        idx = db.users.index_information()
        # Find an index that covers ("email", 1) and is unique
        match = [v for v in idx.values()
                 if v.get("key") == [("email", 1)] and v.get("unique")]
        assert match, f"users.email unique index missing. have: {list(idx.keys())}"

    def test_users_user_id_unique(self, db):
        idx = db.users.index_information()
        match = [v for v in idx.values()
                 if v.get("key") == [("user_id", 1)] and v.get("unique")]
        assert match, f"users.user_id unique index missing. have: {list(idx.keys())}"

    def test_users_device_fingerprint(self, db):
        idx = db.users.index_information()
        match = [v for v in idx.values()
                 if v.get("key") == [("device_fingerprint", 1)]]
        assert match, f"users.device_fingerprint index missing. have: {list(idx.keys())}"

    def test_sessions_session_token_unique(self, db):
        idx = db.user_sessions.index_information()
        match = [v for v in idx.values()
                 if v.get("key") == [("session_token", 1)] and v.get("unique")]
        assert match, f"user_sessions.session_token unique index missing. have: {list(idx.keys())}"

    def test_sessions_expires_at_ttl(self, db):
        idx = db.user_sessions.index_information()
        match = [v for v in idx.values()
                 if v.get("key") == [("expires_at", 1)] and "expireAfterSeconds" in v]
        assert match, f"user_sessions.expires_at TTL index missing. have: {list(idx.keys())}"


# --- Existing endpoints regression ---
class TestExistingEndpoints:
    def test_health(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/health")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}

    def test_root(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        assert "Rota" in r.json().get("app", "")

    def test_subscription_unknown_user(self, api_client):
        # legacy device-local user id endpoint must still work
        r = api_client.get(f"{BASE_URL}/api/subscription/TEST_unknown_{uuid.uuid4().hex[:6]}")
        assert r.status_code == 200
        body = r.json()
        assert body.get("active") is False
        assert body.get("pending") is False

    def test_admin_login_wrong_creds(self, api_client):
        # Don't try the real password; just confirm 401 path still wired
        r = requests.post(
            f"{BASE_URL}/api/admin/login",
            data={"username": "no_such_admin", "password": "wrong"},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        # Either 401 (creds), 429 (rate limited from prior tests/honeypot), or 200 (honeypot drop)
        assert r.status_code in (200, 401, 429), f"unexpected {r.status_code}: {r.text[:200]}"

    def test_parse_file_csv(self, api_client):
        # Plain-text fallback path (parse_csv) for a tiny sample
        sample = (
            "BR12345678901 Avenida Paulista, 1500 - Bela Vista, Sao Paulo - SP\n"
            "BR98765432109 Rua Augusta, 200 - Consolacao, Sao Paulo - SP\n"
        ).encode("utf-8")
        files = {"file": ("sample.txt", io.BytesIO(sample), "text/plain")}
        r = requests.post(f"{BASE_URL}/api/parse-file", files=files, timeout=20)
        assert r.status_code == 200, r.text[:200]
        body = r.json()
        assert body.get("total", 0) >= 1
        assert isinstance(body.get("stops"), list)
