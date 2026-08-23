/**
 * CSR(compressed sparse row) 시계열 디코더.
 *
 * export.py 가 만든 컬럼형 JSON을 Series 로 푼다.
 * 객체 배열 대신 컬럼형을 쓰는 이유는 키 반복이 사라져 gzip 후 3~4배 작아지기 때문이다.
 *
 *   off[i] .. off[i+1]  구간이 i번째 단지의 셀
 *   dt[]  는 이전 셀로부터의 월 델타 (각 단지의 첫 셀은 base 로부터)
 */
import type { Series } from "./metrics";

export interface RawBlock {
  v: number;
  base: number;
  ids: string[];
  off: number[];
  dt: number[];
  p: number[];
  n: number[];
  amt: number[];
}

export interface GuFile extends RawBlock {
  sgg: string;
  name: string;
  /** [단지명, 법정동, 건축년도, 생애거래건수, 위도, 경도] — 좌표 0 은 미확보 */
  meta: [string, string, number, number, number, number][];
}

export interface AreasFile extends RawBlock {
  sgg: string;
  /** [라벨, 대표전용면적, 거래건수] */
  labels: [string, number, number][];
}

export interface ComplexRow {
  id: string;
  name: string;
  dong: string;
  buildYear: number;
  series: Series;
  /** 대표 타입 환산 실금액 (만원), 시계열과 인덱스 정렬 */
  amount: number[];
  /** 지오코딩 좌표. 0 이면 아직 확보하지 못한 단지 */
  lat: number;
  lng: number;
}

/** CSR 블록에서 i번째 항목의 시계열을 뽑는다. */
export function sliceSeries(b: RawBlock, i: number, nLife: number): {
  series: Series;
  amount: number[];
} {
  const from = b.off[i];
  const to = b.off[i + 1];

  const t: number[] = new Array(to - from);
  const p: number[] = new Array(to - from);
  const n: number[] = new Array(to - from);
  const amount: number[] = new Array(to - from);

  let cur = b.base;
  for (let k = from; k < to; k++) {
    cur += b.dt[k];
    const j = k - from;
    t[j] = cur;
    p[j] = b.p[k];
    n[j] = b.n[k];
    amount[j] = b.amt[k];
  }
  return { series: { t, p, n, nLife }, amount };
}

export function decodeGu(f: GuFile): ComplexRow[] {
  const out: ComplexRow[] = new Array(f.ids.length);
  for (let i = 0; i < f.ids.length; i++) {
    const [name, dong, buildYear, nLife, lat, lng] = f.meta[i];
    const { series, amount } = sliceSeries(f, i, nLife);
    out[i] = { id: f.ids[i], name, dong, buildYear, series, amount, lat, lng };
  }
  return out;
}

export interface AreaRow {
  /** '11680-280/0' */
  key: string;
  complexId: string;
  bucketId: number;
  label: string;
  areaM2: number;
  nTrades: number;
  series: Series;
  amount: number[];
}

export function decodeAreas(f: AreasFile): Map<string, AreaRow[]> {
  const byComplex = new Map<string, AreaRow[]>();
  for (let i = 0; i < f.ids.length; i++) {
    const key = f.ids[i];
    const slash = key.lastIndexOf("/");
    const complexId = key.slice(0, slash);
    const bucketId = Number(key.slice(slash + 1));
    const [label, areaM2, nTrades] = f.labels[i];
    const { series, amount } = sliceSeries(f, i, nTrades);

    const row: AreaRow = { key, complexId, bucketId, label, areaM2, nTrades, series, amount };
    const arr = byComplex.get(complexId);
    if (arr) arr.push(row);
    else byComplex.set(complexId, [row]);
  }
  // 면적 오름차순 — 토글에서 59㎡, 84㎡, 114㎡ 순으로 보이게
  for (const arr of byComplex.values()) arr.sort((a, b) => a.areaM2 - b.areaM2);
  return byComplex;
}

/** 시계열에서 특정 월 인덱스의 값을 찾는다 (없으면 -1) */
export function indexOfMonth(s: Series, t: number): number {
  let lo = 0;
  let hi = s.t.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s.t[mid] === t) return mid;
    if (s.t[mid] < t) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
