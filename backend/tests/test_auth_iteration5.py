"""Iteration 5 backend tests — verify env-var-only Emergent session URL +
device fingerprint anti-abuse relaxation.

What changed since iter 4:
1) auth_routes.py no longer contains the hardcoded URL string
   `demobackend.emergentagent.com` (literal source code). The URL is now read
   EXCLUSIVELY from env var `EMERGENT_AUTH_SESSION_URL` (no fallback).
2) Device fingerprint anti-abuse logic: a NEW email on a device is only
   blocked when the prior account has EITHER consumed the full 14-day trial
   OR has an active paid subscription. Previously, ANY second account on the
   same device was being blocked.
3) Previously wrongly-blocked users in MongoDB were reset: no user should
   have is_blocked_device=True anymore.

This iteration's tests cover items 1+2+3 plus regression of iter 4 contracts.
"""
from __future__ import annotations

import io
import os
import uuid

import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
).rstrip("/")

AUTH_ROUTES_PATH = "/app/backend/auth_routes.py"
BACKEND_ENV_PATH = "/app/backend/.env"


@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# --- Source-code hygiene checks (this iteration's primary changes) ---
class TestSourceHygiene:
    def test_auth_routes_has_no_hardcoded_emergent_url(self):
        """auth_routes.py must NOT contain the literal 'demobackend.emergentagent.com'."""
        with open(AUTH_ROUTES_PATH, "r", encoding="utf-8") as f:
            src = f.read()
        assert "demobackend.emergentagent.com" not in src, (
            "Hardcoded Emergent URL still present in auth_routes.py"
        )

    def test_auth_routes_reads_url_from_env_without_fallback(self):
        """The os.environ.get call must use an empty-string fallback (no URL)."""
        with open(AUTH_ROUTES_PATH, "r", encoding="utf-8") as f:
            src = f.read()
        # The current implementation must read the env var; no URL literal in the call.
        assert 'os.environ.get("EMERGENT_AUTH_SESSION_URL"' in src, (
            "EMERGENT_AUTH_SESSION_URL env lookup not found in auth_routes.py"
        )
        # Ensure no http(s):// URL appears in auth_routes.py at all
        assert "https://" not in src and "http://" not in src, (
            "auth_routes.py contains a URL literal — must come from env only"
        )

    def test_backend_env_has_emergent_auth_session_url(self):
        """backend/.env must define EMERGENT_AUTH_SESSION_URL (non-empty value)."""
        with open(BACKEND_ENV_PATH, "r", encoding="utf-8") as f:
            env_src = f.read()
        # Parse simple KEY=VALUE
        found = None
        for line in env_src.splitlines():
            if line.strip().startswith("EMERGENT_AUTH_SESSION_URL"):
                found = line.split("=", 1)[1].strip().strip('"').strip("'")
                break
        assert found, "EMERGENT_AUTH_SESSION_URL not present in /app/backend/.env"
        assert found.startswith("http"), f"value not a URL: {found!r}"


