import os
from pathlib import Path

from dotenv import load_dotenv
from pymysql.charset import charset_by_name
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker

load_dotenv(dotenv_path=Path(__file__).with_name(".env"), override=False)

# --------------------------------------------------------------------------- #
# DATABASE_URL resolution.
#
# Local dev reads muri/backend/.env (git-ignored, so it is never uploaded to
# Vercel). On Vercel that file does not exist in the deployment: DATABASE_URL
# must come from the project's Environment Variables instead (Settings ->
# Environment Variables, Production + Preview). Without it we fall back to
# localhost, where serverless has no MySQL -- that case is detected below and
# logged as an actionable error instead of timing out on every cold start.
# --------------------------------------------------------------------------- #
DEFAULT_DATABASE_URL = "mysql+pymysql://root@127.0.0.1:3306/muri?charset=utf8mb4"

# Vercel exports VERCEL=1 for both build and function runtime.
ON_VERCEL = os.getenv("VERCEL", "").strip().lower() not in {"", "0", "false"}


def _normalize_database_url(raw: str | None) -> str:
    """Accept the connection string hosting providers hand you.

    Railway/Aiven/PlanetScale print ``mysql://user:pass@host:3306/db`` with no
    driver. SQLAlchemy would then load the MySQLdb driver, which is not
    installed (this project ships PyMySQL), so a bare ``mysql://`` scheme is
    rewritten to ``mysql+pymysql://``. Empty/missing values fall back to the
    local-dev default.

    A raw ``@`` inside the password (``mysql://user:my@pass@host/db``) is
    silently misparsed by SQLAlchemy as host ``pass@host`` -- the connection
    then dies on DNS for every request. That is repaired by percent-encoding
    the userinfo section (already-encoded ``%40`` is left untouched).
    """
    url = (raw or "").strip()
    if not url:
        return DEFAULT_DATABASE_URL
    if url.startswith("mysql://"):
        url = "mysql+pymysql://" + url[len("mysql://"):]
    return _encode_userinfo_at(url)


def _encode_userinfo_at(url: str) -> str:
    """Percent-encode raw ``@`` characters inside the userinfo section.

    Inside ``scheme://...`` the authority ends at the first ``/`` (or ``?``/
    ``#`` when the URL has no path), and a host can never contain ``@`` -- so
    everything before the LAST ``@`` of the authority belongs to the password
    and must be encoded for SQLAlchemy to parse host/user correctly.
    """
    scheme, sep, rest = url.partition("://")
    if not sep:
        return url
    cut = len(rest)
    for i, char in enumerate(rest):
        if char in "/?#":
            cut = i
            break
    authority, tail = rest[:cut], rest[cut:]
    userinfo, at, hostport = authority.rpartition("@")
    if not at or "@" in hostport:
        return url  # no userinfo, or still ambiguous: leave it alone
    fixed_userinfo = userinfo.replace("@", "%40")
    candidate = f"{scheme}{sep}{fixed_userinfo}{at}{hostport}{tail}"
    try:
        parsed = make_url(candidate)
    except Exception:  # noqa: BLE001 - repair failed: return the original
        return url
    # Accept the repair only if it produced a sane host.
    host = (parsed.host or "").lower()
    if "@" in host or " " in host or not host:
        return url
    return candidate


DATABASE_URL = _normalize_database_url(os.getenv("DATABASE_URL"))

if not DATABASE_URL:
    raise RuntimeError("[Muri] DATABASE_URL is not set. Set it in muri/backend/.env"
        "(local dev) or in Vercel Environment Variables (production)."
    )


def _database_config_error(url: str) -> str:
    """Catch unsupported PyMySQL charsets before a login request reaches MySQL."""
    parsed = make_url(url)
    if parsed.drivername != "mysql+pymysql":
        return ""
    charset = parsed.query.get("charset")
    if charset is None:
        return ""
    if isinstance(charset, tuple) or charset_by_name(str(charset)) is None:
        return (
            "DATABASE_URL contains an unsupported MySQL charset. "
            "Set it to charset=utf8mb4."
        )
    return ""


DATABASE_CONFIG_ERROR = _database_config_error(DATABASE_URL)

MYSQL_SSL_CA = os.getenv("MYSQL_SSL_CA", "").strip()


def _ssl_ca_file() -> str | None:
    if not MYSQL_SSL_CA:
        return None
    here = Path(__file__).resolve().parent
    candidates = [
        Path(MYSQL_SSL_CA),
        here / MYSQL_SSL_CA,
        here.parents[1] / MYSQL_SSL_CA,  # repo root
    ]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    print(f"[Muri] MYSQL_SSL_CA not found: {MYSQL_SSL_CA}")
    return None


