"""Authentication helpers for Muri.

Uses only the Python standard library for password hashing (scrypt) and
session tokens (HMAC-SHA256 signed, JWT-like), so no extra dependencies are
required. OAuth (Google/Facebook) uses the authorization-code flow.
"""

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException, Request
from sqlalchemy import delete, select

from db import SessionLocal
from models import PendingLogin, User, UserSetting

COOKIE_NAME = "muri_session"
OAUTH_STATE_COOKIE = "muri_oauth_state"
PENDING_LOGIN_COOKIE = "muri_pending_login"
SESSION_TTL = 60 * 60 * 24 * 30  # 30 days

# One-time email security code shown after an OAuth account is chosen.
LOGIN_CODE_TTL = 10 * 60  # 10 minutes
LOGIN_CODE_MAX_ATTEMPTS = 5

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD_LENGTH = 8

_DEFAULT_SECRET = secrets.token_urlsafe(48)
SECRET_KEY = os.getenv("MURI_SECRET_KEY", "").strip() or _DEFAULT_SECRET
if not os.getenv("MURI_SECRET_KEY", "").strip():
    print(
        "[Muri] MURI_SECRET_KEY is not set - using a temporary key. "
        "Sessions will be invalidated on restart. Set it in muri/backend/.env."
    )

BASE_URL = os.getenv("MURI_BASE_URL", "http://localhost:8000").rstrip("/")
COOKIE_SECURE = os.getenv("MURI_COOKIE_SECURE", "false").lower() in {"1", "true", "yes"}
# Cross-site cookies (required for the Android app talking to a hosted backend)
# must be SameSite=None, which in turn requires Secure.
COOKIE_SAMESITE = os.getenv("MURI_COOKIE_SAMESITE", "lax").strip().lower()
if COOKIE_SAMESITE not in {"lax", "strict", "none"}:
    COOKIE_SAMESITE = "lax"
if COOKIE_SAMESITE == "none":
    COOKIE_SECURE = True

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "").strip()
FACEBOOK_APP_ID = os.getenv("FACEBOOK_APP_ID", "").strip()
FACEBOOK_APP_SECRET = os.getenv("FACEBOOK_APP_SECRET", "").strip()

# SMTP used to deliver the one-time security code by email.
SMTP_HOST = os.getenv("SMTP_HOST", "").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "587") or "587")
SMTP_USER = os.getenv("SMTP_USER", "").strip()
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "").strip()
SMTP_FROM = os.getenv("SMTP_FROM", "").strip() or SMTP_USER
SMTP_STARTTLS = os.getenv("SMTP_STARTTLS", "true").lower() in {"1", "true", "yes"}


# --------------------------------------------------------------------------- #
# Passwords
# --------------------------------------------------------------------------- #
def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32
    )
    return "scrypt$16384$8$1${}${}".format(
        base64.b64encode(salt).decode(), base64.b64encode(derived).decode()
    )


def verify_password(password: str, stored: Optional[str]) -> bool:
    if not stored:
        return False
    try:
        algo, n, r, p, salt_b64, hash_b64 = stored.split("$")
        if algo != "scrypt":
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(hash_b64)
        derived = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(expected),
        )
        return hmac.compare_digest(derived, expected)
    except (ValueError, TypeError):
        return False