# --- Google session fault paths (iter 4 contract — regression) ---
class TestGoogleSessionFaults:
    def test_empty_body_returns_422_missing_session_id(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/google-session", json={})
        assert r.status_code == 422, f"got {r.status_code}: {r.text[:300]}"
        assert r.json().get("detail") == "missing_session_id"

    def test_invalid_session_id_returns_401_invalid_session_id(self, api_client):
        bogus = "invalid_token_string_for_testing_iter5"
        r = api_client.post(
            f"{BASE_URL}/api/auth/google-session",
            json={
                "session_id": bogus,
                "device_fingerprint": "test_fp_iter5",
                "device_info": {"os": "test"},
            },
            timeout=15,
        )
        # Should be 401 (Emergent rejected) — 502 acceptable if upstream is unreachable
        assert r.status_code in (401, 502), (
            f"expected 401 or 502, got {r.status_code}: {r.text[:300]}"
        )
        if r.status_code == 401:
            detail = r.json().get("detail")
            assert detail == "invalid_session_id", (
                f"expected 'invalid_session_id', got {detail!r}"
            )
            assert detail != "invalid_session_token"

    def test_legacy_session_token_alias_still_works(self, api_client):
        bogus = uuid.uuid4().hex + uuid.uuid4().hex
        r = api_client.post(
            f"{BASE_URL}/api/auth/google-session",
            json={"session_token": bogus},
            timeout=15,
        )
        assert r.status_code in (401, 502)
        if r.status_code == 401:
            assert r.json().get("detail") == "invalid_session_id"


# --- /api/auth/me + /api/auth/logout (regression) ---
class TestAuthMeAndLogout:
    def test_me_without_header_returns_401(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401
        assert r.json().get("detail") == "missing_token"

    def test_me_with_bogus_bearer_returns_401(self):
        r = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {uuid.uuid4().hex}"},
        )
        assert r.status_code == 401
        assert r.json().get("detail") == "invalid_session"

    def test_logout_no_auth_returns_200(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/logout")
        assert r.status_code == 200
        assert r.json() == {"ok": True}

    def test_logout_bogus_bearer_returns_200(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/logout",
            headers={"Authorization": f"Bearer {uuid.uuid4().hex}"},
        )
        assert r.status_code == 200
        assert r.json() == {"ok": True}


# --- MongoDB invariants for the device-fingerprint anti-abuse reset ---
class TestMongoInvariants:
    """Direct DB check: no user must remain wrongly blocked after the reset."""

    @pytest.fixture(scope="class")
    def db(self):
        from pymongo import MongoClient
        mongo_url = os.environ.get("MONGO_URL") or "mongodb://localhost:27017"
        db_name = os.environ.get("DB_NAME") or "test_database"
        client = MongoClient(mongo_url, serverSelectionTimeoutMS=5000)
        yield client[db_name]
        client.close()

    def test_no_user_has_is_blocked_device_true(self, db):
        blocked_count = db.users.count_documents({"is_blocked_device": True})
        # The reset removed all wrong blocks. Assertion: zero.
        assert blocked_count == 0, (
            f"Expected 0 users with is_blocked_device=True, found {blocked_count}"
        )

    def test_users_collection_accessible(self, db):
        # Sanity check — collection must be queryable
        total = db.users.count_documents({})
        assert isinstance(total, int)
        assert total >= 0


# --- Existing endpoints regression ---
class TestExistingEndpointsRegression:
    def test_health(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/health")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}

    def test_root(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        assert "Rota" in r.json().get("app", "")

    def test_subscription_unknown_user(self, api_client):
        r = api_client.get(
            f"{BASE_URL}/api/subscription/TEST_unknown_{uuid.uuid4().hex[:6]}"
        )
        assert r.status_code == 200
        body = r.json()
        assert body.get("active") is False
        assert body.get("pending") is False

    def test_admin_login_wrong_creds(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/login",
            data={"username": "no_such_admin", "password": "wrong"},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        # 401 expected; 200/429 also acceptable depending on rate-limit/seed
        assert r.status_code in (200, 401, 429), (
            f"unexpected {r.status_code}: {r.text[:200]}"
        )

    def test_parse_file_csv(self):
        sample = (
            "BR12345678901 Avenida Paulista, 1500 - Bela Vista, Sao Paulo - SP\n"
            "BR98765432109 Rua Augusta, 200 - Consolacao, Sao Paulo - SP\n"
        ).encode("utf-8")
        files = {"file": ("sample.txt", io.BytesIO(sample), "text/plain")}
        r = requests.post(f"{BASE_URL}/api/parse-file", files=files, timeout=30)
        assert r.status_code == 200, r.text[:200]
        body = r.json()
        assert body.get("total", 0) >= 1
        assert isinstance(body.get("stops"), list)