_SSL_CA = _ssl_ca_file()


def _connect_timeout() -> int:
    """Seconds before an unreachable host gives up (bounded, fail-fast)."""
    try:
        value = int(os.getenv("MURI_DB_CONNECT_TIMEOUT", "8"))
    except ValueError:
        value = 8
    return max(1, min(value, 60))


def _connect_args(url: str) -> dict:
    if not url.startswith("mysql"):
        return {}
    # Fail fast: an unreachable host must not burn the whole cold start.
    args: dict = {"connect_timeout": _connect_timeout()}
    if _SSL_CA:
        args["ssl_ca"] = _SSL_CA
    return args


def _is_loopback(url: str) -> bool:
    try:
        host = (make_url(url).host or "").lower()
    except Exception:  # noqa: BLE001 - malformed URL: engine reports it later
        return False
    return host in {"127.0.0.1", "localhost", "::1", ""}


def _describe_target(url: str) -> str:
    """Host/db for logs -- never the password (make_url masks it anyway)."""
    try:
        parsed = make_url(url)
        return (
            f"{parsed.drivername} -> {parsed.host}:{parsed.port or 3306}/"
            f"{parsed.database or '(no database)'}"
        )
    except Exception:  # noqa: BLE001
        return "(unparseable DATABASE_URL)"


_SOURCE = (
    "DATABASE_URL environment variable"
    if os.getenv("DATABASE_URL", "").strip()
    else "built-in localhost fallback (DATABASE_URL is NOT set)"
)
print(f"[Muri] Database target: {_describe_target(DATABASE_URL)} [{_SOURCE}]")

if ON_VERCEL and _is_loopback(DATABASE_URL):
    print(
        "[Muri] ERROR: DATABASE_URL points at localhost, but this deployment "
        "runs on Vercel where no local MySQL exists. Add your hosted MySQL "
        "URL as an Environment Variable named DATABASE_URL (Vercel project -> "
        "Settings -> Environment Variables, scope Production and Preview), "
        "then redeploy."
    )
elif ON_VERCEL and DATABASE_URL.startswith("sqlite"):
    print(
        "[Muri] WARNING: DATABASE_URL is SQLite, but Vercel's filesystem is "
        "read-only and ephemeral -- users, chats and progress will not "
        "persist. Use a hosted MySQL URL instead."
    )


def _ensure_database(url: str) -> None:
    parsed = make_url(url)
    if not parsed.drivername.startswith("mysql") or not parsed.database:
        return
    server_url = URL.create(
        drivername=parsed.drivername,
        username=parsed.username,
        password=parsed.password,
        host=parsed.host,
        port=parsed.port,
    )
    server_engine = create_engine(server_url, connect_args=_connect_args(url), future=True)
    try:
        with server_engine.connect() as conn:
            conn.execute(
                text(
                    f"CREATE DATABASE IF NOT EXISTS `{parsed.database}` "
                    "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
                )
            )
            conn.commit()
    finally:
        server_engine.dispose()


if ON_VERCEL:
    # Serverless: the provider already provisions the database named in the
    # URL and usually forbids CREATE DATABASE. Attempting it would only spend
    # a full extra connection (up to the connect timeout) per cold start.
    # Local MySQL keeps getting the database created automatically.
    pass
else:
    try:
        _ensure_database(DATABASE_URL)
    except Exception as exc:  # noqa: BLE001 - keep the server bootable without MySQL
        print(f"[Muri] Could not ensure MySQL database exists: {exc}")


def _engine_kwargs(url: str) -> dict:
    kwargs: dict = {"pool_pre_ping": True, "future": True}
    if not url.startswith("mysql"):
        return kwargs  # SQLite keeps SQLAlchemy's default pool.
    # Serverless runs many short-lived instances against one hosted database:
    # keep each pool small so a burst of cold starts cannot exhaust the
    # provider's connection limit, and recycle sockets before its idle
    # timeout reaps them (pool_pre_ping already discards dead ones).
    if ON_VERCEL:
        kwargs.update(pool_size=2, max_overflow=2, pool_timeout=10)
    kwargs.update(pool_recycle=1800)
    return kwargs


engine = create_engine(
    DATABASE_URL,
    connect_args=_connect_args(DATABASE_URL),
    **_engine_kwargs(DATABASE_URL),
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
class Base(DeclarativeBase):
    pass