import base64
import binascii
import hmac
import json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List

from dotenv import load_dotenv

load_dotenv()

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, text

import auth
from auth import (
    LOGIN_CODE_MAX_ATTEMPTS,
    OAUTH_STATE_COOKIE,
    PENDING_LOGIN_COOKIE,
    bump_pending_attempts,
    clear_pending_cookie,
    clear_session_cookie,
    create_pending_login,
    create_user,
    delete_pending_login,
    email_enabled,
    exchange_facebook,
    exchange_google,
    facebook_authorize_url,
    find_or_create_oauth_user,
    find_user_by_email,
    get_pending_login,
    google_authorize_url,
    mask_email,
    new_oauth_state,
    normalize_email,
    providers_enabled,
    read_user_settings,
    regenerate_login_code,
    require_user,
    send_login_code_email,
    set_pending_cookie,
    set_session_cookie,
    user_public,
    validate_credentials,
    verify_login_code,
    verify_password,
    write_user_settings,
)
import learning
from db import Base, SessionLocal, engine
from models import ChatSession, Message, User

from google import genai
from google.genai import types

API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or ""
if API_KEY in {"", "your_gemini_api_key_here"}:
    API_KEY = None
MODEL = os.getenv("MURI_MODEL", "gemini-3.8-flash")

FRONTEND_DIST = Path(
    os.getenv(
        "FRONTEND_DIST",
        Path(__file__).resolve().parents[2] / "frontend" / "dist",
    )
)

SYSTEM_INSTRUCTION = (
    "You are Muri, a friendly AI learning companion with the motto "
    "'Learn. Play. Grow.'. Help learners understand ideas, not just get "
    "answers: explain step by step, use simple examples, and ask a short "
    "follow-up question to check understanding when it helps. Use markdown "
    "for structure and keep replies focused. Encourage steady practice, "
    "celebrate progress, and suggest trying a course lesson, a quick game or "
    "saving a note when relevant. If you are unsure, say so instead of "
    "guessing."
)

DEFAULT_SETTINGS = {
    "model": MODEL,
    "system_instruction": SYSTEM_INSTRUCTION,
    "temperature": "0.7",
}

# Curated, currently-available Gemini chat models. Older ids such as
# gemini-2.0-flash and gemini-2.5-pro now return 404 for new accounts, so the
# app no longer offers them by default. Override the whole list with
# MURI_MODELS, or set MURI_DISCOVER_MODELS=false to skip the live lookup below.
DEFAULT_GEMINI_MODELS = [
    MODEL,
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3-flash-preview",
    "gemini-3.1-pro-preview",
    "gemini-3.1-flash-lite",
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
    "gemini-pro-latest",
]

# Names we never offer as chat models (media/live/embedding/experimental tools).
_NON_CHAT_KEYWORDS = (
    "image",
    "tts",
    "transcribe",
    "audio",
    "embedding",
    "veo",
    "lyria",
    "imagen",
    "robotics",
    "computer-use",
    "antigravity",
    "deep-research",
    "nano-banana",
    "omni",
    "-live",
    "live-",
)

# Retired Gemini families that 404 for accounts created after their sunset.
_RETIRED_PREFIXES = ("gemini-2.0", "gemini-2.5")

_MODELS_CACHE: dict = {"at": 0.0, "names": []}
_MODELS_TTL_SECONDS = 300.0

MAX_ATTACHMENTS = 6
MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
TEXT_MIME_TYPES = {
    "application/json",
    "application/xml",
    "application/javascript",
    "application/x-yaml",
    "application/yaml",
}

# --------------------------------------------------------------------------- #
# Security: spend caps, rate limits, input ceilings.
# The model is billed per request, so every model call must pass a per-user
# rate limit AND a persistent daily cap before any provider traffic happens.
# All values are tunable via muri/backend/.env (see the commented examples).
# --------------------------------------------------------------------------- #
CHAT_RATE_LIMIT = int(os.getenv("MURI_CHAT_RATE_LIMIT", "20"))
CHAT_RATE_WINDOW = float(os.getenv("MURI_CHAT_RATE_WINDOW", "60"))
DAILY_MESSAGE_CAP = int(os.getenv("MURI_DAILY_MESSAGE_CAP", "200"))
MAX_MESSAGE_CHARS = int(os.getenv("MURI_MAX_MESSAGE_CHARS", "8000"))
MAX_ATTACHMENT_TEXT_CHARS = int(os.getenv("MURI_MAX_ATTACHMENT_TEXT_CHARS", "20000"))
MAX_SYSTEM_INSTRUCTION_CHARS = 4000
AUTH_RATE_LIMIT = int(os.getenv("MURI_AUTH_RATE_LIMIT", "10"))
AUTH_RATE_WINDOW = float(os.getenv("MURI_AUTH_RATE_WINDOW", "300"))

# Session ids are client-generated UUIDs: lock the shape so they can never be
# used as injection vectors or path tricks.
SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# In-memory sliding-window buckets: key -> list of monotonic timestamps.
# (Single-process server; counters reset on restart, daily caps live in MySQL.)
_RATE_BUCKETS: dict[str, list] = {}


