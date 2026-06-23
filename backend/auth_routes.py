"""Google Auth + 14-day Trial + Device Fingerprint anti-abuse.

This module plugs into the existing FastAPI app via `register_auth_routes(api_router, db)`.
It implements:
- POST /api/auth/google-session : exchange Emergent session_token for app session
- GET  /api/auth/me              : current user + trial status
- POST /api/auth/logout          : revoke session

Trial logic:
- Each new user gets `trial_started_at = now()` and a 14-day window.
- `/api/auth/me` returns `trial_active` and `trial_days_remaining`.

Device fingerprint anti-abuse:
- Frontend sends a hashed device id (expo-application + expo-device).
- If a device fingerprint is already linked to ANOTHER user that ALREADY consumed
  the trial OR has any PIX payment record, we block a brand-new trial on a new
  email. The original user can still log in normally.
"""

from __future__ import annotations

import hashlib
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field, EmailStr

logger = logging.getLogger("auth")

EMERGENT_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"
SESSION_LIFETIME_DAYS = 7
TRIAL_DAYS = 14


# -------- Models --------
class GoogleSessionIn(BaseModel):
    session_token: str = Field(..., min_length=8)
    device_fingerprint: Optional[str] = Field(None, max_length=128)
    device_info: Optional[dict] = None  # {"model":"...","os":"...","brand":"..."}


class AuthUserOut(BaseModel):
    user_id: str
    email: str
    name: Optional[str] = None
    picture: Optional[str] = None
    trial_started_at: Optional[str] = None
    trial_expires_at: Optional[str] = None
    trial_active: bool = False
    trial_days_remaining: int = 0
    subscription_active: bool = False
    subscription_expires_at: Optional[str] = None
    is_blocked_device: bool = False


class GoogleSessionOut(BaseModel):
    session_token: str
    user: AuthUserOut


