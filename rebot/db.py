"""SQLite 저장소. data/rebot.db (gitignore 됨)."""

import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from rebot.config import ROOT
from rebot.molit import Deal

DB_PATH = ROOT / "data" / "rebot.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS deals (
    id          TEXT PRIMARY KEY,
    sgg_cd      TEXT NOT NULL,
    umd_cd      TEXT,
    umd_nm      TEXT NOT NULL,
    apt_seq     TEXT NOT NULL,
    apt_nm      TEXT NOT NULL,
    apt_dong    TEXT,
    jibun       TEXT,
    road_nm     TEXT,
    build_year  INTEGER,
    area        REAL NOT NULL,
    floor       INTEGER,
    deal_date   TEXT NOT NULL,
    amount      INTEGER NOT NULL,
    dealing_gbn TEXT,
    canceled    INTEGER NOT NULL DEFAULT 0,
    cdeal_day   TEXT,
    rgst_date   TEXT,
    first_seen  TEXT NOT NULL,
    last_seen   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_deals_sgg_date ON deals(sgg_cd, deal_date);
CREATE INDEX IF NOT EXISTS ix_deals_apt ON deals(apt_seq, area, deal_date);
CREATE INDEX IF NOT EXISTS ix_deals_first_seen ON deals(first_seen);

CREATE TABLE IF NOT EXISTS fetch_log (
    sgg_cd     TEXT NOT NULL,
    ym         TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    count      INTEGER NOT NULL,
    PRIMARY KEY (sgg_cd, ym)
);
"""


@contextmanager
def connect(path: Path = DB_PATH):
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript(SCHEMA)
    try:
        yield con
        con.commit()
    finally:
        con.close()


def upsert_deals(con: sqlite3.Connection, deals: list[Deal]) -> int:
    """거래를 저장하고 이번에 처음 본 건수를 돌려준다."""
    now = datetime.now().isoformat(timespec="seconds")
    before = con.execute("SELECT COUNT(*) FROM deals").fetchone()[0]
    con.executemany(
        """
        INSERT INTO deals (id, sgg_cd, umd_cd, umd_nm, apt_seq, apt_nm, apt_dong, jibun, road_nm,
                           build_year, area, floor, deal_date, amount, dealing_gbn, canceled,
                           cdeal_day, rgst_date, first_seen, last_seen)
        VALUES (:id, :sgg_cd, :umd_cd, :umd_nm, :apt_seq, :apt_nm, :apt_dong, :jibun, :road_nm,
                :build_year, :area, :floor, :deal_date, :amount, :dealing_gbn, :canceled,
                :cdeal_day, :rgst_date, :now, :now)
        ON CONFLICT(id) DO UPDATE SET
            canceled = excluded.canceled,
            cdeal_day = excluded.cdeal_day,
            rgst_date = excluded.rgst_date,
            last_seen = excluded.last_seen
        """,
        [{**d.__dict__, "now": now} for d in deals],
    )
    after = con.execute("SELECT COUNT(*) FROM deals").fetchone()[0]
    return after - before


def log_fetch(con: sqlite3.Connection, sgg_cd: str, ym: str, count: int) -> None:
    con.execute(
        "INSERT OR REPLACE INTO fetch_log (sgg_cd, ym, fetched_at, count) VALUES (?, ?, ?, ?)",
        (sgg_cd, ym, datetime.now().isoformat(timespec="seconds"), count),
    )
