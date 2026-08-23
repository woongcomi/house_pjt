"""지표 엔진 — 참조 구현.

web/lib/metrics.ts 가 이 파일을 1:1 미러링한다.
두 구현은 tests/fixtures/golden_metrics.json 으로 묶여 있으므로
로직을 바꿀 때는 반드시 골든 픽스처부터 갱신할 것.

핵심 설계 결정
──────────────
시작가/종료가를 '기간 내 첫/마지막 거래월'이 아니라 **T0/T1 시점에 앵커**한다.
전자를 쓰면 단지마다 실제 비교 구간이 달라져(A는 4년, B는 1.5년) 랭킹이
구조적으로 거짓이 된다. 대신 제한된 캐리포워드를 쓰고 그 노후도(staleness)를
그대로 노출한다.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Iterable

import config as C

# ── 월 인덱스 유틸 ─────────────────────────────────────
def ym_to_idx(ym: str) -> int:
    """'2021-03' 또는 '202103' -> 정수 월 인덱스"""
    s = ym.replace("-", "")
    return int(s[:4]) * 12 + int(s[4:6]) - 1


def idx_to_ym(i: int) -> str:
    return f"{i // 12:04d}-{i % 12 + 1:02d}"


# ── 입력 ───────────────────────────────────────────────
@dataclass
class Series:
    """한 단지(또는 단지×면적타입)의 믹스보정 지수 시계열.

    t[i] 는 월 인덱스, p[i] 는 만원/평(전용), n[i] 는 3개월 풀링 거래건수.
    t 는 오름차순, 실제 관측이 있는 달만 포함한다.
    """
    t: list[int]
    p: list[float]
    n: list[int]
    n_life: int = 0          # 생애 총 거래 건수

    def __post_init__(self):
        assert len(self.t) == len(self.p) == len(self.n)


@dataclass
class Anchor:
    value: float
    at: int              # 실제로 참조한 월 인덱스
    staleness: int       # |T - at|
    mode: str            # exact | carry_forward | carry_backward


@dataclass
class MetricResult:
    ok: bool
    reason: str = ""

    # 앵커
    p_start: float = 0.0
    p_end: float = 0.0
    t_start: int = 0
    t_end: int = 0
    staleness_start: int = 0
    staleness_end: int = 0
    mode_start: str = ""
    mode_end: str = ""

    # 사용자가 요청한 두 핵심 비율
    ret: float = 0.0          # 기간 수익률   P_e/P_s - 1
    volatility: float = 0.0   # 변동폭        P_max/P_min - 1

    # 보조 지표
    cagr: float = 0.0
    drawdown: float = 0.0     # 고점 대비     P_e/P_max - 1  (<= 0)
    recovery: float = 0.0     # 저점 대비     P_e/P_min - 1  (>= 0)
    mdd: float = 0.0          # 최대 낙폭 (시간 순서 반영)

    # 고점·저점
    p_max: float = 0.0
    p_min: float = 0.0
    t_max: int = 0
    t_min: int = 0

    # 표본
    n_obs: int = 0            # 기간 내 관측 월 수
    n_trades: int = 0         # 기간 내 거래 건수 (풀링 기준)
    confidence: str = "C"     # A | B | C
    eligible: bool = False    # 랭킹 진입 자격

    def to_dict(self):
        return asdict(self)


# ── 앵커 ───────────────────────────────────────────────
def anchor(s: Series, target: int) -> Anchor | None:
    """target 시점의 가격 추정치.

    1순위 정확 관측 → 2순위 이전 값 캐리포워드(최대 6개월)
    → 3순위 이후 값 캐리백워드(최대 2개월). 모두 실패하면 None.

    캐리포워드를 6개월까지 허용하고 캐리백워드는 2개월로 조인 이유:
    이전 값은 'T 시점의 최선 추정치'로 정당하지만, 이후 값은 미래 정보를
    끌어오는 것이라 보수적으로 제한한다.
    """
    if not s.t:
        return None

    before = after = None
    for i, ti in enumerate(s.t):
        if ti == target:
            return Anchor(s.p[i], ti, 0, "exact")
        if ti < target:
            before = i
        elif after is None:
            after = i
            break

    cand: list[Anchor] = []
    if before is not None:
        gap = target - s.t[before]
        if gap <= C.CARRY_FORWARD_MAX:
            cand.append(Anchor(s.p[before], s.t[before], gap, "carry_forward"))
    if after is not None:
        gap = s.t[after] - target
        if gap <= C.CARRY_BACKWARD_MAX:
            cand.append(Anchor(s.p[after], s.t[after], gap, "carry_backward"))

    if not cand:
        return None
    return min(cand, key=lambda a: a.staleness)


# ── 지표 계산 ──────────────────────────────────────────
def compute(s: Series, t0: int, t1: int) -> MetricResult:
    """기간 [t0, t1] 의 지표. t0/t1 은 월 인덱스."""
    if t1 < t0:
        t0, t1 = t1, t0

    # 기간 내 실관측만 (캐리포워드 값은 고점/저점 후보가 아니다)
    obs = [(ti, pi, ni) for ti, pi, ni in zip(s.t, s.p, s.n) if t0 <= ti <= t1]

    a0 = anchor(s, t0)
    a1 = anchor(s, t1)
    if a0 is None or a1 is None:
        return MetricResult(ok=False, reason="no_anchor", n_obs=len(obs))
    if not obs:
        return MetricResult(ok=False, reason="no_observation")

    r = MetricResult(ok=True)
    r.p_start, r.t_start, r.staleness_start, r.mode_start = (
        a0.value, a0.at, a0.staleness, a0.mode)
    r.p_end, r.t_end, r.staleness_end, r.mode_end = (
        a1.value, a1.at, a1.staleness, a1.mode)

    r.ret = a1.value / a0.value - 1.0

    months = max(1, t1 - t0)
    if months >= 24:
        r.cagr = (a1.value / a0.value) ** (12.0 / months) - 1.0

    # 고점·저점: 동률이면 가장 이른 시점
    i_max = max(range(len(obs)), key=lambda i: (obs[i][1], -obs[i][0]))
    i_min = min(range(len(obs)), key=lambda i: (obs[i][1], obs[i][0]))
    r.p_max, r.t_max = obs[i_max][1], obs[i_max][0]
    r.p_min, r.t_min = obs[i_min][1], obs[i_min][0]

    r.volatility = r.p_max / r.p_min - 1.0
    r.drawdown = a1.value / r.p_max - 1.0
    r.recovery = a1.value / r.p_min - 1.0

    # 최대 낙폭 — 시간 순서를 반영한 '진짜 위험'
    peak = obs[0][1]
    mdd = 0.0
    for _ti, pi, _ni in obs:
        peak = max(peak, pi)
        mdd = min(mdd, pi / peak - 1.0)
    r.mdd = mdd

    r.n_obs = len(obs)
    r.n_trades = sum(ni for _t, _p, ni in obs)

    worst_stale = max(a0.staleness, a1.staleness)
    r.eligible = (
        r.n_trades >= C.RANK_MIN_PERIOD_TRADES
        and r.n_obs >= C.RANK_MIN_OBS_MONTHS
        and worst_stale <= C.RANK_MAX_STALENESS
        and s.n_life >= C.RANK_MIN_LIFE_TRADES
    )

    if (r.n_trades >= C.CONF_A_TRADES
            and r.n_obs >= max(3, months // 3)
            and worst_stale <= C.CONF_A_STALENESS):
        r.confidence = "A"
    elif r.eligible:
        r.confidence = "B"
    else:
        r.confidence = "C"

    return r


def rank(
    results: Iterable[tuple[str, MetricResult]],
    metric: str = "ret",
    descending: bool = True,
) -> list[dict]:
    """자격 있는 단지만 정렬. 동률은 동순위(1,2,2,4)."""
    rows = [(cid, m) for cid, m in results if m.ok and m.eligible]
    rows.sort(key=lambda x: getattr(x[1], metric), reverse=descending)

    out: list[dict] = []
    prev_val = None
    prev_rank = 0
    for i, (cid, m) in enumerate(rows, start=1):
        val = getattr(m, metric)
        cur = prev_rank if val == prev_val else i
        out.append({
            "rank": cur,
            "id": cid,
            "value": val,
            "percentile": (cur - 1) / len(rows) if rows else 0.0,
        })
        prev_val, prev_rank = val, cur
    return out