# --------------------------------------------------------------------------- #
# Session tokens (HMAC-SHA256, JWT-like)
# --------------------------------------------------------------------------- #
def _b64e(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64d(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def create_session_token(user_id: str) -> str:
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {"sub": user_id, "iat": now, "exp": now + SESSION_TTL}
    signing_input = ".".join(
        [
            _b64e(json.dumps(header, separators=(",", ":")).encode()),
            _b64e(json.dumps(payload, separators=(",", ":")).encode()),
        ]
    )
    signature = hmac.new(
        SECRET_KEY.encode(), signing_input.encode(), hashlib.sha256
    ).digest()
    return f"{signing_input}.{_b64e(signature)}"


def decode_session_token(token: str) -> Optional[dict]:
    try:
        header_b64, payload_b64, signature_b64 = token.split(".")
    except ValueError:
        return None
    signing_input = f"{header_b64}.{payload_b64}"
    expected = hmac.new(
        SECRET_KEY.encode(), signing_input.encode(), hashlib.sha256
    ).digest()
    try:
        provided = _b64d(signature_b64)
    except (ValueError, TypeError):
        return None
    if not hmac.compare_digest(expected, provided):
        return None
    try:
        payload = json.loads(_b64d(payload_b64))
    except (ValueError, TypeError):
        return None
    if payload.get("exp", 0) < time.time():
        return None
    return payload


# --------------------------------------------------------------------------- #
# Users
# --------------------------------------------------------------------------- #
def user_public(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "avatar_url": user.avatar_url,
        "provider": user.provider,
    }


def normalize_email(email: str) -> str:
    return email.strip().lower()


def validate_credentials(email: str, password: str) -> None:
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters.",
        )


def create_user(
    email: Optional[str],
    *,
    password: Optional[str] = None,
    name: Optional[str] = None,
    avatar_url: Optional[str] = None,
    provider: str = "local",
    provider_id: Optional[str] = None,
) -> User:
    with SessionLocal() as db:
        user = User(
            id=str(uuid.uuid4()),
            email=normalize_email(email) if email else None,
            name=name,
            avatar_url=avatar_url,
            password_hash=hash_password(password) if password else None,
            provider=provider,
            provider_id=provider_id,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        db.expunge(user)
        return user


def find_user_by_email(email: str) -> Optional[User]:
    with SessionLocal() as db:
        user = db.scalar(
            select(User).where(User.email == normalize_email(email))
        )
        if user is not None:
            db.expunge(user)
        return user


def find_or_create_oauth_user(
    provider: str,
    provider_id: str,
    *,
    email: Optional[str],
    name: Optional[str],
    avatar_url: Optional[str],
) -> User:
    with SessionLocal() as db:
        user = db.scalar(
            select(User).where(
                User.provider == provider, User.provider_id == provider_id
            )
        )
        if user is None and email:
            # Link to an existing local account with the same email.
            user = db.scalar(
                select(User).where(User.email == normalize_email(email))
            )
            if user is not None:
                user.provider = provider
                user.provider_id = provider_id
                if not user.avatar_url:
                    user.avatar_url = avatar_url
        if user is None:
            user = User(
                id=str(uuid.uuid4()),
                email=normalize_email(email) if email else None,
                name=name,
                avatar_url=avatar_url,
                provider=provider,
                provider_id=provider_id,
            )
            db.add(user)
        db.commit()
        db.refresh(user)
        db.expunge(user)
        return user


def get_user(user_id: str) -> Optional[User]:
    with SessionLocal() as db:
        user = db.get(User, user_id)
        if user is not None:
            db.expunge(user)
        return user


# --------------------------------------------------------------------------- #
# FastAPI dependencies
# --------------------------------------------------------------------------- #
def current_user(request: Request) -> Optional[User]:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    payload = decode_session_token(token)
    if not payload or not payload.get("sub"):
        return None
    return get_user(str(payload["sub"]))


def require_user(request: Request) -> User:
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def set_session_cookie(response, user_id: str) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=create_session_token(user_id),
        max_age=SESSION_TTL,
        httponly=True,
        samesite=COOKIE_SAMESITE,
        secure=COOKIE_SECURE,
        path="/",
    )


def clear_session_cookie(response) -> None:
    response.delete_cookie(key=COOKIE_NAME, path="/")


def set_pending_cookie(response, token: str) -> None:
    response.set_cookie(
        key=PENDING_LOGIN_COOKIE,
        value=token,
        max_age=LOGIN_CODE_TTL,
        httponly=True,
        samesite=COOKIE_SAMESITE,
        secure=COOKIE_SECURE,
        path="/",
    )


def clear_pending_cookie(response) -> None:
    response.delete_cookie(key=PENDING_LOGIN_COOKIE, path="/")


# --------------------------------------------------------------------------- #
# Per-user settings
# --------------------------------------------------------------------------- #
def read_user_settings(db, user_id: str, defaults: dict) -> dict:
    data = dict(defaults)
    rows = db.scalars(
        select(UserSetting).where(UserSetting.user_id == user_id)
    ).all()
    for row in rows:
        data[row.key] = row.value
    return data


def write_user_settings(db, user_id: str, updates: dict) -> None:
    for key, value in updates.items():
        setting = db.get(UserSetting, {"user_id": user_id, "key": key})
        if setting is None:
            db.add(UserSetting(user_id=user_id, key=key, value=value))
        else:
            setting.value = value
    db.commit()


# --------------------------------------------------------------------------- #
# OAuth
# --------------------------------------------------------------------------- #
@dataclass
class OAuthProfile:
    provider_id: str
    email: Optional[str]
    name: Optional[str]
    avatar_url: Optional[str]


def providers_enabled() -> dict:
    return {
        "google": bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET),
        "facebook": bool(FACEBOOK_APP_ID and FACEBOOK_APP_SECRET),
    }


def new_oauth_state() -> str:
    return secrets.token_urlsafe(24)


def callback_url(provider: str) -> str:
    return f"{BASE_URL}/api/auth/oauth/{provider}/callback"


def google_authorize_url(state: str) -> str:
    from urllib.parse import urlencode

    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": callback_url("google"),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
        "prompt": "select_account",
    }
    return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)


def facebook_authorize_url(state: str) -> str:
    from urllib.parse import urlencode

    params = {
        "client_id": FACEBOOK_APP_ID,
        "redirect_uri": callback_url("facebook"),
        "response_type": "code",
        "scope": "email,public_profile",
        "state": state,
    }
    return "https://www.facebook.com/v19.0/dialog/oauth?" + urlencode(params)


def exchange_google(code: str) -> OAuthProfile:
    import requests

    token_res = requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "code": code,
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri": callback_url("google"),
            "grant_type": "authorization_code",
        },
        timeout=15,
    )
    token_res.raise_for_status()
    access_token = token_res.json().get("access_token")
    if not access_token:
        raise HTTPException(status_code=400, detail="Google did not return a token.")
    info = requests.get(
        "https://openidconnect.googleapis.com/v1/userinfo",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=15,
    )
    info.raise_for_status()
    data = info.json()
    return OAuthProfile(
        provider_id=str(data.get("sub")),
        email=data.get("email"),
        name=data.get("name"),
        avatar_url=data.get("picture"),
    )


