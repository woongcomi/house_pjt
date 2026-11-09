"""투자 인사이트 — web/public/data/insights.json

59㎡대(S60)·84㎡대(M85) 매수자 관점에서 역세권(역 반경 700m)과 관심 생활권(오리역·죽전역
반경 1km) 단지를 같은 잣대로 비교한다.

역별·단지별로
  가격      최근 90일 실거래 중위가(억) + 평당가 환산 월별 시계열
  변동      1년·3년 변동, 고점(2015~)·고점 대비, 저점 대비 회복
  거래량    최근 3개월 거래가 과거 5년 대비 몇 σ 인지 (z)
  상대가치  강남구 평당가 대비 비율과 그 비율의 10년 백분위 (낮을수록 역사적으로 싸다)
  흐름전이  강남 월간 변화율과의 교차상관으로 '강남을 몇 달 뒤따르는지'
  스트레스  저가 거래(동일 단지·면적형 직전 1년 중위 대비 -10%↓) 비율의 월별 추세
  점수      위 요소를 0~100 으로 합성 (하위 점수도 그대로 내려 근거를 보여준다)

사용:  python pipeline/insights.py
"""
from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from datetime import date, timedelta
from statistics import median, pstdev, mean

import config as C
from db import connect
from metrics import ym_to_idx, idx_to_ym
from stations import ALL_STATIONS, LINE_OF, STATION_RADIUS_M, distance_m

SIZE_GROUPS = {"S60": "59㎡대", "M85": "84㎡대"}
REP_AREA = {"S60": 59.9, "M85": 84.9}          # 평당가 → 대표 면적 환산용 (㎡)
# 면적형 묶음은 대표 전용면적으로 판정한다. coarse(S60=60㎡ 미만 전부)를 그대로 쓰면
# 20~40㎡ 초소형이 '59㎡대'에 섞여 강남역·죽전처럼 소형이 많은 곳의 값이 반토막 난다.
SIZE_RANGE = {"S60": (49.5, 62.0), "M85": (76.0, 90.0)}
WATCH_CENTERS = ("오리", "죽전")
WATCH_RADIUS_M = 1000
GANGNAM_SGG = "11680"
SERIES_MONTHS = 120                              # 시계열 10년
PEAK_FROM = ym_to_idx("2015-01")
RECENT_DAYS = 90
REF_DAYS, REF_MIN_DEALS, LOW_PCT = 365, 3, -10.0
STRESS_MONTHS = 36
TARGET_GU = ("11680", "11650", "41135", "41465", "41117")

# ── 유틸 ───────────────────────────────────────────────
def wmedian(pairs: list[tuple[float, float]]) -> float | None:
    """(값, 가중치) 가중 중위값."""
    pairs = [(v, w) for v, w in pairs if w > 0 and v is not None]
    if not pairs:
        return None
    pairs.sort()
    half = sum(w for _v, w in pairs) / 2
    acc = 0.0
    for v, w in pairs:
        acc += w
        if acc >= half:
            return v
    return pairs[-1][0]


def pct_rank(values: list[float], x: float) -> float:
    vals = [v for v in values if v is not None]
    if not vals:
        return 50.0
    return round(100 * sum(1 for v in vals if v <= x) / len(vals), 1)


def clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def to_eok(manwon: float | None) -> float | None:
    return round(manwon / 10000, 2) if manwon else None


def at(series: dict[int, float], t: int, tol: int = 2) -> float | None:
    """t 시점 값. 없으면 ±tol 개월 안에서 가장 가까운 값."""
    if t in series:
        return series[t]
    for d in range(1, tol + 1):
        if t - d in series:
            return series[t - d]
        if t + d in series:
            return series[t + d]
    return None


