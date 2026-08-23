"""면적 타입 버킷팅.

excluUseAr 은 같은 '84타입'이라도 84.92 / 84.9564 / 84.99 처럼 미세하게 다르다.
단지 내 면적값을 정렬해 간격이 임계(3㎡)를 넘는 지점에서 자른다.
국내 아파트 타입 간 간격은 보통 10㎡ 이상(59/74/84/114)이고 동일 타입 내
변동은 1㎡ 미만이라 3㎡ 는 안전한 마진이다.
"""
from __future__ import annotations

import sqlite3
from statistics import median

import config as C


def _coarse(ar: float) -> str:
    for lo, hi, label in C.COARSE_BOUNDS:
        if lo <= ar < hi:
            return label
    return "XL"


def build(conn: sqlite3.Connection) -> dict:
    conn.execute("DELETE FROM area_bucket")

    rows = conn.execute(
        """
        SELECT apt_seq, excl_ar, COUNT(*) AS n
        FROM trade_raw
        WHERE apt_seq IS NOT NULL AND apt_seq <> ''
          AND excl_ar IS NOT NULL AND excl_ar BETWEEN ? AND ?
        GROUP BY apt_seq, excl_ar
        ORDER BY apt_seq, excl_ar
        """,
        (C.AR_MIN, C.AR_MAX),
    ).fetchall()

    by_complex: dict[str, list[tuple[float, int]]] = {}
    for r in rows:
        by_complex.setdefault(r["apt_seq"], []).append((r["excl_ar"], r["n"]))

    out = []
    for cid, areas in by_complex.items():
        clusters: list[list[tuple[float, int]]] = [[areas[0]]]
        for ar, n in areas[1:]:
            if ar - clusters[-1][-1][0] > C.AREA_BUCKET_GAP:
                clusters.append([(ar, n)])
            else:
                clusters[-1].append((ar, n))

        # 거래가 너무 적은 버킷은 가까운 이웃에 흡수
        merged: list[list[tuple[float, int]]] = []
        for cl in clusters:
            if merged and sum(n for _a, n in cl) < C.AREA_BUCKET_MIN_TRADES:
                merged[-1].extend(cl)
            else:
                merged.append(cl)
        if len(merged) > 1 and sum(n for _a, n in merged[0]) < C.AREA_BUCKET_MIN_TRADES:
            merged[1] = merged[0] + merged[1]
            merged.pop(0)

        total = sum(sum(n for _a, n in cl) for cl in merged) or 1
        for bid, cl in enumerate(merged):
            ars = [a for a, _n in cl]
            n_tr = sum(n for _a, n in cl)
            # 대표 면적은 거래건수 가중 최빈값
            rep = max(cl, key=lambda x: (x[1], -x[0]))[0]
            out.append((
                cid, bid, min(ars), max(ars), rep, rep * C.PYEONG_PER_M2,
                f"{round(rep)}㎡", _coarse(rep), n_tr, n_tr / total, 0.0,
            ))

    conn.executemany(
        "INSERT INTO area_bucket (canonical_id,bucket_id,ar_min,ar_max,ar_rep,"
        "pyeong_rep,label,coarse,n_trades,weight,delta) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        out,
    )
    conn.commit()

    n_multi = sum(1 for cid, a in by_complex.items() if len(a) > 1)
    return {
        "buckets": len(out),
        "complexes": len(by_complex),
        "avg_buckets": round(len(out) / max(1, len(by_complex)), 2),
        "complexes_multi_area": n_multi,
    }


def assign(conn: sqlite3.Connection, cid: str, ar: float) -> int | None:
    row = conn.execute(
        "SELECT bucket_id FROM area_bucket WHERE canonical_id=? "
        "AND ? BETWEEN ar_min - 0.001 AND ar_max + 0.001 LIMIT 1",
        (cid, ar),
    ).fetchone()
    return row["bucket_id"] if row else None