def _check_rate_limit(key: str, limit: int, window_seconds: float) -> float | None:
    """Record a hit; return retry-after seconds when over the limit, else None."""
    now = time.monotonic()
    cutoff = now - window_seconds
    hits = [t for t in _RATE_BUCKETS.get(key, []) if t > cutoff]
    if len(hits) >= limit:
        return max(1.0, window_seconds - (now - min(hits)))
    hits.append(now)
    _RATE_BUCKETS[key] = hits
    if len(_RATE_BUCKETS) > 10000:
        _RATE_BUCKETS.clear()
    return None


def _rate_limited_response(retry_after: float) -> HTTPException:
    return HTTPException(
        status_code=429,
        detail="Too many requests. Please slow down and try again shortly.",
        headers={"Retry-After": str(int(retry_after) + 1)},
    )


def _client_ip(request: Request) -> str:
    # Behind a proxy, prefer the left-most X-Forwarded-For entry.
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    return (request.client.host if request.client else "unknown")[:64]


def _user_messages_today(db, user_id: str) -> int:
    """Persistent per-user daily usage counter (spend cap)."""
    today = datetime.now(timezone.utc).replace(tzinfo=None).date()
    return (
        db.scalar(
            select(func.count())
            .select_from(Message)
            .join(ChatSession, Message.session_id == ChatSession.id)
            .where(
                ChatSession.user_id == user_id,
                Message.role == "user",
                func.date(Message.created_at) == today,
            )
        )
        or 0
    )


def _enforce_chat_budget(db, user_id: str) -> None:
    """Rate limit (burst) + daily cap (spend). Raises 429 when exceeded."""
    retry = _check_rate_limit(f"chat:{user_id}", CHAT_RATE_LIMIT, CHAT_RATE_WINDOW)
    if retry is not None:
        raise _rate_limited_response(retry)
    if _user_messages_today(db, user_id) >= DAILY_MESSAGE_CAP:
        raise HTTPException(
            status_code=429,
            detail=(
                "You've reached today's message limit. "
                "Please come back tomorrow to keep learning."
            ),
        )


def _ensure_columns() -> None:
    """Add newer columns to pre-existing tables (create_all won't)."""
    if not engine.dialect.name.startswith("mysql"):
        return
    wanted = {
        "sessions": {
            "title": "ADD COLUMN `title` VARCHAR(160) NULL",
            "pinned": "ADD COLUMN `pinned` TINYINT(1) NOT NULL DEFAULT 0",
            "updated_at": (
                "ADD COLUMN `updated_at` DATETIME NOT NULL "
                "DEFAULT CURRENT_TIMESTAMP"
            ),
            "user_id": "ADD COLUMN `user_id` VARCHAR(36) NULL",
        },
    }
    with engine.begin() as conn:
        for table, columns in wanted.items():
            exists = conn.execute(
                text(
                    "SELECT COUNT(*) FROM information_schema.tables "
                    "WHERE table_schema = DATABASE() AND table_name = :t"
                ),
                {"t": table},
            ).scalar()
            if not exists:
                continue
            for column, ddl in columns.items():
                present = conn.execute(
                    text(
                        "SELECT COUNT(*) FROM information_schema.columns "
                        "WHERE table_schema = DATABASE() "
                        "AND table_name = :t AND column_name = :c"
                    ),
                    {"t": table, "c": column},
                ).scalar()
                if not present:
                    conn.execute(text(f"ALTER TABLE `{table}` {ddl}"))


DB_READY = False
DB_ERROR = ""
try:
    Base.metadata.create_all(bind=engine)
    _ensure_columns()
    DB_READY = True
except Exception as exc:  # noqa: BLE001 - keep the server bootable without MySQL
    DB_ERROR = str(exc)
    print(f"[Muri] Database unavailable: {exc}")

if DB_READY:
    try:
        learning.seed_courses()
    except Exception as exc:  # noqa: BLE001 - course seed must not block boot
        print(f"[Muri] Could not seed courses: {exc}")

client = genai.Client(api_key=API_KEY) if API_KEY else None


def provider_for(model: str) -> str:
    """Single provider backend (Gemini)."""
    return "gemini"


def provider_ready(provider: str) -> bool:
    return client is not None


def missing_key_message(provider: str) -> str:
    return (
        "Muri is not configured yet. Add GEMINI_API_KEY to "
        "muri/backend/.env and restart the server."
    )


def _model_supports_chat(item) -> bool:
    """True when a listed Gemini model can generate text content."""
    methods = (
        getattr(item, "supported_actions", None)
        or getattr(item, "supported_generation_methods", None)
        or []
    )
    return not methods or "generateContent" in methods


def _is_chat_model(name: str) -> bool:
    lowered = name.lower()
    if lowered.startswith(_RETIRED_PREFIXES):
        return False
    return not any(word in lowered for word in _NON_CHAT_KEYWORDS)


def _discover_gemini_models() -> List[str]:
    """Live list of chat-capable Gemini models for the configured key.

    Cached briefly so the Settings view and health checks stay fast. Returns an
    empty list (never raises) when discovery is off or the API is unreachable.
    """
    if client is None:
        return []
    if os.getenv("MURI_DISCOVER_MODELS", "true").strip().lower() in {"0", "false", "no"}:
        return []
    now = time.monotonic()
    cached = _MODELS_CACHE.get("names") or []
    if cached and now - _MODELS_CACHE.get("at", 0.0) < _MODELS_TTL_SECONDS:
        return cached
    names: List[str] = []
    try:
        for item in client.models.list():
            name = (getattr(item, "name", "") or "").split("/")[-1].strip()
            if name and _model_supports_chat(item) and _is_chat_model(name):
                names.append(name)
    except Exception as exc:  # noqa: BLE001 - discovery must not break the API
        print(f"[Muri] Could not list Gemini models: {exc}")
        return cached
    if names:
        _MODELS_CACHE["at"] = now
        _MODELS_CACHE["names"] = names
    return names or cached