def series_metrics(ppa: dict[int, float], vol: dict[int, int], last_t: int) -> dict:
    """평당가 월별 시계열 {t: ppa} 과 거래량 {t: n} 에서 변동·고점·거래량 지표."""
    cur_ts = [t for t in range(last_t - 2, last_t + 1) if t in ppa]
    cur = mean(ppa[t] for t in cur_ts) if cur_ts else None
    out: dict = {k: None for k in ("ppaNow", "chg1y", "chg3y", "peakYm", "peakPpa", "drawdown",
                                   "troughYm", "recovery", "momentum", "vol3m", "volZ")}
    out["ppaNow"] = round(cur) if cur else None
    if not cur:
        return out

    for key, back in (("chg1y", 12), ("chg3y", 36)):
        base = at(ppa, last_t - back)
        out[key] = round(cur / base - 1, 4) if base else None

    # 고점·고점 대비, 그 이후 저점 대비 회복
    obs = [(t, v) for t, v in ppa.items() if t >= PEAK_FROM]
    if obs:
        t_peak, p_peak = max(obs, key=lambda x: (x[1], -x[0]))
        out["peakYm"], out["peakPpa"] = idx_to_ym(t_peak), round(p_peak)
        out["drawdown"] = round(cur / p_peak - 1, 4)
        after = [(t, v) for t, v in obs if t >= t_peak]
        t_low, p_low = min(after, key=lambda x: (x[1], x[0]))
        out["troughYm"], out["recovery"] = idx_to_ym(t_low), round(cur / p_low - 1, 4)

    # 모멘텀: 최근 3개월 평균 vs 그 전 9개월 평균
    prev = [ppa[t] for t in range(last_t - 11, last_t - 2) if t in ppa]
    out["momentum"] = round(cur / mean(prev) - 1, 4) if prev else None

    # 거래량 z: 최근 3개월 합 vs 과거 60개월의 3개월 합 분포
    def win(t):
        return sum(vol.get(k, 0) for k in range(t - 2, t + 1))
    hist = [win(t) for t in range(last_t - 60, last_t - 2)]
    now_v = win(last_t)
    out["vol3m"] = now_v
    if len(hist) >= 12 and pstdev(hist) > 0:
        out["volZ"] = round((now_v - mean(hist)) / pstdev(hist), 2)
    else:
        out["volZ"] = None
    return out


def lead_lag(target: dict[int, float], ref: dict[int, float], last_t: int, max_lag: int = 6) -> dict:
    """target(t) 월간 변화율 ~ ref(t-lag) 의 상관이 가장 높은 lag. 양수면 target 이 뒤따른다."""
    def changes(s):
        out = {}
        for t in range(last_t - SERIES_MONTHS, last_t + 1):
            a, b = at(s, t - 1, 1), at(s, t, 1)
            if a and b:
                out[t] = math.log(b / a)
        return out
    tc, rc = changes(target), changes(ref)
    best = {"lag": 0, "corr": None}
    for lag in range(0, max_lag + 1):
        xs, ys = [], []
        for t, v in tc.items():
            if t - lag in rc:
                xs.append(rc[t - lag]); ys.append(v)
        if len(xs) < 36:
            continue
        mx, my = mean(xs), mean(ys)
        sx, sy = pstdev(xs), pstdev(ys)
        if sx == 0 or sy == 0:
            continue
        corr = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (len(xs) * sx * sy)
        if best["corr"] is None or corr > best["corr"]:
            best = {"lag": lag, "corr": round(corr, 3)}
    return best


def score(m: dict, rel_pct: float | None, stress: float | None) -> dict | None:
    """0~100 합성 점수. 하위 점수를 함께 돌려줘 근거를 보여준다. 가격 표본이 없으면 None."""
    if not m.get("ppaNow"):
        return None
    parts = {
        # 강남 대비 비율이 10년 범위에서 낮을수록 (싸게 눌려 있을수록) 높다
        "value": 100 - rel_pct if rel_pct is not None else 50,
        # 고점에서 많이 빠져 있을수록 회복 여지 (-20% 이면 만점)
        "upside": 100 * clamp01(-(m.get("drawdown") or 0) / 0.20),
        # 최근 3개월이 이전 9개월보다 오르기 시작했는가 (±5%)
        "momentum": 100 * clamp01(((m.get("momentum") or 0) + 0.05) / 0.10),
        # 거래량 급증은 가격을 선행한다 (z −2 ~ +2)
        "volume": 100 * clamp01(((m.get("volZ") or 0) + 2) / 4),
        # 저가 거래가 많으면 협상 여지 (0~15%)
        "stress": 100 * clamp01((stress or 0) / 0.15),
    }
    w = {"value": .30, "upside": .25, "momentum": .20, "volume": .15, "stress": .10}
    total = sum(parts[k] * w[k] for k in w)
    return {"total": round(total), **{k: round(v) for k, v in parts.items()}}


