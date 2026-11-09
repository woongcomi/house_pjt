/**
 * pipeline/insights.py 산출물(insights.json)의 타입과 표시 유틸.
 * 역세권(역 반경 700m)·관심 생활권(오리·죽전 1km) 단지를 59㎡대/84㎡대 기준으로 비교한다.
 */
export type SizeKey = "S60" | "M85";

export interface Score {
  total: number;
  value: number;     // 강남 대비 비율의 10년 백분위 (낮을수록 ↑)
  upside: number;    // 고점 대비 낙폭 (클수록 ↑)
  momentum: number;  // 최근 3개월 vs 이전 9개월
  volume: number;    // 거래량 z
  stress: number;    // 저가 거래 비율
}

export interface GroupMetrics {
  ppaNow: number | null;
  chg1y: number | null;
  chg3y: number | null;
  peakYm: string | null;
  peakPpa: number | null;
  drawdown: number | null;
  troughYm: string | null;
  recovery: number | null;
  momentum: number | null;
  vol3m: number | null;
  volZ: number | null;
  nComplexes?: number;
  amtNow: number | null;            // 억
  amtSrc?: "deals" | "index";
  n90: number;
  low90: number;
  stress90: number | null;
  relGangnam: number | null;
  relPct: number | null;
  relBand?: [number, number] | null;
  lag?: number;
  lagCorr?: number | null;
  score: Score | null;
  /** [seriesStart 로부터 월 오프셋, 평당가(만원), 거래량] */
  series: [number, number, number][];
  /** [YYYY-MM, 판정 건수, 저가 비율] */
  stress?: [string, number, number][];
  band1y?: [number, number, number] | null;   // 1년 거래 p25/p50/p75 (억)
  n1y?: number;
  areas?: number[];
  /** [계약일, 전용㎡, 층, 금액(만원), 직전1년대비%, 직거래] */
  deals?: [string, number, number | null, number, number | null, 0 | 1][];
}

export interface StationInsight {
  name: string;
  line: "신분당선" | "분당선";
  sgg: string;
  lat: number;
  lng: number;
  complexes: number;
  groups: Record<SizeKey, GroupMetrics>;
}

export interface WatchComplex {
  id: string;
  name: string;
  umd: string;
  sgg: string;
  builtYear: number | null;
  lat: number;
  lng: number;
  dist: number;
  stations: string[];
  groups: Partial<Record<SizeKey, GroupMetrics>>;
}

export interface PointGroup {
  amtNow: number | null;
  chg1y: number | null;
  drawdown: number | null;
  n90: number;
  low90: number;
}

export interface InsightPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  st: string[];
  builtYear: number | null;
  S60?: PointGroup;
  M85?: PointGroup;
}

/** [계약일, 단지id, 단지명, 역[], 면적형, 전용㎡, 층, 금액(만원), 직전1년대비%] */
export type Opportunity = [string, string, string, string[], SizeKey, number, number | null, number, number];

export interface InsightsFile {
  v: number;
  today: string;
  asOf: string;          // 기준 월 (YYYY-MM)
  seriesStart: string;   // 시계열 시작 월
  sizeGroups: Record<SizeKey, string>;
  radiusM: number;
  watch: { centers: string[]; radiusM: number; complexes: WatchComplex[] };
  gangnam: Record<SizeKey, { series: [number, number, number][] }>;
  stations: StationInsight[];
  opportunities: Opportunity[];
  points: InsightPoint[];
  scoreWeights: Record<keyof Omit<Score, "total">, number>;
}

/* ── 표시 유틸 ─────────────────────────────────────── */

/** 11.0억 / 9.5억 */
export function eok(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  return `${v.toFixed(digits)}억`;
}

/** ▲ 12.3% / ▼ 4.0% / 0.0% */
export function pctArrow(r: number | null | undefined, digits = 1): string {
  if (r === null || r === undefined || !Number.isFinite(r)) return "–";
  const v = r * 100;
  if (Math.abs(v) < 0.05) return "0.0%";
  return `${v > 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(digits)}%`;
}

export function pctColor(r: number | null | undefined): string {
  if (r === null || r === undefined || !Number.isFinite(r) || Math.abs(r) < 0.0005) return "text-grey-600";
  return r > 0 ? "text-up-500" : "text-down-500";
}

/** 월 오프셋 → 'YY.MM' */
export function monthLabel(seriesStart: string, offset: number): string {
  const y = Number(seriesStart.slice(0, 4));
  const m = Number(seriesStart.slice(5, 7)) - 1 + offset;
  const yy = y + Math.floor(m / 12);
  const mm = (m % 12) + 1;
  return `${String(yy).slice(2)}.${String(mm).padStart(2, "0")}`;
}

export function monthFull(seriesStart: string, offset: number): string {
  const y = Number(seriesStart.slice(0, 4));
  const m = Number(seriesStart.slice(5, 7)) - 1 + offset;
  return `${y + Math.floor(m / 12)}년 ${(m % 12) + 1}월`;
}

/** 1년 변동률 → 지도·막대 색 (상승 빨강, 하락 파랑, 보합 회색) */
export function changeColor(r: number | null | undefined): string {
  if (r === null || r === undefined || !Number.isFinite(r)) return "#b0b8c1";
  if (r >= 0.25) return "#b81f2c";
  if (r >= 0.12) return "#f04452";
  if (r >= 0.03) return "#f5808a";
  if (r > -0.03) return "#8b95a1";
  if (r > -0.12) return "#7fb0f5";
  return "#1b64da";
}

export const LINE_ORDER = [
  "신사", "논현", "신논현", "강남", "양재", "양재시민의숲", "청계산입구",
  "판교", "정자", "미금", "동천", "수지구청", "성복", "상현", "광교중앙", "광교",
];
export const BUNDANG_ORDER = ["오리", "죽전"];