def available_models() -> List[str]:
    """Models offered in the app. Override with MURI_MODELS in .env."""
    configured = os.getenv("MURI_MODELS", "").strip()
    if configured:
        candidates = [name.strip() for name in configured.split(",")]
    else:
        candidates = [*DEFAULT_GEMINI_MODELS, *_discover_gemini_models()]
    seen: List[str] = []
    for name in candidates:
        if not name or name in seen:
            continue
        if client is None:
            continue
        seen.append(name)
    return seen

app = FastAPI(title="Muri API", version="1.3.0")
app.include_router(learning.router)

_DEFAULT_ORIGINS = (
    "http://localhost:5173,http://127.0.0.1:5173,"
    "http://localhost:8000,http://127.0.0.1:8000,"
    "https://localhost,capacitor://localhost,http://localhost"
)
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("MURI_CORS_ORIGINS", _DEFAULT_ORIGINS).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request, call_next):
    """Baseline hardening headers. No keys or user data ever leave here."""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Permissions-Policy"] = (
        "camera=(), microphone=(self), geolocation=(), payment=()"
    )
    return response


class Attachment(BaseModel):
    name: str = Field(default="", max_length=255)
    mime_type: str = Field(default="application/octet-stream", max_length=128)
    data: str = ""


class ChatRequest(BaseModel):
    session_id: str = Field(max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    message: str = Field(default="", max_length=12000)
    regenerate: bool = False
    attachments: List[Attachment] = Field(default_factory=list, max_length=6)


class SessionRequest(BaseModel):
    session_id: str = Field(max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


class SessionUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=160)
    pinned: bool | None = None


class SettingsRequest(BaseModel):
    model: str | None = Field(default=None, max_length=128)
    system_instruction: str | None = Field(
        default=None, max_length=MAX_SYSTEM_INSTRUCTION_CHARS
    )
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)