# -------- Helpers --------
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _hash_fingerprint(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    salt = os.environ.get("DEVICE_FP_SALT", "rota_rapida_app_v1")
    return hashlib.sha256(f"{salt}:{raw}".encode("utf-8")).hexdigest()


async def _user_to_out(db, user: dict) -> AuthUserOut:
    trial_started = _ensure_aware(user.get("trial_started_at"))
    trial_expires = (
        trial_started + timedelta(days=TRIAL_DAYS) if trial_started else None
    )
    now = _now()
    trial_active = bool(trial_expires and now < trial_expires)
    trial_remaining = (
        max(0, (trial_expires - now).days + (1 if trial_active else 0))
        if trial_expires
        else 0
    )

    # Check live subscription from existing collection (keyed by user_id)
    sub_active = False
    sub_expires_at: Optional[str] = None
    try:
        sub = await db.subscriptions.find_one(
            {"user_id": user["user_id"], "status": "active"}, {"_id": 0}
        )
        if sub:
            exp = _ensure_aware(sub.get("expires_at"))
            if exp and now < exp:
                sub_active = True
                sub_expires_at = exp.isoformat()
    except Exception as e:
        logger.warning(f"sub lookup failed: {e}")

    return AuthUserOut(
        user_id=user["user_id"],
        email=user["email"],
        name=user.get("name"),
        picture=user.get("picture"),
        trial_started_at=trial_started.isoformat() if trial_started else None,
        trial_expires_at=trial_expires.isoformat() if trial_expires else None,
        trial_active=trial_active,
        trial_days_remaining=trial_remaining,
        subscription_active=sub_active,
        subscription_expires_at=sub_expires_at,
        is_blocked_device=bool(user.get("is_blocked_device", False)),
    )


async def get_current_user(
    db,
    authorization: Optional[str] = Header(None),
) -> dict:
    """Return current user dict or raise 401."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing_token")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="invalid_token")
    session = await db.user_sessions.find_one(
        {"session_token": token}, {"_id": 0}
    )
    if not session:
        raise HTTPException(status_code=401, detail="invalid_session")
    expires_at = _ensure_aware(session.get("expires_at"))
    if expires_at and _now() >= expires_at:
        # expired, clean it up
        try:
            await db.user_sessions.delete_one({"session_token": token})
        except Exception:
            pass
        raise HTTPException(status_code=401, detail="session_expired")
    user = await db.users.find_one(
        {"user_id": session["user_id"]}, {"_id": 0}
    )
    if not user:
        raise HTTPException(status_code=401, detail="user_not_found")
    return user


# -------- Routes registration --------
def register_auth_routes(api_router: APIRouter, db) -> None:
    @api_router.post("/auth/google-session", response_model=GoogleSessionOut)
    async def google_session(payload: GoogleSessionIn, request: Request):
        # 1) Verify Emergent session_token with their session-data endpoint
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.get(
                    EMERGENT_SESSION_URL,
                    headers={"X-Session-ID": payload.session_token},
                )
            if r.status_code != 200:
                raise HTTPException(status_code=401, detail="invalid_session_token")
            data = r.json()
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"emergent verify failed: {e}")
            raise HTTPException(status_code=502, detail="auth_provider_unreachable")

        email = (data.get("email") or "").lower().strip()
        if not email:
            raise HTTPException(status_code=400, detail="no_email_from_provider")
        name = data.get("name") or ""
        picture = data.get("picture") or ""

        fp_hash = _hash_fingerprint(payload.device_fingerprint)
        now = _now()

        # 2) Find existing user by email
        user = await db.users.find_one({"email": email}, {"_id": 0})

        if user is None:
            # 3) NEW USER → device fingerprint anti-abuse check
            blocked = False
            if fp_hash:
                # Has this device fingerprint already been registered with another email?
                prior = await db.users.find_one(
                    {"device_fingerprint": fp_hash}, {"_id": 0}
                )
                if prior is not None:
                    # The device already has an account. Block creating a fresh
                    # trial. The user MUST use that previous account or pay PIX.
                    blocked = True

            # Create the user
            user = {
                "user_id": f"user_{uuid.uuid4().hex[:12]}",
                "email": email,
                "name": name,
                "picture": picture,
                "device_fingerprint": fp_hash,
                "device_info": payload.device_info or {},
                "trial_started_at": now if not blocked else None,
                "is_blocked_device": blocked,
                "created_at": now,
                "updated_at": now,
                "auth_provider": "google",
            }
            try:
                await db.users.insert_one(dict(user))
            except Exception as e:
                logger.error(f"user insert failed: {e}")
                raise HTTPException(status_code=500, detail="user_create_failed")
        else:
            # 4) Existing user → update last login + maybe attach fingerprint
            update_doc = {"updated_at": now, "name": name or user.get("name"), "picture": picture or user.get("picture")}
            if fp_hash and not user.get("device_fingerprint"):
                update_doc["device_fingerprint"] = fp_hash
            if payload.device_info and not user.get("device_info"):
                update_doc["device_info"] = payload.device_info
            await db.users.update_one(
                {"user_id": user["user_id"]}, {"$set": update_doc}
            )
            user.update(update_doc)

        # 5) Create local session
        session_token = uuid.uuid4().hex + uuid.uuid4().hex  # 64 hex chars
        expires_at = now + timedelta(days=SESSION_LIFETIME_DAYS)
        await db.user_sessions.insert_one({
            "session_token": session_token,
            "user_id": user["user_id"],
            "created_at": now,
            "expires_at": expires_at,
            "ip": request.client.host if request.client else None,
            "ua": request.headers.get("user-agent", "")[:200],
        })

        user_out = await _user_to_out(db, user)
        return GoogleSessionOut(session_token=session_token, user=user_out)

    @api_router.get("/auth/me", response_model=AuthUserOut)
    async def me(authorization: Optional[str] = Header(None)):
        user = await get_current_user(db, authorization)
        return await _user_to_out(db, user)

    @api_router.post("/auth/logout")
    async def logout(authorization: Optional[str] = Header(None)):
        if authorization and authorization.lower().startswith("bearer "):
            token = authorization.split(" ", 1)[1].strip()
            try:
                await db.user_sessions.delete_one({"session_token": token})
            except Exception:
                pass
        return {"ok": True}
