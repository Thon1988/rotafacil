"""Iteration 4 backend tests — Google Auth fault paths after rename
session_token → session_id (with legacy alias preserved) + regression.

What changed since iter 3:
- Backend `/api/auth/google-session` now reads either `session_id` (preferred)
  or legacy `session_token` from the body. Missing → 422 `missing_session_id`.
  Bogus value → 401 `invalid_session_id` (renamed from `invalid_session_token`).
- `EMERGENT_AUTH_SESSION_URL` is now an env-var with the official URL as default.
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
    or "https://rota-facil-mobile.preview.emergentagent.com"
).rstrip("/")


@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# --- /api/auth/google-session fault paths (new contract) ---
class TestGoogleSessionFaults:
    def test_empty_body_returns_422_missing_session_id(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/google-session", json={})
        assert r.status_code == 422, f"got {r.status_code}: {r.text[:300]}"
        body = r.json()
        # Detail must be "missing_session_id" per new contract.
        assert body.get("detail") == "missing_session_id", body

    def test_short_session_id_returns_422(self, api_client):
        # Pydantic min_length=8 should reject short strings
        r = api_client.post(
            f"{BASE_URL}/api/auth/google-session",
            json={"session_id": "short"},
        )
        assert r.status_code == 422, f"got {r.status_code}: {r.text[:300]}"

    def test_short_session_token_legacy_alias_returns_422(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/auth/google-session",
            json={"session_token": "short"},
        )
        assert r.status_code == 422, f"got {r.status_code}: {r.text[:300]}"

    def test_invalid_session_id_returns_401_invalid_session_id(self, api_client):
        bogus = "invalid_token_string_for_testing_123"
        r = api_client.post(
            f"{BASE_URL}/api/auth/google-session",
            json={
                "session_id": bogus,
                "device_fingerprint": "test_fp_iter4",
                "device_info": {"os": "test"},
            },
            timeout=15,
        )
        assert r.status_code in (401, 502), (
            f"expected 401 or 502, got {r.status_code}: {r.text[:300]}"
        )
        if r.status_code == 401:
            body = r.json()
            assert body.get("detail") == "invalid_session_id", body
            # Verify it is NOT the old "invalid_session_token" string.
            assert body.get("detail") != "invalid_session_token"

    def test_invalid_session_token_legacy_alias_returns_401(self, api_client):
        # Backwards-compat: payload sent via legacy `session_token` field
        # must STILL route through Emergent verification and yield the same
        # 401 invalid_session_id error code.
        bogus = uuid.uuid4().hex + uuid.uuid4().hex  # 64 hex chars
        r = api_client.post(
            f"{BASE_URL}/api/auth/google-session",
            json={"session_token": bogus},
            timeout=15,
        )
        assert r.status_code in (401, 502), (
            f"expected 401 or 502, got {r.status_code}: {r.text[:300]}"
        )
        if r.status_code == 401:
            assert r.json().get("detail") == "invalid_session_id"


# --- /api/auth/me fault paths (regression) ---
class TestAuthMe:
    def test_me_without_header_returns_401(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401
        assert r.json().get("detail") == "missing_token"

    def test_me_with_bogus_bearer_returns_401(self, api_client):
        r = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {uuid.uuid4().hex}"},
        )
        assert r.status_code == 401
        assert r.json().get("detail") == "invalid_session"


# --- /api/auth/logout idempotent (regression) ---
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
        r = api_client.get(
            f"{BASE_URL}/api/subscription/TEST_unknown_{uuid.uuid4().hex[:6]}"
        )
        assert r.status_code == 200
        body = r.json()
        assert body.get("active") is False
        assert body.get("pending") is False

    def test_admin_login_wrong_creds(self, api_client):
        r = requests.post(
            f"{BASE_URL}/api/admin/login",
            data={"username": "no_such_admin", "password": "wrong"},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        assert r.status_code in (200, 401, 429), (
            f"unexpected {r.status_code}: {r.text[:200]}"
        )

    def test_parse_file_csv(self, api_client):
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