# ── 데이터 적재 ─────────────────────────────────────────
def load(conn):
    cx = {}
    for r in conn.execute(
        "SELECT canonical_id, sgg_cd, umd_nm, apt_nm, build_year, n_trades, lat, lng "
        "FROM complex WHERE sgg_cd IN (%s)" % ",".join("?" * len(TARGET_GU)), TARGET_GU
    ):
        d = dict(r)
        d["stations"] = [
            s.name for s in ALL_STATIONS
            if d["lat"] and distance_m(d["lat"], d["lng"], s.lat, s.lng) <= STATION_RADIUS_M
        ]
        centers = [s for s in ALL_STATIONS if s.name in WATCH_CENTERS]
        d["watchDist"] = min(
            (distance_m(d["lat"], d["lng"], s.lat, s.lng) for s in centers), default=None
        ) if d["lat"] else None
        cx[d["canonical_id"]] = d

    coarse = {}   # (cid, bucket) -> (S60/M85/None, ar_min, ar_max)
    for r in conn.execute("SELECT canonical_id, bucket_id, ar_rep, ar_min, ar_max FROM area_bucket"):
        if r["canonical_id"] in cx:
            grp = next((g for g, (lo, hi) in SIZE_RANGE.items() if lo <= r["ar_rep"] <= hi), None)
            coarse[(r["canonical_id"], r["bucket_id"])] = (grp, r["ar_min"], r["ar_max"])

    # 단지×면적형 월별 중위 평당가·거래량
    series = defaultdict(dict)   # (cid, grp) -> {t: (ppa, n_raw)}
    for r in conn.execute(
        "SELECT canonical_id, bucket_id, ym, n_raw, ppa_med FROM agg_type_month WHERE n_raw > 0"
    ):
        key = (r["canonical_id"], r["bucket_id"])
        if key not in coarse:
            continue
        grp = coarse[key][0]
        if grp in SIZE_GROUPS:
            series[(r["canonical_id"], grp)][ym_to_idx(r["ym"])] = (r["ppa_med"], r["n_raw"])
    return cx, coarse, series


def group_series(keys, series, months=None) -> tuple[dict[int, float], dict[int, int]]:
    """여러 단지의 월별 평당가를 하나의 지역 시계열로 합친다.

    단순히 달마다 중위값을 취하면 '이번 달에 어느 단지가 거래됐나'에 따라 값이 널뛴다
    (강남역 근처처럼 단지 간 가격 차가 큰 곳은 특히). 그래서 연쇄 지수를 쓴다:
    두 달 연속 관측이 있는 단지들의 월간 로그 변화율을 거래량 가중 평균해 이어 붙이고,
    최근 3개월의 실제 거래량 가중 중위 평당가에 수준을 맞춘다. 단지가 하나면 그 단지
    시계열 그대로다.
    """
    vol: dict[int, int] = defaultdict(int)
    by_t: dict[int, list] = defaultdict(list)
    for k in keys:
        for t, (ppa, n) in series.get(k, {}).items():
            by_t[t].append((ppa, n))
            vol[t] += n
    if not by_t:
        return {}, {}
    # 관측이 없는 달에도 증분이 귀속되므로 루프는 빈 달까지 포함한 연속 구간을 돈다
    ts = months or list(range(min(by_t), max(by_t) + 1))
    # 단지마다 '직전 관측월 → 이번 관측월' 로그 변화율을 그 사이 달들에 고르게 나눠 귀속시킨다
    # (반복매매 지수와 같은 발상). 연속한 두 달만 비교하면 거래 없는 달이 낀 구간의 변화가
    # 사라지고, 이번 달에 몰아넣으면 3년 만에 거래된 단지의 누적 상승이 한 달 변화로 둔갑한다.
    # 긴 공백은 각 달에 대한 정보가 약하므로 가중치도 공백 길이로 나눈다.
    num: dict[int, float] = defaultdict(float)
    den: dict[int, float] = defaultdict(float)
    for k in keys:
        s = series.get(k)
        if not s:
            continue
        obs = sorted(t for t in s if s[t][0] > 0)
        for prev, t in zip(obs, obs[1:]):
            gap = t - prev
            if t < ts[0] or prev > ts[-1]:
                continue
            w = min(s[t][1], s[prev][1]) / gap
            step = math.log(s[t][0] / s[prev][0]) / gap
            for m in range(prev + 1, t + 1):
                num[m] += w * step
                den[m] += w
    level, cur = {}, 100.0
    for t in ts:
        if den.get(t, 0) > 0:
            cur *= math.exp(num[t] / den[t])
        if t in by_t:
            level[t] = cur
    # 수준 맞추기: 최근 3개 관측월의 가중 중위 평당가
    recent = [t for t in sorted(level) if t >= max(level) - 2]
    actual = wmedian([pair for t in recent for pair in by_t[t]])
    if not actual:
        return {}, dict(vol)
    scale = actual / mean(level[t] for t in recent)
    return {t: v * scale for t, v in level.items()}, dict(vol)


