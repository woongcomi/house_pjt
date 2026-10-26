"""최근 거래 피드 — web/public/data/recent.json

기간·순위 분석(export.py)과 달리 "지금 무슨 거래가 생기고 있나"를 보는 용도라
정제 테이블(trade)이 아니라 원시 거래(trade_raw)를 쓴다. 정제의 MAD 이상치 컷은
비정상적으로 싼 거래를 걸러내는데, 여기서는 그 싼 거래가 바로 보고 싶은 대상이다.

저가 판정: 같은 단지·같은 면적 버킷의 직전 REF_DAYS 일 거래 중위가 대비 비율.
거래가 REF_MIN_DEALS 건 미만이면 판정하지 않는다 (pct = null).

사용:  python pipeline/recent.py
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import date, timedelta
from statistics import median

import config as C
from db import connect
from stations import stations_of

RECENT_DAYS = 90
REF_DAYS = 365
REF_MIN_DEALS = 3
LOW_PCT = -10.0            # 이 이하면 "저가 거래"

_PYEONG = 1 / C.PYEONG_PER_M2


def _bucket_lookup(conn) -> dict[str, list[tuple[float, float, int]]]:
    """canonical_id → [(ar_min, ar_max, bucket_id)]"""
    out: dict[str, list] = defaultdict(list)
    for r in conn.execute("SELECT canonical_id, ar_min, ar_max, bucket_id FROM area_bucket"):
        out[r["canonical_id"]].append((r["ar_min"], r["ar_max"], r["bucket_id"]))
    return out


def _bucket_of(lookup, cid: str, ar: float) -> int:
    for lo, hi, b in lookup.get(cid, ()):
        if lo <= ar <= hi:
            return b
    return -round(ar)   # 버킷이 없으면 ㎡ 반올림으로 묶는다 (음수로 구분)


def build(conn, today: date | None = None) -> dict:
    today = today or date.today()
    ref_from = (today - timedelta(days=RECENT_DAYS + REF_DAYS)).isoformat()
    recent_from = (today - timedelta(days=RECENT_DAYS)).isoformat()

    alias = {r["apt_seq"]: r["canonical_id"] for r in conn.execute("SELECT * FROM complex_alias")}
    complexes = {r["canonical_id"]: r for r in conn.execute(
        "SELECT canonical_id, sgg_cd, umd_nm, apt_nm, build_year, lat, lng FROM complex")}
    buckets = _bucket_lookup(conn)

    rows = conn.execute(
        """
        SELECT apt_seq, sgg_cd, umd_nm, apt_nm, excl_ar, floor, deal_date, deal_amount,
               dealing_gbn, build_year
        FROM trade_raw
        WHERE deal_date >= ? AND apt_seq != '' AND excl_ar > 0 AND deal_amount > 0
          AND COALESCE(cdeal_type, '') != 'O'
          AND COALESCE(land_leasehold_gbn, '') != 'Y'
        ORDER BY deal_date
        """,
        (ref_from,),
    ).fetchall()

    # 단지×버킷별로 시간순 묶음 → 각 거래의 직전 1년 중위가
    groups: dict[tuple, list] = defaultdict(list)
    for r in rows:
        cid = alias.get(r["apt_seq"], r["apt_seq"])
        groups[(cid, _bucket_of(buckets, cid, r["excl_ar"]))].append((cid, r))

    out = []
    station_cids: set[str] = set()
    for group in groups.values():
        for i, (cid, r) in enumerate(group):
            if r["deal_date"] < recent_from:
                continue
            cutoff = (date.fromisoformat(r["deal_date"]) - timedelta(days=REF_DAYS)).isoformat()
            prior = [g["deal_amount"] for _, g in group[:i] if g["deal_date"] >= cutoff]
            pct = None
            if len(prior) >= REF_MIN_DEALS:
                pct = round((r["deal_amount"] / median(prior) - 1) * 100, 1)
            c = complexes.get(cid)
            st = stations_of(r["sgg_cd"], r["umd_nm"],
                             c["lat"] if c else None, c["lng"] if c else None)
            if st:
                station_cids.add(cid)
            ppa = round(r["deal_amount"] / (r["excl_ar"] / _PYEONG))
            out.append([
                r["deal_date"], r["sgg_cd"], r["umd_nm"], cid, r["apt_nm"],
                round(r["excl_ar"], 2), r["floor"], r["deal_amount"], ppa, pct,
                1 if r["dealing_gbn"] == "직거래" else 0, st,
            ])
    out.sort(key=lambda x: x[0], reverse=True)

    return {
        "v": 1,
        "today": today.isoformat(),
        "days": RECENT_DAYS,
        "refDays": REF_DAYS,
        "refMinDeals": REF_MIN_DEALS,
        "lowPct": LOW_PCT,
        "cols": ["d", "sgg", "umd", "cid", "apt", "ar", "fl", "amt", "ppa", "pct", "direct", "st"],
        "gu": {code: {"name": name, "sido": C.SIDO_OF[code]} for code, name in C.ALL_GU.items()},
        "stations": [s.name for s in __import__("stations").SINBUNDANG],
        "rows": out,
    }


def main() -> int:
    conn = connect()
    data = build(conn)
    path = C.EXPORT_DIR / "recent.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    low = sum(1 for r in data["rows"] if r[9] is not None and r[9] <= LOW_PCT)
    print(f"최근 {RECENT_DAYS}일 거래 {len(data['rows']):,}건 · 저가 {low:,}건 → {path}")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
