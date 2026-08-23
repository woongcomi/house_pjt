/**
 * 정적 데이터 로더.
 *
 * 구 단위 파일 하나가 gzip 후 수십~수백 KB 라 CDN 캐시가 잘 듣는다.
 * 같은 구를 다시 열 때 네트워크를 타지 않도록 메모리에도 캐시한다.
 */
import { decodeAreas, decodeGu, type AreaRow, type AreasFile, type ComplexRow, type GuFile } from "./series";

export interface Meta {
  v: number;
  base: number;
  startYm: string;
  lastYm: string;
  complexes: number;
  trades: number;
  gu: Record<string, { name: string; complexes: number; cells: number }>;
  builtAt: string | null;
  collectedAt: string | null;
  note: string;
}

export interface RegionFile {
  v: number;
  base: number;
  region: Record<string, { t: number[]; p: number[]; n: number[] }>;
}

export interface SearchFile {
  v: number;
  /** [id, 단지명, 법정동, 시군구코드] */
  items: [string, string, string, string][];
}

const BASE = "/data";
const cache = new Map<string, Promise<unknown>>();

function load<T>(path: string): Promise<T> {
  let p = cache.get(path) as Promise<T> | undefined;
  if (!p) {
    p = fetch(`${BASE}/${path}`).then((r) => {
      if (!r.ok) throw new Error(`${path} 로드 실패 (${r.status})`);
      return r.json() as Promise<T>;
    });
    cache.set(path, p as Promise<unknown>);
  }
  return p;
}

export const loadMeta = () => load<Meta>("meta.json");
export const loadSearch = () => load<SearchFile>("search.json");
export const loadRegion = () => load<RegionFile>("region.json");

const guCache = new Map<string, Promise<ComplexRow[]>>();
export function loadGu(sgg: string): Promise<ComplexRow[]> {
  let p = guCache.get(sgg);
  if (!p) {
    p = load<GuFile>(`gu/${sgg}.json`).then(decodeGu);
    guCache.set(sgg, p);
  }
  return p;
}

const areaCache = new Map<string, Promise<Map<string, AreaRow[]>>>();
export function loadAreas(sgg: string): Promise<Map<string, AreaRow[]>> {
  let p = areaCache.get(sgg);
  if (!p) {
    p = load<AreasFile>(`gu/${sgg}.areas.json`).then(decodeAreas);
    areaCache.set(sgg, p);
  }
  return p;
}

/** 단지 상세로 들어갈 것 같으면 미리 당겨둔다 (토글이 즉시 반응하도록) */
export function prefetchAreas(sgg: string): void {
  void loadAreas(sgg).catch(() => {});
}
