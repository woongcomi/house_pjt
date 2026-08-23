/**
 * 지표 엔진 — pipeline/metrics.py 의 1:1 미러.
 *
 * 시작가/종료가를 '기간 내 첫/마지막 거래월'이 아니라 T0/T1 시점에 앵커한다.
 * 전자를 쓰면 단지마다 실제 비교 구간이 달라져(A는 4년, B는 1.5년) 랭킹이
 * 구조적으로 거짓이 된다. 대신 제한된 캐리포워드를 쓰고 노후도를 노출한다.
 */
import * as C from "./config";

export interface Series {
  /** 월 인덱스 (오름차순, 관측이 있는 달만) */
  t: number[];
  /** 만원/평 (전용면적 기준) */
  p: number[];
  /** 3개월 풀링 거래건수 */
  n: number[];
  /** 생애 총 거래 건수 */
  nLife: number;
}

export type AnchorMode = "exact" | "carry_forward" | "carry_backward";

export interface Anchor {
  value: number;
  at: number;
  staleness: number;
  mode: AnchorMode;
}

export type Confidence = "A" | "B" | "C";

export interface MetricResult {
  ok: boolean;
  reason: string;

  pStart: number;
  pEnd: number;
  tStart: number;
  tEnd: number;
  stalenessStart: number;
  stalenessEnd: number;
  modeStart: AnchorMode | "";
  modeEnd: AnchorMode | "";

  /** 기간 수익률 P_e/P_s − 1 */
  ret: number;
  /** 변동폭 P_max/P_min − 1 (시간 순서 무시) */
  volatility: number;

  cagr: number;
  /** 고점 대비 P_e/P_max − 1 (≤ 0) */
  drawdown: number;
  /** 저점 대비 P_e/P_min − 1 (≥ 0) */
  recovery: number;
  /** 최대 낙폭 (시간 순서 반영) */
  mdd: number;

  pMax: number;
  pMin: number;
  tMax: number;
  tMin: number;

  nObs: number;
  nTrades: number;
  confidence: Confidence;
  eligible: boolean;
}

export function ymToIdx(ym: string): number {
  const s = ym.replace(/-/g, "");
  return parseInt(s.slice(0, 4), 10) * 12 + parseInt(s.slice(4, 6), 10) - 1;
}

export function idxToYm(i: number): string {
  const y = Math.floor(i / 12);
  const m = (i % 12) + 1;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
}

function emptyResult(): MetricResult {
  return {
    ok: false, reason: "",
    pStart: 0, pEnd: 0, tStart: 0, tEnd: 0,
    stalenessStart: 0, stalenessEnd: 0, modeStart: "", modeEnd: "",
    ret: 0, volatility: 0, cagr: 0, drawdown: 0, recovery: 0, mdd: 0,
    pMax: 0, pMin: 0, tMax: 0, tMin: 0,
    nObs: 0, nTrades: 0, confidence: "C", eligible: false,
  };
}

/**
 * target 시점의 가격 추정치.
 * 1순위 정확 관측 → 2순위 이전 값 캐리포워드(최대 6개월)
 * → 3순위 이후 값 캐리백워드(최대 2개월).
 *
 * 캐리포워드를 더 길게 허용하는 이유: 이전 값은 'T 시점의 최선 추정치'로
 * 정당하지만 이후 값은 미래 정보를 끌어오는 것이라 보수적으로 제한한다.
 */
export function anchor(s: Series, target: number): Anchor | null {
  if (s.t.length === 0) return null;

  let before = -1;
  let after = -1;
  for (let i = 0; i < s.t.length; i++) {
    const ti = s.t[i];
    if (ti === target) return { value: s.p[i], at: ti, staleness: 0, mode: "exact" };
    if (ti < target) before = i;
    else { after = i; break; }
  }

  const cand: Anchor[] = [];
  if (before >= 0) {
    const gap = target - s.t[before];
    if (gap <= C.CARRY_FORWARD_MAX)
      cand.push({ value: s.p[before], at: s.t[before], staleness: gap, mode: "carry_forward" });
  }
  if (after >= 0) {
    const gap = s.t[after] - target;
    if (gap <= C.CARRY_BACKWARD_MAX)
      cand.push({ value: s.p[after], at: s.t[after], staleness: gap, mode: "carry_backward" });
  }

  if (cand.length === 0) return null;
  return cand.reduce((a, b) => (b.staleness < a.staleness ? b : a));
}