def exchange_facebook(code: str) -> OAuthProfile:
    import requests

    token_res = requests.get(
        "https://graph.facebook.com/v19.0/oauth/access_token",
        params={
            "client_id": FACEBOOK_APP_ID,
            "client_secret": FACEBOOK_APP_SECRET,
            "redirect_uri": callback_url("facebook"),
            "code": code,
        },
        timeout=15,
    )
    token_res.raise_for_status()
    access_token = token_res.json().get("access_token")
    if not access_token:
        raise HTTPException(status_code=400, detail="Facebook did not return a token.")
    info = requests.get(
        "https://graph.facebook.com/me",
        params={
            "fields": "id,name,email,picture.type(large)",
            "access_token": access_token,
        },
        timeout=15,
    )
    info.raise_for_status()
    data = info.json()
    picture = (data.get("picture") or {}).get("data") or {}
    return OAuthProfile(
        provider_id=str(data.get("id")),
        email=data.get("email"),
        name=data.get("name"),
        avatar_url=picture.get("url"),
    )


# --------------------------------------------------------------------------- #
# One-time email security code
# --------------------------------------------------------------------------- #
def email_enabled() -> bool:
    return bool(SMTP_HOST and SMTP_FROM)


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def generate_login_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_login_code(code: str) -> str:
    return hashlib.sha256(f"{code}:{SECRET_KEY}".encode()).hexdigest()


def verify_login_code(code: str, code_hash: str) -> bool:
    return hmac.compare_digest(hash_login_code(code), code_hash)


def mask_email(email: str) -> str:
    name, _, domain = email.partition("@")
    if not domain:
        return email
    if len(name) <= 2:
        masked = name[:1] + "*"
    else:
        masked = name[0] + "*" * (len(name) - 2) + name[-1]
    return f"{masked}@{domain}"


def send_login_code_email(to_email: str, code: str) -> bool:
    """Email a one-time code. Falls back to the server console in dev."""
    if not email_enabled():
        print(f"[Muri] SMTP not configured. Login code for {to_email}: {code}")
        return False
    import smtplib
    from email.message import EmailMessage

    message = EmailMessage()
    message["Subject"] = "Your Muri sign-in code"
    message["From"] = SMTP_FROM
    message["To"] = to_email
    message.set_content(
        f"Your Muri security code is: {code}\n\n"
        f"Enter it to finish signing in. It expires in "
        f"{LOGIN_CODE_TTL // 60} minutes.\n"
        "If you didn't try to sign in, you can safely ignore this email."
    )
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as server:
            if SMTP_STARTTLS:
                server.starttls()
            if SMTP_USER and SMTP_PASSWORD:
                server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(message)
        return True
    except Exception as exc:  # noqa: BLE001 - never leak SMTP errors to the browser
        print(f"[Muri] Failed to send login code email: {exc}")
        print(f"[Muri] Login code for {to_email}: {code}")
        return False


def create_pending_login(
    provider: str,
    provider_id: str,
    *,
    email: str,
    name: Optional[str],
    avatar_url: Optional[str],
) -> tuple[str, str]:
    """Store a pending login and return (browser_token, code)."""
    token = secrets.token_urlsafe(32)
    code = generate_login_code()
    with SessionLocal() as db:
        db.execute(delete(PendingLogin).where(PendingLogin.expires_at < _now()))
        db.add(
            PendingLogin(
                token=token,
                provider=provider,
                provider_id=provider_id,
                email=normalize_email(email),
                name=name,
                avatar_url=avatar_url,
                code_hash=hash_login_code(code),
                attempts=0,
                expires_at=_now() + timedelta(seconds=LOGIN_CODE_TTL),
            )
        )
        db.commit()
    return token, code


def get_pending_login(token: str) -> Optional[PendingLogin]:
    with SessionLocal() as db:
        row = db.get(PendingLogin, token)
        if row is not None:
            db.expunge(row)
        return row


def regenerate_login_code(token: str) -> Optional[tuple[str, str]]:
    """Rotate the code for a pending login, returns (email, code)."""
    code = generate_login_code()
    with SessionLocal() as db:
        row = db.get(PendingLogin, token)
        if row is None or row.expires_at < _now():
            return None
        row.code_hash = hash_login_code(code)
        row.attempts = 0
        row.expires_at = _now() + timedelta(seconds=LOGIN_CODE_TTL)
        email = row.email
        db.commit()
    return email, code


def bump_pending_attempts(token: str) -> None:
    with SessionLocal() as db:
        row = db.get(PendingLogin, token)
        if row is not None:
            row.attempts += 1
            db.commit()


def delete_pending_login(token: str) -> None:
    with SessionLocal() as db:
        row = db.get(PendingLogin, token)
        if row is not None:
            db.delete(row)
            db.commit()
