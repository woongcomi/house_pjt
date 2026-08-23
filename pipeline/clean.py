"""정제: trade_raw → trade.

필터 순서
  1) 해제 거래(cdealType='O') 제외 — 남기면 허위 고가 신고가 고점을 오염시킨다
  2) 직거래 제외 — 증여성·특수관계 거래가 저점을 왜곡 (2022~23 급증)
  3) 토지임대부 제외 — 소유 구조가 달라 평당가 비교 불가
  4) 하드 레인지 — 면적/금액/평당가 명백한 오기입
  5) 로버스트 이상치(MAD) — (단지×면적버킷) ±12개월 창에서 |z|>3.5

평당가는 **전용면적** 기준이다. 시중 표기(공급면적 기준)보다 약 30% 높게 나오므로
화면 어디서든 '전용 기준'을 반드시 병기해야 한다.
"""
from __future__ import annotations

import sqlite3
from collections import defaultdict
from statistics import median

import config as C
from metrics import ym_to_idx


def _floor_grp(floor: int | None, max_floor: int | None) -> int:
    if floor is None:
        return 1
    if floor <= C.FLOOR_LOW_MAX:
        return 0
    if max_floor and floor >= max_floor:
        return 2
    return 1


def build(conn: sqlite3.Connection) -> dict:
    conn.execute("DELETE FROM trade")

    where = ["t.apt_seq IS NOT NULL", "t.apt_seq <> ''",
             "t.excl_ar IS NOT NULL", f"t.excl_ar BETWEEN {C.AR_MIN} AND {C.AR_MAX}",
             "t.deal_amount IS NOT NULL", "t.deal_amount > 0"]
    if C.EXCLUDE_CANCELLED:
        where.append("COALESCE(t.cdeal_type,'') <> 'O'")
    if C.EXCLUDE_DIRECT_DEAL:
        where.append("COALESCE(t.dealing_gbn,'') <> '직거래'")
    if C.EXCLUDE_LAND_LEASEHOLD:
        # 실측: 이 필드는 100% 채워지며 값은 'N'(일반) / 'Y'(토지임대부) 다.
        # ''(빈 값) 으로 필터하면 전 거래가 삭제된다.
        where.append("COALESCE(t.land_leasehold_gbn,'') <> 'Y'")

    rows = conn.execute(
        f"SELECT t.dedup_key, t.apt_seq, t.excl_ar, t.floor, t.deal_ym, "
        f"t.deal_date, t.deal_amount, t.dealing_gbn "
        f"FROM trade_raw t WHERE {' AND '.join(where)}"
    ).fetchall()

    total_raw = conn.execute("SELECT COUNT(*) c FROM trade_raw").fetchone()["c"]

    # 면적 버킷 룩업
    buckets: dict[str, list[tuple[float, float, int]]] = defaultdict(list)
    for b in conn.execute(
        "SELECT canonical_id, bucket_id, ar_min, ar_max FROM area_bucket"
    ):
        buckets[b["canonical_id"]].append((b["ar_min"], b["ar_max"], b["bucket_id"]))

    # 단지별 최고층 (최상층 프리미엄 판정용)
    max_floor: dict[str, int] = {
        r["apt_seq"]: r["mf"]
        for r in conn.execute(
            "SELECT apt_seq, MAX(floor) mf FROM trade_raw "
            "WHERE apt_seq IS NOT NULL GROUP BY apt_seq"
        )
    }

    import math

    recs = []
    dropped_range = dropped_bucket = 0
    for r in rows:
        cid, ar = r["apt_seq"], r["excl_ar"]
        bid = None
        for lo, hi, b in buckets.get(cid, ()):
            if lo - 1e-3 <= ar <= hi + 1e-3:
                bid = b
                break
        if bid is None:
            dropped_bucket += 1
            continue

        ppa = r["deal_amount"] / (ar * C.PYEONG_PER_M2)
        if not (C.PPA_MIN <= ppa <= C.PPA_MAX):
            dropped_range += 1
            continue

        recs.append({
            "dedup_key": r["dedup_key"], "canonical_id": cid, "bucket_id": bid,
            "deal_ym": r["deal_ym"], "deal_date": r["deal_date"],
            "deal_amount": r["deal_amount"], "excl_ar": ar, "floor": r["floor"],
            "floor_grp": _floor_grp(r["floor"], max_floor.get(cid)),
            "ppa": ppa, "ln_ppa": math.log(ppa), "dealing_gbn": r["dealing_gbn"],
            "_mi": ym_to_idx(r["deal_ym"]),
        })

    dropped_mad = _mark_outliers(recs)

    conn.executemany(
        "INSERT INTO trade (dedup_key,canonical_id,bucket_id,deal_ym,deal_date,"
        "deal_amount,excl_ar,floor,floor_grp,ppa,ln_ppa,dealing_gbn) "
        "VALUES (:dedup_key,:canonical_id,:bucket_id,:deal_ym,:deal_date,"
        ":deal_amount,:excl_ar,:floor,:floor_grp,:ppa,:ln_ppa,:dealing_gbn)",
        [r for r in recs if not r.get("_outlier")],
    )
    conn.commit()

    kept = conn.execute("SELECT COUNT(*) c FROM trade").fetchone()["c"]
    return {
        "raw": total_raw,
        "after_filter": len(rows),
        "kept": kept,
        "dropped_by_filter": total_raw - len(rows),
        "dropped_no_bucket": dropped_bucket,
        "dropped_ppa_range": dropped_range,
        "dropped_mad": dropped_mad,
    }


def _mark_outliers(recs: list[dict]) -> int:
    """(단지×버킷) 롤링 창에서 MAD 기반 이상치 표시.

    3.5σ 를 쓰는 이유: 정상 분포에서 0.05% 수준. 로얄층/저층 프리미엄(±10%)은
    살리고 자릿수 오기입만 잡는 경계다.
    """
    groups: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for r in recs:
        groups[(r["canonical_id"], r["bucket_id"])].append(r)

    dropped = 0
    for items in groups.values():
        by_month: dict[int, list[dict]] = defaultdict(list)
        for r in items:
            by_month[r["_mi"]].append(r)

        for m, month_recs in by_month.items():
            win = _window(by_month, m, C.MAD_WINDOW_MONTHS)
            if len(win) < C.MAD_MIN_SAMPLE:
                win = _window(by_month, m, C.MAD_WINDOW_FALLBACK)
            if len(win) < C.MAD_MIN_SAMPLE:
                continue

            vals = [r["ln_ppa"] for r in win]
            med = median(vals)
            mad = max(median([abs(v - med) for v in vals]), C.MAD_FLOOR)

            for r in month_recs:
                if abs((r["ln_ppa"] - med) / (1.4826 * mad)) > C.MAD_Z_THRESHOLD:
                    r["_outlier"] = True
                    dropped += 1
    return dropped


def _window(by_month: dict[int, list[dict]], center: int, half: int) -> list[dict]:
    out: list[dict] = []
    for mm in range(center - half, center + half + 1):
        out.extend(by_month.get(mm, ()))
    return out