def load_deals(conn, cids: set[str], since: str):
    rows = conn.execute(
        """
        SELECT apt_seq, excl_ar, floor, deal_date, deal_amount, dealing_gbn
        FROM trade_raw
        WHERE deal_date >= ? AND excl_ar > 0 AND deal_amount > 0
          AND COALESCE(cdeal_type,'') != 'O' AND COALESCE(land_leasehold_gbn,'') != 'Y'
        ORDER BY deal_date
        """,
        (since,),
    )
    return [dict(r) for r in rows if r["apt_seq"] in cids]


def bucket_of(coarse, cid, ar):
    for (c, b), (grp, lo, hi) in coarse.items():
        if c == cid and lo <= ar <= hi:
            return b, grp
    return None, None


# ── 본체 ───────────────────────────────────────────────
def build(conn, today: date | None = None) -> dict:
    today = today or date.today()
    last_t = ym_to_idx(conn.execute("SELECT MAX(ym) m FROM agg_type_month").fetchone()["m"])
    # 이번 달은 신고가 진행 중이라 표본이 적어 흔들린다 → 지난달을 '현재'로 본다
    last_t -= 1
    months = list(range(last_t - SERIES_MONTHS + 1, last_t + 1))

    cx, coarse, series = load(conn)

    # 강남구 기준 시계열 (면적형별)
    gangnam = {}
    for grp in SIZE_GROUPS:
        keys = [(cid, grp) for cid, d in cx.items() if d["sgg_cd"] == GANGNAM_SGG]
        gangnam[grp] = group_series(keys, series, months)

    # 거래 원본: 최근 90일 + 저가 판정용 1년 + 스트레스 36개월
    station_cids = {cid for cid, d in cx.items() if d["stations"] or (d["watchDist"] or 1e9) <= WATCH_RADIUS_M}
    since = (today - timedelta(days=30 * STRESS_MONTHS + REF_DAYS + 31)).isoformat()
    deals = load_deals(conn, station_cids, since)
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for d in deals:
        b, grp = bucket_of(coarse, d["apt_seq"], d["excl_ar"])
        d["bucket"], d["grp"] = b, grp
        groups[(d["apt_seq"], b)].append(d)
    for g in groups.values():
        for i, d in enumerate(g):
            cutoff = (date.fromisoformat(d["deal_date"]) - timedelta(days=REF_DAYS)).isoformat()
            prior = [x["deal_amount"] for x in g[:i] if x["deal_date"] >= cutoff]
            d["pct"] = round((d["deal_amount"] / median(prior) - 1) * 100, 1) if len(prior) >= REF_MIN_DEALS else None
            d["low"] = d["pct"] is not None and d["pct"] <= LOW_PCT
    recent_from = (today - timedelta(days=RECENT_DAYS)).isoformat()

    def deal_stats(cids: set[str], grp: str | None = None) -> dict:
        ds = [d for d in deals if d["apt_seq"] in cids and (grp is None or d["grp"] == grp)]
        rec = [d for d in ds if d["deal_date"] >= recent_from]
        judged = [d for d in rec if d["pct"] is not None]
        out = {
            "n90": len(rec),
            "low90": sum(1 for d in rec if d["low"]),
            "stress90": round(sum(1 for d in judged if d["low"]) / len(judged), 3) if judged else None,
            "amtNow": to_eok(median(d["deal_amount"] for d in rec)) if rec else None,
        }
        # 월별 저가 비율 (최근 36개월)
        by_m: dict[str, list] = defaultdict(list)
        for d in ds:
            if d["pct"] is not None and d["deal_date"] >= (today - timedelta(days=30 * STRESS_MONTHS)).isoformat():
                by_m[d["deal_date"][:7]].append(d["low"])
        out["stress"] = [[m, len(v), round(sum(v) / len(v), 3)] for m, v in sorted(by_m.items())]
        return out

    # ── 역별 ─────────────────────────────────────────────
    stations_out = []
    for s in ALL_STATIONS:
        cids = {cid for cid, d in cx.items() if s.name in d["stations"]}
        entry = {
            "name": s.name, "line": LINE_OF[s.name], "sgg": s.sgg_cd,
            "lat": s.lat, "lng": s.lng, "complexes": len(cids), "groups": {},
        }
        for grp in SIZE_GROUPS:
            keys = [(c, grp) for c in cids if (c, grp) in series]
            ppa, vol = group_series(keys, series, months)
            m = series_metrics(ppa, vol, last_t)
            ds = deal_stats(cids, grp)
            m["nComplexes"] = len(keys)
            g_ppa = gangnam[grp][0]
            ratio = {t: ppa[t] / g_ppa[t] for t in months if t in ppa and t in g_ppa}
            rel_now = mean(ratio[t] for t in range(last_t - 2, last_t + 1) if t in ratio) if any(t in ratio for t in range(last_t - 2, last_t + 1)) else None
            rel_pct = pct_rank(list(ratio.values()), rel_now) if rel_now else None
            ll = lead_lag(ppa, g_ppa, last_t) if s.sgg_cd != GANGNAM_SGG else {"lag": 0, "corr": None}
            entry["groups"][grp] = {
                **m,
                # 표본이 적은 90일 실거래 중위는 흔들리므로 5건 이상일 때만 쓰고, 아니면 지수 환산
                "amtNow": ds["amtNow"] if ds["n90"] >= 5 else (to_eok(m["ppaNow"] * REP_AREA[grp] * C.PYEONG_PER_M2) if m.get("ppaNow") else None),
                "amtSrc": "deals" if ds["n90"] >= 5 else "index",
                "n90": ds["n90"], "low90": ds["low90"], "stress90": ds["stress90"],
                "relGangnam": round(rel_now, 3) if rel_now else None,
                "relPct": rel_pct,
                "relBand": [round(min(ratio.values()), 3), round(max(ratio.values()), 3)] if ratio else None,
                "lag": ll["lag"], "lagCorr": ll["corr"],
                "score": score(m, rel_pct, ds["stress90"]),
                "series": [[t - months[0], round(ppa[t]), vol.get(t, 0)] for t in months if t in ppa],
                "stress": ds["stress"],
            }
        stations_out.append(entry)

    # ── 관심 생활권 단지 (오리·죽전 1km) ───────────────────
    watch = []
    for cid, d in cx.items():
        if (d["watchDist"] or 1e9) > WATCH_RADIUS_M:
            continue
        row = {
            "id": cid, "name": d["apt_nm"], "umd": d["umd_nm"], "sgg": d["sgg_cd"],
            "builtYear": d["build_year"], "lat": d["lat"], "lng": d["lng"],
            "dist": round(d["watchDist"]), "stations": d["stations"], "groups": {},
        }
        for grp in SIZE_GROUPS:
            key = (cid, grp)
            if key not in series:
                continue
            ppa, vol = group_series([key], series)
            m = series_metrics(ppa, vol, last_t)
            ds = deal_stats({cid}, grp)
            my = [x for x in deals if x["apt_seq"] == cid and x["grp"] == grp]
            year = [x["deal_amount"] for x in my if x["deal_date"] >= (today - timedelta(days=365)).isoformat()]
            year.sort()
            band = None
            if len(year) >= 4:
                q = lambda p: year[min(len(year) - 1, int(p * (len(year) - 1)))]
                band = [to_eok(q(.25)), to_eok(q(.5)), to_eok(q(.75))]
            g_ppa = gangnam[grp][0]
            ratio = {t: ppa[t] / g_ppa[t] for t in months if t in ppa and t in g_ppa}
            rel_now = mean(ratio[t] for t in range(last_t - 5, last_t + 1) if t in ratio) if any(t in ratio for t in range(last_t - 5, last_t + 1)) else None
            rel_pct = pct_rank(list(ratio.values()), rel_now) if rel_now else None
            areas = sorted({round(x["excl_ar"], 1) for x in my})
            row["groups"][grp] = {
                **m,
                "amtNow": ds["amtNow"], "n90": ds["n90"], "low90": ds["low90"], "stress90": ds["stress90"],
                "band1y": band, "n1y": len(year),
                "relGangnam": round(rel_now, 3) if rel_now else None, "relPct": rel_pct,
                "areas": areas,
                "score": score(m, rel_pct, ds["stress90"]),
                "series": [[t - months[0], round(ppa[t]), vol.get(t, 0)] for t in months if t in ppa],
                "deals": [[x["deal_date"], x["excl_ar"], x["floor"], x["deal_amount"], x["pct"], 1 if x["dealing_gbn"] == "직거래" else 0]
                          for x in sorted(my, key=lambda x: x["deal_date"], reverse=True)[:40]],
            }
        if row["groups"]:
            watch.append(row)
    watch.sort(key=lambda r: r["dist"])

    # ── 역세권 전체 최근 저가 거래 (기회 피드) ───────────────
    opp = [
        [d["deal_date"], d["apt_seq"], cx[d["apt_seq"]]["apt_nm"], cx[d["apt_seq"]]["stations"],
         d["grp"], d["excl_ar"], d["floor"], d["deal_amount"], d["pct"]]
        for d in deals if d["low"] and d["deal_date"] >= recent_from and d["grp"] in SIZE_GROUPS
    ]
    opp.sort(key=lambda x: x[0], reverse=True)

    # ── 지도용 단지 점 (역세권 + 생활권, 59㎡대 기준) ────────
    points = []
    for cid in station_cids:
        d = cx[cid]
        pt = {"id": cid, "name": d["apt_nm"], "lat": d["lat"], "lng": d["lng"], "st": d["stations"], "builtYear": d["build_year"]}
        for grp in SIZE_GROUPS:
            key = (cid, grp)
            if key in series:
                ppa, vol = group_series([key], series)
                m = series_metrics(ppa, vol, last_t)
                ds = deal_stats({cid}, grp)
                pt[grp] = {"amtNow": ds["amtNow"], "chg1y": m.get("chg1y"), "drawdown": m.get("drawdown"), "n90": ds["n90"], "low90": ds["low90"]}
        points.append(pt)

    return {
        "v": 1,
        "today": today.isoformat(),
        "asOf": idx_to_ym(last_t),
        "seriesStart": idx_to_ym(months[0]),
        "sizeGroups": SIZE_GROUPS,
        "radiusM": STATION_RADIUS_M,
        "watch": {"centers": list(WATCH_CENTERS), "radiusM": WATCH_RADIUS_M, "complexes": watch},
        "gangnam": {grp: {"series": [[t - months[0], round(gangnam[grp][0][t]), gangnam[grp][1].get(t, 0)] for t in months if t in gangnam[grp][0]]} for grp in SIZE_GROUPS},
        "stations": stations_out,
        "opportunities": opp,
        "points": points,
        "scoreWeights": {"value": .30, "upside": .25, "momentum": .20, "volume": .15, "stress": .10},
    }


def main() -> int:
    conn = connect()
    data = build(conn)
    path = C.EXPORT_DIR / "insights.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    kb = path.stat().st_size // 1024
    print(f"역 {len(data['stations'])}개 · 관심 단지 {len(data['watch']['complexes'])}곳 · "
          f"지도 점 {len(data['points'])}개 · 저가 기회 {len(data['opportunities'])}건 → {path} ({kb}KB)")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
