"""집계 — 면적 믹스 보정 지수.

왜 필요한가
───────────
단지 A가 59㎡와 84㎡를 함께 가지고 있을 때,
  2023-03: 59㎡만 2건 거래 → 평당 5,200만원   (소형이 평당가가 높다)
  2023-04: 84㎡만 1건 거래 → 평당 4,600만원
단순 중위값을 쓰면 한 달 만에 -11.5% 로 보이지만 실제 가격은 그대로다.
이 편향을 그대로 두면 '변동폭 랭킹'이 통째로 노이즈 랭킹이 된다.

방법 (2-pass 로버스트 고정효과)
────────────────────────────
  m(c,b,t)  = median{ ln(ppa) : 3개월 창 W(t) 안의 버킷 b 거래 }
  L0(c,t)   = Σ_{b∈A(t)} w_b·m(c,b,t) / Σ_{b∈A(t)} w_b      # 1차(편향 있음)
  δ_b       = median_t { m(c,b,t) − L0(c,t) }                # 타입 프리미엄
  L(c,t)    = Σ_{b∈A(t)} w_b·(m − δ_b) / Σ_{b∈A(t)} w_b     # 보정
  P(c,t)    = exp( L(c,t) + Σ_all b w_b·δ_b )                # 단지 평균 타입 수준

ln p = α_t + β_b + ε 헤도닉 회귀의 로버스트 근사다. median 만 쓰므로
희소 데이터에서 회귀보다 안정적이고 외부 의존성이 없다.
"""
from __future__ import annotations

import math
import sqlite3
from collections import defaultdict
from statistics import median

import config as C
from metrics import idx_to_ym, ym_to_idx

HALF = C.SMOOTH_WINDOW // 2


