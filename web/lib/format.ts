/**
 * 한국식 숫자 표기.
 *
 * 평당가는 **전용면적 기준**이다. 시중(네이버부동산 등)의 평당가는 대개
 * 공급면적 기준이라 우리 숫자가 약 30% 높게 보인다. 화면에서 '전용' 을
 * 빼먹으면 사용자가 데이터를 의심하므로 라벨을 함께 쓰는 헬퍼를 둔다.
 */

/** 12억 4,000 / 9,800만 */
export function formatAmount(manwon: number): string {
  if (!Number.isFinite(manwon) || manwon <= 0) return "-";
  const eok = Math.floor(manwon / 10000);
  const rest = Math.round(manwon % 10000);
  if (eok === 0) return `${rest.toLocaleString()}만`;
  if (rest === 0) return `${eok}억`;
  return `${eok}억 ${rest.toLocaleString()}`;
}

/** 30.4억 — 차트 축처럼 좁은 곳에서 */
export function formatEok(manwon: number, digits = 1): string {
  if (!Number.isFinite(manwon) || manwon <= 0) return "-";
  return `${(manwon / 10000).toFixed(digits)}억`;
}

/** 8,913만 (만원/평) */
export function formatPpa(manwonPerPyeong: number): string {
  if (!Number.isFinite(manwonPerPyeong) || manwonPerPyeong <= 0) return "-";
  return `${Math.round(manwonPerPyeong).toLocaleString()}만`;
}

/** +32.4% / -9.4% — 부호를 항상 붙인다 */
export function formatPct(ratio: number, digits = 1): string {
  if (!Number.isFinite(ratio)) return "-";
  const v = ratio * 100;
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

/** 부호 없는 폭 (변동폭처럼 방향이 무의미한 값) */
export function formatPctAbs(ratio: number, digits = 1): string {
  if (!Number.isFinite(ratio)) return "-";
  return `${Math.abs(ratio * 100).toFixed(digits)}%`;
}

/** 상승/하락/보합 색상 — 한국 관행 (상승 빨강) */
export function trendColor(ratio: number): string {
  if (!Number.isFinite(ratio) || Math.abs(ratio) < 0.0005) return "text-grey-600";
  return ratio > 0 ? "text-up-500" : "text-down-500";
}

/** 월 인덱스 → '2021년 10월' */
export function formatMonth(idx: number): string {
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${y}년 ${m}월`;
}

/** 월 인덱스 → '21.10' (좁은 곳) */
export function formatMonthShort(idx: number): string {
  const y = Math.floor(idx / 12) % 100;
  const m = (idx % 12) + 1;
  return `${String(y).padStart(2, "0")}.${String(m).padStart(2, "0")}`;
}

/** 기간 길이를 사람 말로 — '3년 6개월' */
export function formatDuration(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m}개월`;
  if (m === 0) return `${y}년`;
  return `${y}년 ${m}개월`;
}

/** 순위 백분위 → '상위 1.5%' */
export function formatPercentile(p: number): string {
  const v = p * 100;
  return `상위 ${v < 1 ? v.toFixed(1) : Math.round(v)}%`;
}

/** ㎡ → 전용 평 (표시용) */
export function toPyeong(m2: number): number {
  return m2 / 3.305785;
}

/**
 * ▲ 32.4% / ▼ 9.4% — 색만으로는 색약 사용자가 구분하기 어렵고,
 * 화살표가 있으면 방향이 즉시 읽힌다.
 */
export function formatPctArrow(ratio: number, digits = 1): string {
  if (!Number.isFinite(ratio)) return "-";
  const v = ratio * 100;
  if (Math.abs(v) < 0.05) return `0.0%`;
  return `${v > 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(digits)}%`;
}
