/**
 * 기간 선택 상태와 프리셋.
 * 선택은 URL 쿼리에 실려 링크 공유가 가능하다.
 */
import { ymToIdx, idxToYm } from "./metrics";

export interface Period {
  /** 시작 월 인덱스 */
  t0: number;
  /** 종료 월 인덱스 */
  t1: number;
}

export interface Preset {
  key: string;
  label: string;
  /** 데이터 마지막 월을 받아 기간을 만든다 */
  make: (last: number, first: number) => Period;
}

export const PRESETS: Preset[] = [
  { key: "1y", label: "1년", make: (l) => ({ t0: l - 12, t1: l }) },
  { key: "3y", label: "3년", make: (l) => ({ t0: l - 36, t1: l }) },
  { key: "5y", label: "5년", make: (l) => ({ t0: l - 60, t1: l }) },
  { key: "10y", label: "10년", make: (l) => ({ t0: l - 120, t1: l }) },
  {
    key: "peak",
    label: "2021 고점 이후",
    make: (l) => ({ t0: ymToIdx("2021-10"), t1: l }),
  },
  {
    key: "covid",
    label: "2020 이후",
    make: (l) => ({ t0: ymToIdx("2020-01"), t1: l }),
  },
  { key: "all", label: "전체", make: (l, f) => ({ t0: f, t1: l }) },
];

export function periodToQuery(p: Period): string {
  return `from=${idxToYm(p.t0).replace("-", "")}&to=${idxToYm(p.t1).replace("-", "")}`;
}

export function parsePeriod(
  from: string | null,
  to: string | null,
  fallback: Period,
): Period {
  if (!from || !to) return fallback;
  if (!/^\d{6}$/.test(from) || !/^\d{6}$/.test(to)) return fallback;
  const t0 = ymToIdx(from);
  const t1 = ymToIdx(to);
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) return fallback;
  return { t0, t1 };
}

/** 프리셋 중 현재 기간과 일치하는 것을 찾는다 (칩 활성 표시용) */
export function matchPreset(p: Period, last: number, first: number): string | null {
  for (const preset of PRESETS) {
    const q = preset.make(last, first);
    if (q.t0 === p.t0 && q.t1 === p.t1) return preset.key;
  }
  return null;
}
