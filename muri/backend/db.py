import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker

load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "mysql+pymysql://root@127.0.0.1:3306/muri?charset=utf8mb4",
)

# Hosted MySQL (Aiven and most others) requires TLS. Download the provider's
# CA certificate (Aiven console -> service -> Connection information ->
# "Download CA certificate"), commit it to the repo (it is public, not a
# secret), and point MYSQL_SSL_CA at it. Local MySQL without TLS keeps
# working when this is unset.
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


def _connect_args(url: str) -> dict:
    if url.startswith("mysql") and _SSL_CA:
        return {"ssl_ca": _SSL_CA}
    return {}


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


try:
    _ensure_database(DATABASE_URL)
except Exception as exc:  # noqa: BLE001 - keep the server bootable without MySQL
    print(f"[Muri] Could not ensure MySQL database exists: {exc}")

engine = create_engine(
    DATABASE_URL, pool_pre_ping=True, connect_args=_connect_args(DATABASE_URL), future=True
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass
