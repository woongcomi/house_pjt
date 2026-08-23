/**
 * TS 지표 엔진 골든 테스트.
 *
 * pipeline/tests/test_metrics.py 와 **같은** golden_metrics.json 을 로드한다.
 * 이 파일이 Python 구현과 TS 구현을 묶는 유일한 계약이다.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compute, rank, ymToIdx, idxToYm, type Series, type MetricResult } from "../lib/metrics";
import * as C from "../lib/config";

const GOLDEN = JSON.parse(
  readFileSync(resolve(__dirname, "../../pipeline/tests/fixtures/golden_metrics.json"), "utf-8"),
);
const TOL = GOLDEN.tolerance as number;

/** 픽스처는 Python 쪽 snake_case 를 쓴다. */
const KEY_MAP: Record<string, keyof MetricResult> = {
  ok: "ok", reason: "reason",
  p_start: "pStart", p_end: "pEnd", t_start: "tStart", t_end: "tEnd",
  staleness_start: "stalenessStart", staleness_end: "stalenessEnd",
  mode_start: "modeStart", mode_end: "modeEnd",
  ret: "ret", volatility: "volatility", cagr: "cagr",
  drawdown: "drawdown", recovery: "recovery", mdd: "mdd",
  p_max: "pMax", p_min: "pMin", t_max: "tMax", t_min: "tMin",
  n_obs: "nObs", n_trades: "nTrades",
  confidence: "confidence", eligible: "eligible",
};

function toSeries(s: { t: number[]; p: number[]; n: number[]; n_life: number }): Series {
  return { t: s.t, p: s.p, n: s.n, nLife: s.n_life };
}

describe("골든 케이스 (Python 구현과 동일해야 함)", () => {
  for (const c of GOLDEN.cases) {
    it(c.name, () => {
      const got = compute(toSeries(c.series), c.t0, c.t1) as unknown as Record<string, unknown>;
      for (const [pyKey, expected] of Object.entries(c.expect)) {
        const tsKey = KEY_MAP[pyKey];
        expect(tsKey, `픽스처 키 '${pyKey}' 가 TS 필드에 매핑되지 않음`).toBeDefined();
        const actual = got[tsKey];
        if (typeof expected === "number" && !Number.isInteger(expected)) {
          expect(actual as number, `${c.name}.${pyKey}`).toBeCloseTo(expected, 9);
        } else {
          expect(actual, `${c.name}.${pyKey}`).toBe(expected);
        }
      }
    });
  }
});

describe("픽스처 상수가 config.ts 와 일치", () => {
  it("두 구현의 임계값이 갈라지면 골든 테스트가 무의미해진다", () => {
    const cfg = GOLDEN.config as Record<string, number>;
    const actual = C as unknown as Record<string, number>;
    for (const [k, v] of Object.entries(cfg)) {
      expect(actual[k], `config.${k}`).toBe(v);
    }
  });
});

describe("월 인덱스", () => {
  it("왕복 변환", () => {
    for (const ym of ["2006-01", "2021-10", "2026-12"]) {
      expect(idxToYm(ymToIdx(ym))).toBe(ym);
    }
  });
  it("구분자 유무 무관", () => {
    expect(ymToIdx("202103")).toBe(ymToIdx("2021-03"));
  });
  it("연말·연초 경계", () => {
    expect(ymToIdx("2022-01") - ymToIdx("2021-12")).toBe(1);
  });
});

describe("랭킹", () => {
  const mk = (ret: number): [string, MetricResult] => {
    const s: Series = {
      t: [0, 12, 24],
      p: [1000, 1000 * (1 + ret / 2), 1000 * (1 + ret)],
      n: [5, 5, 5], nLife: 50,
    };
    return ["x", compute(s, 0, 24)];
  };

  it("동률은 동순위, 다음은 건너뜀 (1,2,2,4)", () => {
    const rows = rank([
      ["a", mk(0.3)[1]], ["b", mk(0.2)[1]], ["c", mk(0.2)[1]], ["d", mk(0.1)[1]],
    ]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("표본 부족 단지는 상위권을 차지할 수 없다", () => {
    const thin = compute({ t: [0, 12, 24], p: [1000, 1200, 1500], n: [1, 1, 1], nLife: 50 }, 0, 24);
    const thick = compute({ t: [0, 12, 24], p: [1000, 1050, 1100], n: [8, 8, 8], nLife: 50 }, 0, 24);
    expect(rank([["thin", thin], ["thick", thick]]).map((r) => r.id)).toEqual(["thick"]);
  });
});

describe("변동폭과 최대낙폭의 차이", () => {
  it("V는 시간 순서를 무시하지만 MDD는 반영한다", () => {
    const rise = compute({ t: [0, 12, 24], p: [1000, 1400, 1500], n: [6, 6, 6], nLife: 50 }, 0, 24);
    const fall = compute({ t: [0, 12, 24], p: [1500, 1400, 1000], n: [6, 6, 6], nLife: 50 }, 0, 24);
    expect(rise.volatility).toBeCloseTo(fall.volatility, 9);  // 둘 다 +50%
    expect(rise.mdd).toBeCloseTo(0, 9);                        // 상승장은 낙폭 없음
    expect(fall.mdd).toBeCloseTo(-1 / 3, 9);                   // 하락장은 -33%
  });
});

describe("앵커 경계", () => {
  it("캐리포워드 한계", () => {
    const s: Series = { t: [0], p: [1000], n: [5], nLife: 50 };
    expect(compute(s, 0, C.CARRY_FORWARD_MAX).ok).toBe(true);
    expect(compute(s, 0, C.CARRY_FORWARD_MAX + 1).ok).toBe(false);
  });
  it("캐리백워드 한계", () => {
    const s: Series = { t: [10], p: [1000], n: [5], nLife: 50 };
    expect(compute(s, 10 - C.CARRY_BACKWARD_MAX, 10).ok).toBe(true);
    expect(compute(s, 10 - C.CARRY_BACKWARD_MAX - 1, 10).ok).toBe(false);
  });
});