def build(conn: sqlite3.Connection) -> dict:
    conn.execute("DELETE FROM agg_type_month")
    conn.execute("DELETE FROM agg_complex_month")
    conn.execute("DELETE FROM agg_region_month")

    weights: dict[str, dict[int, float]] = defaultdict(dict)
    pyeong: dict[str, dict[int, float]] = defaultdict(dict)
    for b in conn.execute(
        "SELECT canonical_id, bucket_id, weight, pyeong_rep FROM area_bucket"
    ):
        weights[b["canonical_id"]][b["bucket_id"]] = b["weight"]
        pyeong[b["canonical_id"]][b["bucket_id"]] = b["pyeong_rep"]

    # (cid, bid) -> {month_idx: [(ln_ppa, amount), ...]}
    data: dict[str, dict[int, dict[int, list[tuple[float, int]]]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(list))
    )
    for r in conn.execute(
        "SELECT canonical_id, bucket_id, deal_ym, ln_ppa, deal_amount FROM trade"
    ):
        data[r["canonical_id"]][r["bucket_id"]][ym_to_idx(r["deal_ym"])].append(
            (r["ln_ppa"], r["deal_amount"])
        )

    type_rows, complex_rows = [], []

    for cid, by_bucket in data.items():
        w_all = weights.get(cid, {})
        months = sorted({m for bm in by_bucket.values() for m in bm})
        if not months:
            continue
        last = months[-1]

        # ── pass 1: 버킷×월 중위값 + 1차 지수 ─────────────
        m_tab: dict[int, dict[int, float]] = defaultdict(dict)   # bid -> t -> ln median
        n_tab: dict[int, dict[int, int]] = defaultdict(dict)
        amt_tab: dict[int, dict[int, int]] = defaultdict(dict)

        # 각 버킷을 '그 버킷에 거래가 있는 달'만 순회하면 3개월 창의 의미가 없어진다.
        # 단지 전체의 관측월을 순회해야 이웃 달의 거래가 창에 들어와, 한 달에 한
        # 타입만 거래된 경우에도 모든 타입의 추정치가 생기고 믹스 보정이 작동한다.
        for bid, by_month in by_bucket.items():
            for t in months:
                win = _window(by_month, t, last)
                if not win:
                    continue
                m_tab[bid][t] = median([v for v, _a in win])
                n_tab[bid][t] = len(win)
                amt_tab[bid][t] = int(median([a for _v, a in win]))
                type_rows.append((
                    cid, bid, idx_to_ym(t), len(win), len(by_month.get(t, ())),
                    m_tab[bid][t], math.exp(m_tab[bid][t]), amt_tab[bid][t],
                ))

        all_t = sorted({t for bt in m_tab.values() for t in bt})
        l0: dict[int, float] = {}
        for t in all_t:
            num = den = 0.0
            for bid, bt in m_tab.items():
                if t in bt:
                    w = w_all.get(bid, 0.0) or 1e-9
                    num += w * bt[t]
                    den += w
            if den > 0:
                l0[t] = num / den

        # ── pass 2: 타입 고정효과 δ_b ────────────────────
        delta: dict[int, float] = {}
        for bid, bt in m_tab.items():
            diffs = [bt[t] - l0[t] for t in bt if t in l0]
            delta[bid] = median(diffs) if diffs else 0.0

        base = sum(w_all.get(bid, 0.0) * d for bid, d in delta.items())

        # 대표 버킷 = 거래 비중이 가장 큰 타입 (실금액 환산용)
        ref_bid = max(w_all, key=lambda b: w_all[b]) if w_all else None

        # ── 최종 지수 ───────────────────────────────────
        for t in all_t:
            num = den = 0.0
            n_pool = 0
            nb = 0
            for bid, bt in m_tab.items():
                if t not in bt:
                    continue
                w = w_all.get(bid, 0.0) or 1e-9
                num += w * (bt[t] - delta[bid])
                den += w
                n_pool += n_tab[bid][t]
                nb += 1
            if den <= 0:
                continue

            ln_idx = num / den
            idx_ppa = math.exp(ln_idx + base)

            amount_ref = None
            if ref_bid is not None and ref_bid in pyeong.get(cid, {}):
                ppa_ref = math.exp(ln_idx + delta.get(ref_bid, 0.0))
                amount_ref = int(round(ppa_ref * pyeong[cid][ref_bid]))

            n_raw = sum(len(by_bucket[b].get(t, ())) for b in by_bucket)
            complex_rows.append((cid, idx_to_ym(t), n_pool, n_raw, nb,
                                 idx_ppa, amount_ref))

        for bid, d in delta.items():
            conn.execute(
                "UPDATE area_bucket SET delta=? WHERE canonical_id=? AND bucket_id=?",
                (d, cid, bid),
            )

    conn.executemany(
        "INSERT INTO agg_type_month (canonical_id,bucket_id,ym,n,n_raw,ln_med,"
        "ppa_med,amount_med) VALUES (?,?,?,?,?,?,?,?)", type_rows)
    conn.executemany(
        "INSERT INTO agg_complex_month (canonical_id,ym,n,n_raw,n_buckets,"
        "idx_ppa,amount_ref) VALUES (?,?,?,?,?,?,?)", complex_rows)
    conn.commit()

    _build_region(conn)

    return {
        "type_month_rows": len(type_rows),
        "complex_month_rows": len(complex_rows),
        "complexes": len(data),
    }


def _window(by_month: dict[int, list], t: int, last: int) -> list:
    """중심 3개월 풀링. 마지막 월만 후행 창을 쓴다.

    회고 분석이라 미래 정보를 봐도 되지만(look-ahead 문제 없음), 시계열의
    끝에서는 미래가 없으므로 뒤로 당긴다. 후행창을 전 구간에 쓰면 고점 시점이
    한 달씩 밀려 '언제가 고점이었나'가 틀어진다.
    """
    span = range(t - HALF, t + HALF + 1) if t < last else range(t - 2 * HALF, t + 1)
    out = []
    for mm in span:
        out.extend(by_month.get(mm, ()))
    return out


def _build_region(conn: sqlite3.Connection) -> None:
    """구·서울 단위 월별 시세. 단지 지수의 거래량 가중 중위값."""
    conn.execute(
        """
        INSERT INTO agg_region_month (region_kind, region_cd, ym, n, ppa_med, idx_ppa)
        SELECT 'sgg', c.sgg_cd, a.ym, SUM(a.n_raw),
               AVG(a.idx_ppa), AVG(a.idx_ppa)
        FROM agg_complex_month a JOIN complex c USING (canonical_id)
        GROUP BY c.sgg_cd, a.ym
        """
    )
    conn.execute(
        """
        INSERT INTO agg_region_month (region_kind, region_cd, ym, n, ppa_med, idx_ppa)
        SELECT 'seoul', '11', a.ym, SUM(a.n_raw), AVG(a.idx_ppa), AVG(a.idx_ppa)
        FROM agg_complex_month a
        GROUP BY a.ym
        """
    )
    conn.commit()