export function compute(s: Series, t0In: number, t1In: number): MetricResult {
  let t0 = t0In;
  let t1 = t1In;
  if (t1 < t0) { const tmp = t0; t0 = t1; t1 = tmp; }

  // 기간 내 실관측만 — 캐리포워드 값은 고점/저점 후보가 아니다
  const obsT: number[] = [];
  const obsP: number[] = [];
  const obsN: number[] = [];
  for (let i = 0; i < s.t.length; i++) {
    if (s.t[i] >= t0 && s.t[i] <= t1) {
      obsT.push(s.t[i]); obsP.push(s.p[i]); obsN.push(s.n[i]);
    }
  }

  const a0 = anchor(s, t0);
  const a1 = anchor(s, t1);

  const r = emptyResult();
  if (!a0 || !a1) { r.reason = "no_anchor"; r.nObs = obsT.length; return r; }
  if (obsT.length === 0) { r.reason = "no_observation"; return r; }

  r.ok = true;
  r.pStart = a0.value; r.tStart = a0.at;
  r.stalenessStart = a0.staleness; r.modeStart = a0.mode;
  r.pEnd = a1.value; r.tEnd = a1.at;
  r.stalenessEnd = a1.staleness; r.modeEnd = a1.mode;

  r.ret = a1.value / a0.value - 1;

  const months = Math.max(1, t1 - t0);
  if (months >= 24) r.cagr = Math.pow(a1.value / a0.value, 12 / months) - 1;

  // 동률이면 가장 이른 시점
  let iMax = 0;
  let iMin = 0;
  for (let i = 1; i < obsP.length; i++) {
    if (obsP[i] > obsP[iMax]) iMax = i;
    if (obsP[i] < obsP[iMin]) iMin = i;
  }
  r.pMax = obsP[iMax]; r.tMax = obsT[iMax];
  r.pMin = obsP[iMin]; r.tMin = obsT[iMin];

  r.volatility = r.pMax / r.pMin - 1;
  r.drawdown = a1.value / r.pMax - 1;
  r.recovery = a1.value / r.pMin - 1;

  // 최대 낙폭 — 시간 순서를 반영한 '진짜 위험'
  let peak = obsP[0];
  let mdd = 0;
  for (const pi of obsP) {
    if (pi > peak) peak = pi;
    const dd = pi / peak - 1;
    if (dd < mdd) mdd = dd;
  }
  r.mdd = mdd;

  r.nObs = obsT.length;
  r.nTrades = obsN.reduce((a, b) => a + b, 0);

  const worstStale = Math.max(a0.staleness, a1.staleness);
  r.eligible =
    r.nTrades >= C.RANK_MIN_PERIOD_TRADES &&
    r.nObs >= C.RANK_MIN_OBS_MONTHS &&
    worstStale <= C.RANK_MAX_STALENESS &&
    s.nLife >= C.RANK_MIN_LIFE_TRADES;

  if (
    r.nTrades >= C.CONF_A_TRADES &&
    r.nObs >= Math.max(3, Math.floor(months / 3)) &&
    worstStale <= C.CONF_A_STALENESS
  ) r.confidence = "A";
  else if (r.eligible) r.confidence = "B";
  else r.confidence = "C";

  return r;
}

export type MetricKey = "ret" | "volatility" | "drawdown" | "recovery" | "mdd" | "cagr";

export interface RankRow {
  rank: number;
  id: string;
  value: number;
  percentile: number;
}

/** 자격 있는 단지만 정렬. 동률은 동순위, 다음은 건너뜀 (1,2,2,4). */
export function rank(
  results: Array<[string, MetricResult]>,
  metric: MetricKey = "ret",
  descending = true,
): RankRow[] {
  const rows = results.filter(([, m]) => m.ok && m.eligible);
  rows.sort((a, b) => (descending ? b[1][metric] - a[1][metric] : a[1][metric] - b[1][metric]));

  const out: RankRow[] = [];
  let prevVal: number | null = null;
  let prevRank = 0;
  rows.forEach(([id, m], i) => {
    const value = m[metric];
    const cur = value === prevVal ? prevRank : i + 1;
    out.push({ rank: cur, id, value, percentile: rows.length ? (cur - 1) / rows.length : 0 });
    prevVal = value; prevRank = cur;
  });
  return out;
}