class SignupRequest(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(max_length=256)
    name: str | None = Field(default=None, max_length=120)


class LoginRequest(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(max_length=256)


class VerifyCodeRequest(BaseModel):
    code: str = Field(max_length=16)


def ensure_session(db, session_id: str, user_id: str) -> ChatSession:
    session = db.get(ChatSession, session_id)
    if session is None:
        session = ChatSession(id=session_id, user_id=user_id)
        db.add(session)
        db.commit()
    elif session.user_id is None:
        session.user_id = user_id
        db.commit()
    elif session.user_id != user_id:
        raise HTTPException(status_code=403, detail="This chat belongs to someone else.")
    return session


def owned_session(db, session_id: str, user_id: str) -> ChatSession | None:
    session = db.get(ChatSession, session_id)
    if session is None or session.user_id != user_id:
        return None
    return session


def load_history(db, session_id: str) -> List[dict]:
    rows = db.scalars(
        select(Message).where(Message.session_id == session_id).order_by(Message.id)
    ).all()
    return [{"role": row.role, "text": row.text} for row in rows]


def append_message(db, session_id: str, role: str, text_value: str) -> None:
    db.add(Message(session_id=session_id, role=role, text=text_value))
    session = db.get(ChatSession, session_id)
    if session is not None:
        session.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()


def _safe_filename(name: str, mime_type: str) -> str:
    """Filenames are untrusted input: strip control chars, cap length."""
    base = (name or mime_type or "file").strip()
    base = re.sub(r"[\x00-\x1f\x7f]", " ", base)
    base = re.sub(r"\s+", " ", base).strip()
    if len(base) > 80:
        head, dot, tail = base.rpartition(".")
        ext = f".{tail[:12]}" if dot and len(tail) <= 12 else ""
        base = base[: 80 - len(ext)] + ext
    return base or "file"


def read_attachments(attachments: List[Attachment]) -> List[dict]:
    """Decode attachments into a provider-neutral shape.

    Text content is truncated: without a ceiling a single pasted log file
    becomes a huge (billable) prompt. Filenames are sanitized, never trusted.
    """
    items: List[dict] = []
    for attachment in attachments[:MAX_ATTACHMENTS]:
        raw = (attachment.data or "").split(",", 1)[-1]
        if not raw:
            continue
        try:
            payload = base64.b64decode(raw, validate=False)
        except (binascii.Error, ValueError):
            continue
        if not payload or len(payload) > MAX_ATTACHMENT_BYTES:
            continue
        mime = (attachment.mime_type or "application/octet-stream")
        mime = mime.split(";")[0].strip()[:128] or "application/octet-stream"
        name = _safe_filename(attachment.name, mime)
        if mime.startswith("text/") or mime in TEXT_MIME_TYPES:
            try:
                content = payload.decode("utf-8")
            except UnicodeDecodeError:
                content = payload.decode("latin-1", errors="replace")
            if len(content) > MAX_ATTACHMENT_TEXT_CHARS:
                content = (
                    content[:MAX_ATTACHMENT_TEXT_CHARS]
                    + "\n\n[... attachment truncated ...]"
                )
            items.append({"kind": "text", "name": name, "text": content})
        else:
            items.append({"kind": "binary", "name": name, "mime": mime, "data": payload})
    return items


def gemini_attachment_parts(attachments: List[Attachment]) -> List[dict]:
    parts: List[dict] = []
    for item in read_attachments(attachments):
        if item["kind"] == "text":
            parts.append({"text": f"\n\n--- {item['name']} ---\n{item['text']}"})
        else:
            parts.append(
                types.Part.from_bytes(data=item["data"], mime_type=item["mime"])
            )
    return parts


def build_contents(
    history: List[dict], attachments: List[Attachment] | None = None
) -> List[dict]:
    contents = [
        {"role": message["role"], "parts": [{"text": message["text"]}]}
        for message in history
    ]
    extra = gemini_attachment_parts(attachments or [])
    if extra and contents:
        for item in reversed(contents):
            if item["role"] == "user":
                item["parts"].extend(extra)
                break
    return contents


def user_display_text(message: str, attachments: List[Attachment]) -> str:
    text = message.strip()
    if attachments:
        names = ", ".join(
            _safe_filename(attachment.name, attachment.mime_type)
            for attachment in attachments[:MAX_ATTACHMENTS]
            if attachment.data
        )
        if names:
            note = f"[Attached: {names}]"
            text = f"{text}\n{note}".strip()
    return text


def sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def db_unavailable_message() -> str:
    return (
        "Muri cannot reach the MySQL database. Check DATABASE_URL in "
        f"muri/backend/.env. Details: {DB_ERROR}"
    )


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def build_title(session: ChatSession) -> str:
    if session.title:
        return session.title
    first_user = next((m.text for m in session.messages if m.role == "user"), None)
    if first_user:
        clean = " ".join(first_user.split())
        return clean[:60] + ("…" if len(clean) > 60 else "")
    return "New chat"


def session_summary(session: ChatSession) -> dict:
    messages = session.messages
    last = messages[-1] if messages else None
    updated = (last.created_at if last else session.updated_at) or session.created_at
    preview = " ".join((last.text or "").split())[:120] if last else ""
    return {
        "id": session.id,
        "title": build_title(session),
        "pinned": bool(session.pinned),
        "created_at": _iso(session.created_at),
        "updated_at": _iso(updated),
        "message_count": len(messages),
        "preview": preview,
    }


def list_session_summaries(db, user_id: str) -> List[dict]:
    sessions = db.scalars(
        select(ChatSession).where(ChatSession.user_id == user_id)
    ).all()
    summaries = [session_summary(session) for session in sessions]
    summaries.sort(
        key=lambda item: (item["pinned"], item["updated_at"] or ""), reverse=True
    )
    return summaries


# --------------------------------------------------------------------------- #
# Auth
# --------------------------------------------------------------------------- #
@app.get("/api/auth/providers")
def auth_providers() -> dict:
    return providers_enabled()


@app.get("/api/auth/me")
def auth_me(user: User = Depends(require_user)) -> dict:
    return {"user": user_public(user)}


def _enforce_auth_rate_limit(request: Request, scope: str) -> None:
    """Per-IP throttle on credential endpoints (brute-force protection)."""
    retry = _check_rate_limit(
        f"auth:{scope}:{_client_ip(request)}", AUTH_RATE_LIMIT, AUTH_RATE_WINDOW
    )
    if retry is not None:
        raise _rate_limited_response(retry)


@app.post("/api/auth/signup")
def auth_signup(req: SignupRequest, request: Request, response: Response) -> dict:
    _enforce_auth_rate_limit(request, "signup")
    email = normalize_email(req.email)
    validate_credentials(email, req.password)
    if not DB_READY:
        raise HTTPException(status_code=503, detail=db_unavailable_message())
    if find_user_by_email(email) is not None:
        raise HTTPException(
            status_code=409, detail="An account with that email already exists."
        )
    user = create_user(
        email, password=req.password, name=(req.name or "").strip() or None
    )
    set_session_cookie(response, user.id)
    return {"user": user_public(user)}


@app.post("/api/auth/login")
def auth_login(req: LoginRequest, request: Request, response: Response) -> dict:
    _enforce_auth_rate_limit(request, "login")
    if not DB_READY:
        raise HTTPException(status_code=503, detail=db_unavailable_message())
    user = find_user_by_email(req.email)
    if user is None or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    set_session_cookie(response, user.id)
    return {"user": user_public(user)}


@app.post("/api/auth/logout")
def auth_logout(response: Response) -> dict:
    clear_session_cookie(response)
    return {"status": "ok"}


@app.get("/api/auth/oauth/{provider}/start")
def oauth_start(provider: str, request: Request) -> RedirectResponse:
    # GET endpoints redirect (never raise): a raw 429 page would strand users.
    retry = _check_rate_limit(
        f"auth:oauth_start:{_client_ip(request)}", AUTH_RATE_LIMIT, AUTH_RATE_WINDOW
    )
    if retry is not None:
        return RedirectResponse("/?auth_error=rate_limited")
    enabled = providers_enabled()
    if provider not in {"google", "facebook"} or not enabled.get(provider):
        return RedirectResponse("/?auth_error=provider_unavailable")
    state = new_oauth_state()
    url = (
        google_authorize_url(state)
        if provider == "google"
        else facebook_authorize_url(state)
    )
    redirect = RedirectResponse(url)
    redirect.set_cookie(
        key=OAUTH_STATE_COOKIE,
        value=state,
        max_age=600,
        httponly=True,
        samesite=auth.COOKIE_SAMESITE,
        secure=auth.COOKIE_SECURE,
        path="/",
    )
    return redirect


@app.get("/api/auth/oauth/{provider}/callback")
def oauth_callback(
    provider: str,
    request: Request,
    code: str = "",
    state: str = "",
    error: str = "",
) -> RedirectResponse:
    if error:
        return RedirectResponse("/?auth_error=access_denied")
    retry = _check_rate_limit(
        f"auth:oauth_callback:{_client_ip(request)}",
        AUTH_RATE_LIMIT,
        AUTH_RATE_WINDOW,
    )
    if retry is not None:
        return RedirectResponse("/?auth_error=rate_limited")
    expected = request.cookies.get(OAUTH_STATE_COOKIE)
    if provider not in {"google", "facebook"}:
        return RedirectResponse("/?auth_error=provider_unavailable")
    if (
        not code
        or not state
        or not expected
        or not hmac.compare_digest(state, expected)
    ):
        return RedirectResponse("/?auth_error=invalid_state")
    try:
        profile = (
            exchange_google(code)
            if provider == "google"
            else exchange_facebook(code)
        )
        if not profile.email:
            return RedirectResponse("/?auth_error=email_required")
        token, login_code = create_pending_login(
            provider,
            profile.provider_id,
            email=profile.email,
            name=profile.name,
            avatar_url=profile.avatar_url,
        )
        send_login_code_email(profile.email, login_code)
    except HTTPException:
        return RedirectResponse("/?auth_error=login_failed")
    except Exception:  # noqa: BLE001 - never leak provider errors to the browser
        return RedirectResponse("/?auth_error=login_failed")
    redirect = RedirectResponse("/?verify=1")
    set_pending_cookie(redirect, token)
    redirect.delete_cookie(OAUTH_STATE_COOKIE, path="/")
    return redirect


def _pending_expired(row) -> bool:
    return row is None or row.expires_at < datetime.now(timezone.utc).replace(
        tzinfo=None
    )


@app.get("/api/auth/pending")
def auth_pending(request: Request) -> dict:
    if not DB_READY:
        return {"pending": None}
    token = request.cookies.get(PENDING_LOGIN_COOKIE)
    if not token:
        return {"pending": None}
    row = get_pending_login(token)
    if _pending_expired(row):
        return {"pending": None}
    return {
        "pending": {
            "email": mask_email(row.email),
            "provider": row.provider,
            "sent": email_enabled(),
        }
    }


@app.post("/api/auth/oauth/verify")
def oauth_verify(
    req: VerifyCodeRequest, request: Request, response: Response
) -> dict:
    _enforce_auth_rate_limit(request, "verify")
    if not DB_READY:
        raise HTTPException(status_code=503, detail=db_unavailable_message())
    token = request.cookies.get(PENDING_LOGIN_COOKIE)
    if not token:
        raise HTTPException(
            status_code=400, detail="Your sign-in expired. Please start again."
        )
    row = get_pending_login(token)
    if _pending_expired(row):
        delete_pending_login(token)
        raise HTTPException(
            status_code=400, detail="That code expired. Please sign in again."
        )
    if row.attempts >= LOGIN_CODE_MAX_ATTEMPTS:
        delete_pending_login(token)
        raise HTTPException(
            status_code=429, detail="Too many attempts. Please sign in again."
        )
    if not verify_login_code(req.code.strip(), row.code_hash):
        bump_pending_attempts(token)
        raise HTTPException(
            status_code=400,
            detail="Incorrect code. Check your email and try again.",
        )
    user = find_or_create_oauth_user(
        row.provider,
        row.provider_id,
        email=row.email,
        name=row.name,
        avatar_url=row.avatar_url,
    )
    delete_pending_login(token)
    clear_pending_cookie(response)
    set_session_cookie(response, user.id)
    return {"user": user_public(user)}


@app.post("/api/auth/oauth/resend")
def oauth_resend(request: Request) -> dict:
    _enforce_auth_rate_limit(request, "resend")
    if not DB_READY:
        raise HTTPException(status_code=503, detail=db_unavailable_message())
    token = request.cookies.get(PENDING_LOGIN_COOKIE)
    if not token:
        raise HTTPException(
            status_code=400, detail="Your sign-in expired. Please start again."
        )
    rotated = regenerate_login_code(token)
    if rotated is None:
        raise HTTPException(
            status_code=400, detail="That code expired. Please sign in again."
        )
    email, login_code = rotated
    return {"sent": send_login_code_email(email, login_code)}


@app.post("/api/auth/oauth/cancel")
def oauth_cancel(request: Request, response: Response) -> dict:
    token = request.cookies.get(PENDING_LOGIN_COOKIE)
    if token:
        delete_pending_login(token)
    clear_pending_cookie(response)
    return {"status": "ok"}


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "model": MODEL,
        "ai_configured": client is not None,
        "gemini_configured": client is not None,
        "models": available_models(),
        "db_ready": DB_READY,
        "db_error": DB_ERROR,
        "providers": providers_enabled(),
        "email_configured": email_enabled(),
    }


@app.get("/api/models")
def models() -> dict:
    return {"models": available_models(), "default": MODEL}


# --------------------------------------------------------------------------- #
# Sessions
# --------------------------------------------------------------------------- #
@app.get("/api/sessions")
def list_sessions(user: User = Depends(require_user)) -> dict:
    if not DB_READY:
        return {"sessions": [], "error": db_unavailable_message()}
    with SessionLocal() as db:
        return {"sessions": list_session_summaries(db, user.id)}


@app.post("/api/sessions")
def create_session(
    req: SessionRequest, user: User = Depends(require_user)
) -> dict:
    if not DB_READY:
        return {"status": "error", "error": db_unavailable_message()}
    with SessionLocal() as db:
        ensure_session(db, req.session_id, user.id)
        return {"status": "ok", "id": req.session_id}


@app.patch("/api/sessions/{session_id}")
def update_session(
    session_id: str,
    req: SessionUpdate,
    user: User = Depends(require_user),
) -> dict:
    if not DB_READY:
        raise HTTPException(status_code=503, detail=db_unavailable_message())
    with SessionLocal() as db:
        session = owned_session(db, session_id, user.id)
        if session is None:
            raise HTTPException(status_code=404, detail="Session not found")
        if req.title is not None:
            session.title = req.title.strip() or None
        if req.pinned is not None:
            session.pinned = req.pinned
        session.updated_at = session.updated_at or datetime.now(
            timezone.utc
        ).replace(tzinfo=None)
        db.commit()
        return {"status": "ok", "session": session_summary(session)}


@app.delete("/api/sessions/{session_id}")
def delete_session(
    session_id: str, user: User = Depends(require_user)
) -> dict:
    if not DB_READY:
        raise HTTPException(status_code=503, detail=db_unavailable_message())
    with SessionLocal() as db:
        session = owned_session(db, session_id, user.id)
        if session is not None:
            db.delete(session)
            db.commit()
    return {"status": "ok"}


@app.delete("/api/sessions")
def clear_sessions(user: User = Depends(require_user)) -> dict:
    if not DB_READY:
        raise HTTPException(status_code=503, detail=db_unavailable_message())
    with SessionLocal() as db:
        session_ids = db.scalars(
            select(ChatSession.id).where(ChatSession.user_id == user.id)
        ).all()
        if session_ids:
            db.execute(
                delete(Message).where(Message.session_id.in_(session_ids))
            )
            db.execute(
                delete(ChatSession).where(ChatSession.user_id == user.id)
            )
            db.commit()
    return {"status": "ok"}


@app.get("/api/history/{session_id}")
def history(
    session_id: str, user: User = Depends(require_user)
) -> dict:
    if not DB_READY:
        return {"messages": [], "error": db_unavailable_message()}
    with SessionLocal() as db:
        if owned_session(db, session_id, user.id) is None:
            return {"messages": []}
        return {"messages": load_history(db, session_id)}


@app.post("/api/reset")
def reset(req: SessionRequest, user: User = Depends(require_user)) -> dict:
    if not DB_READY:
        return {"status": "error", "error": db_unavailable_message()}
    with SessionLocal() as db:
        session = owned_session(db, req.session_id, user.id)
        if session is not None:
            db.delete(session)
            db.commit()
    return {"status": "ok"}


def _resolve_model(settings: dict) -> str:
    """Stored model ids are untrusted (legacy claude-*, typos): coerce to allowlist."""
    model = (settings.get("model") or MODEL).strip()
    if model not in available_models():
        return MODEL
    return model


# --------------------------------------------------------------------------- #
# Settings
# --------------------------------------------------------------------------- #
@app.get("/api/settings")
def get_settings(user: User = Depends(require_user)) -> dict:
    if not DB_READY:
        return {**DEFAULT_SETTINGS, "error": db_unavailable_message()}
    with SessionLocal() as db:
        data = read_user_settings(db, user.id, DEFAULT_SETTINGS)
    data["temperature"] = float(data.get("temperature", 0.7))
    data["model"] = _resolve_model(data)
    return data


@app.put("/api/settings")
def put_settings(
    req: SettingsRequest, user: User = Depends(require_user)
) -> dict:
    if not DB_READY:
        raise HTTPException(status_code=503, detail=db_unavailable_message())
    updates: dict[str, str] = {}
    if req.model is not None and req.model.strip():
        # The model id flows straight into the provider SDK: only allow ids
        # the server itself offers. Anything else is rejected, never executed.
        model = req.model.strip()
        if model not in available_models():
            raise HTTPException(
                status_code=400,
                detail="Unknown model. Pick one from the list in Settings.",
            )
        updates["model"] = model
    if req.system_instruction is not None:
        updates["system_instruction"] = req.system_instruction
    if req.temperature is not None:
        updates["temperature"] = str(req.temperature)
    with SessionLocal() as db:
        write_user_settings(db, user.id, updates)
        data = read_user_settings(db, user.id, DEFAULT_SETTINGS)
    data["temperature"] = float(data.get("temperature", 0.7))
    return {"status": "ok", "settings": data}


# --------------------------------------------------------------------------- #
# Stats
# --------------------------------------------------------------------------- #
@app.get("/api/stats")
def stats(user: User = Depends(require_user)) -> dict:
    empty = {
        "total_sessions": 0,
        "total_messages": 0,
        "user_messages": 0,
        "model_messages": 0,
        "sessions_today": 0,
        "messages_today": 0,
        "activity": [],
        "recent": [],
    }
    if not DB_READY:
        return {**empty, "error": db_unavailable_message()}

    today = datetime.now(timezone.utc).replace(tzinfo=None).date()
    with SessionLocal() as db:
        total_sessions = (
            db.scalar(
                select(func.count())
                .select_from(ChatSession)
                .where(ChatSession.user_id == user.id)
            )
            or 0
        )
        total_messages = (
            db.scalar(
                select(func.count())
                .select_from(Message)
                .join(ChatSession, Message.session_id == ChatSession.id)
                .where(ChatSession.user_id == user.id)
            )
            or 0
        )
        user_messages = (
            db.scalar(
                select(func.count())
                .select_from(Message)
                .join(ChatSession, Message.session_id == ChatSession.id)
                .where(
                    ChatSession.user_id == user.id, Message.role == "user"
                )
            )
            or 0
        )
        sessions_today = (
            db.scalar(
                select(func.count())
                .select_from(ChatSession)
                .where(
                    ChatSession.user_id == user.id,
                    func.date(ChatSession.created_at) == today,
                )
            )
            or 0
        )
        messages_today = (
            db.scalar(
                select(func.count())
                .select_from(Message)
                .join(ChatSession, Message.session_id == ChatSession.id)
                .where(
                    ChatSession.user_id == user.id,
                    func.date(Message.created_at) == today,
                )
            )
            or 0
        )

        rows = db.execute(
            select(
                func.date(Message.created_at).label("day"),
                func.count().label("count"),
            )
            .join(ChatSession, Message.session_id == ChatSession.id)
            .where(
                ChatSession.user_id == user.id,
                Message.created_at >= today - timedelta(days=6),
            )
            .group_by(func.date(Message.created_at))
        ).all()
        counts = {}
        for day, count in rows:
            key = day.isoformat() if hasattr(day, "isoformat") else str(day)
            counts[key] = count

        activity = []
        for offset in range(6, -1, -1):
            day = today - timedelta(days=offset)
            key = day.isoformat()
            activity.append({"date": key, "count": counts.get(key, 0)})

        recent = list_session_summaries(db, user.id)[:5]

    return {
        "total_sessions": total_sessions,
        "total_messages": total_messages,
        "user_messages": user_messages,
        "model_messages": total_messages - user_messages,
        "sessions_today": sessions_today,
        "messages_today": messages_today,
        "activity": activity,
        "recent": recent,
    }


# --------------------------------------------------------------------------- #
# Chat
# --------------------------------------------------------------------------- #
# Provider errors that are worth retrying on a different model: a retired model
# (404), a quota/rate limit (429) or a transient outage (5xx).
_FALLBACK_STATUSES = {404, 429, 500, 502, 503, 504}


def _status_of(exc: Exception) -> int | None:
    code = getattr(exc, "code", None)
    if isinstance(code, int):
        return code
    response = getattr(exc, "response", None)
    status = getattr(response, "status_code", None)
    return status if isinstance(status, int) else None


def _model_fallbacks(model: str) -> List[str]:
    """The selected model followed by working alternatives to try in order."""
    chain = [model]
    for name in [MODEL, *DEFAULT_GEMINI_MODELS, *_discover_gemini_models()]:
        if name and name not in chain:
            chain.append(name)
    return chain


def friendly_ai_error(exc: Exception, model: str) -> str:
    """Turn a provider exception into something a learner can act on."""
    text = str(exc)
    lowered = text.lower()
    if "invalid api key" in lowered or "authentication" in lowered:
        return "The AI provider rejected its API key. Check the key in .env."
    if status := _status_of(exc):
        if status == 404 or "not_found" in lowered or "not found" in lowered:
            return (
                f'The model "{model}" is no longer available. '
                "Pick another model in Settings and try again."
            )
        if status == 429:
            return (
                "Muri has hit the AI provider's rate limit. "
                "Please wait a moment and try again."
            )
        if status in {500, 502, 503, 504}:
            return "The AI provider is busy right now. Please try again in a moment."
    return f"Muri could not reach the AI provider: {exc}"


def gemini_reply(
    model: str,
    history: List[dict],
    attachments: List[Attachment],
    system: str,
    temperature: float,
) -> str:
    contents = build_contents(history, attachments)
    last_exc: Exception | None = None
    for candidate in _model_fallbacks(model):
        try:
            response = client.models.generate_content(
                model=candidate,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    temperature=temperature,
                ),
            )
            return response.text or ""
        except Exception as exc:  # noqa: BLE001 - try the next model if possible
            last_exc = exc
            if _status_of(exc) not in _FALLBACK_STATUSES:
                raise
    if last_exc is not None:
        raise last_exc
    return ""


