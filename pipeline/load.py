"""trade_raw 적재.

재수집 시 '신고 취소로 사라진 거래'를 감지하기 위해 3단계로 처리한다:
  1) 해당 (구,월) 응답에서 온 기존 행을 전부 stale=1
  2) 이번 응답의 행을 UPSERT (stale=0 으로 복구, 변경 필드 갱신)
  3) 여전히 stale=1 인 행을 삭제
단순 INSERT OR IGNORE 로는 2단계까지만 되고 사라진 거래가 영원히 남는다.
"""
from __future__ import annotations

import sqlite3

from fetch import utcnow

COLUMNS = [
    "dedup_key", "apt_seq", "sgg_cd", "umd_cd", "umd_nm", "bonbun", "bubun",
    "jibun", "apt_nm", "apt_dong", "build_year", "excl_ar", "floor",
    "deal_ym", "deal_date", "deal_amount", "dealing_gbn", "sler_gbn",
    "buyer_gbn", "cdeal_type", "cdeal_day", "rgst_date",
    "land_leasehold_gbn", "estate_agent_sgg_nm", "road_nm",
    "src_lawd", "src_ymd", "seen_at",
]

_UPDATE_COLS = [
    "cdeal_type", "cdeal_day", "rgst_date", "dealing_gbn",
    "sler_gbn", "buyer_gbn", "apt_nm", "seen_at",
]

_SQL = (
    f"INSERT INTO trade_raw ({','.join(COLUMNS)}, stale) "
    f"VALUES ({','.join('?' * len(COLUMNS))}, 0) "
    "ON CONFLICT(dedup_key) DO UPDATE SET "
    + ", ".join(f"{c}=excluded.{c}" for c in _UPDATE_COLS)
    + ", stale=0"
)


def load_month(
    conn: sqlite3.Connection, lawd_cd: str, deal_ymd: str, items: list[dict]
) -> tuple[int, int]:
    """(적재 건수, 삭제 건수) 반환."""
    now = utcnow()

    conn.execute(
        "UPDATE trade_raw SET stale=1 WHERE src_lawd=? AND src_ymd=?",
        (lawd_cd, deal_ymd),
    )

    rows = []
    for rec in items:
        rec["seen_at"] = now
        rows.append(tuple(rec.get(c) for c in COLUMNS))
    if rows:
        conn.executemany(_SQL, rows)

    cur = conn.execute(
        "DELETE FROM trade_raw WHERE src_lawd=? AND src_ymd=? AND stale=1",
        (lawd_cd, deal_ymd),
    )
    return len(rows), cur.rowcount


def log_fetch(
    conn: sqlite3.Connection, lawd_cd: str, deal_ymd: str, *,
    status: str, page_no: int = 1, http_status: int | None = None,
    result_code: str | None = None, total_count: int | None = None,
    row_count: int | None = None,
) -> None:
    conn.execute(
        "INSERT INTO fetch_log "
        "(lawd_cd,deal_ymd,page_no,status,http_status,result_code,"
        " total_count,row_count,fetched_at) "
        "VALUES (?,?,?,?,?,?,?,?,?) "
        "ON CONFLICT(lawd_cd,deal_ymd,page_no) DO UPDATE SET "
        "status=excluded.status, http_status=excluded.http_status, "
        "result_code=excluded.result_code, total_count=excluded.total_count, "
        "row_count=excluded.row_count, fetched_at=excluded.fetched_at",
        (lawd_cd, deal_ymd, page_no, status, http_status, result_code,
         total_count, row_count, utcnow()),
    )
