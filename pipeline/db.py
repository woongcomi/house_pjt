"""SQLite 연결/스키마 관리."""
from __future__ import annotations

import sqlite3
from pathlib import Path

from config import DB_PATH, SCHEMA_PATH


def connect(path: Path | None = None) -> sqlite3.Connection:
    p = Path(path or DB_PATH)
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(p, timeout=60)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA cache_size=-200000")  # 약 200MB
    return conn


# 스키마에 나중에 추가된 컬럼들.
# CREATE TABLE IF NOT EXISTS 는 이미 있는 테이블을 건드리지 않으므로
# 기존 DB 에는 새 컬럼이 생기지 않는다. 여기서 따로 채워 넣는다.
_MIGRATIONS: list[tuple[str, str, str]] = [
    ("complex", "lat", "REAL"),
    ("complex", "lng", "REAL"),
    ("complex", "geo_src", "TEXT"),
    ("complex", "geo_at", "TEXT"),
]


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    migrate(conn)
    conn.commit()


def migrate(conn: sqlite3.Connection) -> list[str]:
    """빠진 컬럼을 ALTER TABLE 로 채운다. 이미 있으면 조용히 넘어간다."""
    applied: list[str] = []
    for table, col, coltype in _MIGRATIONS:
        cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
        if not cols:
            continue          # 테이블 자체가 아직 없음
        if col not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {coltype}")
            applied.append(f"{table}.{col}")
    if applied:
        conn.commit()
    return applied


def get_meta(conn: sqlite3.Connection, key: str, default: str | None = None):
    row = conn.execute("SELECT value FROM pipeline_meta WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO pipeline_meta(key,value) VALUES(?,?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, str(value)),
    )