def gemini_stream_reply(
    model: str,
    history: List[dict],
    attachments: List[Attachment],
    system: str,
    temperature: float,
):
    contents = build_contents(history, attachments)
    last_exc: Exception | None = None
    for candidate in _model_fallbacks(model):
        emitted = False
        try:
            stream = client.models.generate_content_stream(
                model=candidate,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    temperature=temperature,
                ),
            )
            for chunk in stream:
                text_value = getattr(chunk, "text", None)
                if text_value:
                    emitted = True
                    yield text_value
            return
        except Exception as exc:  # noqa: BLE001 - try the next model if possible
            if emitted or _status_of(exc) not in _FALLBACK_STATUSES:
                raise
            last_exc = exc
    if last_exc is not None:
        raise last_exc


@app.post("/api/chat")
def chat(req: ChatRequest, user: User = Depends(require_user)) -> dict:
    if not DB_READY:
        return {"reply": db_unavailable_message()}
    if len(req.message) > MAX_MESSAGE_CHARS:
        raise HTTPException(
            status_code=413,
            detail=f"Message is too long (max {MAX_MESSAGE_CHARS} characters).",
        )

    with SessionLocal() as db:
        try:
            _enforce_chat_budget(db, user.id)
        except HTTPException as exc:
            if exc.status_code == 429 and "today's message limit" in str(exc.detail):
                return {"reply": str(exc.detail)}
            raise
        ensure_session(db, req.session_id, user.id)
        append_message(
            db,
            req.session_id,
            "user",
            user_display_text(req.message, req.attachments),
        )
        learning.touch_activity(db, user.id, points=2)
        learning.evaluate_badges(db, user.id)
        settings = read_user_settings(db, user.id, DEFAULT_SETTINGS)
        model = _resolve_model(settings)
        temperature = float(settings.get("temperature", 0.7))
        system = settings.get("system_instruction", SYSTEM_INSTRUCTION)
        provider = provider_for(model)

        try:
            if not provider_ready(provider):
                reply = missing_key_message(provider)
            else:
                reply = gemini_reply(
                    model,
                    load_history(db, req.session_id),
                    req.attachments,
                    system,
                    temperature,
                )
        except Exception as exc:  # noqa: BLE001 - show a friendly provider error
            reply = friendly_ai_error(exc, model)

        append_message(db, req.session_id, "model", reply)
        return {"reply": reply}


@app.post("/api/chat/stream")
def chat_stream(
    req: ChatRequest, user: User = Depends(require_user)
) -> StreamingResponse:
    user_id = user.id

    def generate():
        if not DB_READY:
            yield sse({"delta": db_unavailable_message()})
            yield sse({"done": True})
            return

        db = SessionLocal()
        model = MODEL
        try:
            if len(req.message) > MAX_MESSAGE_CHARS:
                yield sse(
                    {
                        "error": (
                            f"Message is too long "
                            f"(max {MAX_MESSAGE_CHARS} characters)."
                        )
                    }
                )
                return
            try:
                _enforce_chat_budget(db, user_id)
            except HTTPException as exc:
                yield sse({"error": str(exc.detail)})
                return
            ensure_session(db, req.session_id, user_id)

            live_attachments: List[Attachment] = []
            if req.regenerate:
                trailing = db.scalars(
                    select(Message)
                    .where(Message.session_id == req.session_id)
                    .order_by(Message.id.desc())
                ).all()
                removed = False
                for row in trailing:
                    if row.role == "model":
                        db.delete(row)
                        removed = True
                    else:
                        break
                if removed:
                    db.commit()
            else:
                live_attachments = [
                    item for item in req.attachments if item.data
                ][:MAX_ATTACHMENTS]
                if not req.message.strip() and not live_attachments:
                    yield sse({"error": "Please type a message or attach a file."})
                    return
                append_message(
                    db,
                    req.session_id,
                    "user",
                    user_display_text(req.message, live_attachments),
                )
                learning.touch_activity(db, user_id, points=2)
                learning.evaluate_badges(db, user_id)

            history = load_history(db, req.session_id)

            if not history:
                yield sse({"error": "Nothing to respond to."})
                return

            settings = read_user_settings(db, user_id, DEFAULT_SETTINGS)
            model = _resolve_model(settings)
            system = settings.get("system_instruction", SYSTEM_INSTRUCTION)
            provider = provider_for(model)

            if not provider_ready(provider):
                message = missing_key_message(provider)
                append_message(db, req.session_id, "model", message)
                yield sse({"delta": message})
                return

            full = ""
            for text_value in gemini_stream_reply(
                model,
                history,
                live_attachments,
                system,
                float(settings.get("temperature", 0.7)),
            ):
                full += text_value
                yield sse({"delta": text_value})
            append_message(db, req.session_id, "model", full)
        except HTTPException as exc:
            db.rollback()
            yield sse({"error": exc.detail})
        except Exception as exc:  # noqa: BLE001 - surface provider/db errors to the UI
            db.rollback()
            yield sse({"error": friendly_ai_error(exc, model)})
        finally:
            db.close()
            yield sse({"done": True})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


if FRONTEND_DIST.is_dir():
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str) -> FileResponse:
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("MURI_HOST", "0.0.0.0")
    port = int(os.getenv("MURI_PORT", "8000"))
    if FRONTEND_DIST.is_dir():
        print(f"[Muri] Serving frontend from {FRONTEND_DIST}")
        print(f"[Muri] Open http://localhost:{port}")
    else:
        print("[Muri] Frontend not found. Run 'npm run build' in frontend/.")
    # proxy_headers: required when hosted behind a TLS proxy (Render/Railway/
    # nginx) so cookies, OAuth redirects and client IPs see the public scheme.
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=True,
        proxy_headers=True,
        forwarded_allow_ips="*",
    )
