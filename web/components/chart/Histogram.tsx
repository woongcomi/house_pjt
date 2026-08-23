"use client";

import { useMemo } from "react";

/**
 * 수익률 분포 히스토그램.
 * '내 단지는 상위 몇 %인가' 를 감각으로 알려주는 게 목적이라
 * 축 눈금보다 0% 기준선과 중앙값 표시가 중요하다.
 */
export function Histogram({
  values, bins = 24, height = 140, markerValue, markerLabel,
}: {
  values: number[];
  bins?: number;
  height?: number;
  markerValue?: number;
  markerLabel?: string;
}) {
  const view = useMemo(() => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    // 양 끝 2%는 잘라야 극단값 하나 때문에 전체가 눌리지 않는다
    const lo = sorted[Math.floor(sorted.length * 0.02)];
    const hi = sorted[Math.floor(sorted.length * 0.98)];
    const min = Math.min(lo, 0);
    const max = Math.max(hi, 0);
    const span = max - min || 1;

    const counts = new Array(bins).fill(0);
    for (const v of values) {
      const i = Math.max(0, Math.min(bins - 1, Math.floor(((v - min) / span) * bins)));
      counts[i]++;
    }
    const peak = Math.max(...counts) || 1;
    const median = sorted[Math.floor(sorted.length / 2)];
    const zeroAt = ((0 - min) / span) * 100;

    return { counts, peak, min, max, span, median, zeroAt, n: values.length };
  }, [values, bins]);

  if (!view) return null;

  const pctOf = (v: number) => ((v - view.min) / view.span) * 100;

  return (
    <div>
      <div className="relative flex items-end gap-[2px]" style={{ height }}>
        {/* 0% 기준선 — 오른쪽이 오른 단지, 왼쪽이 내린 단지 */}
        <div
          className="absolute bottom-0 top-0 z-10 w-px bg-grey-400"
          style={{ left: `${view.zeroAt}%` }}
        />
        {view.counts.map((c, i) => {
          const center = view.min + ((i + 0.5) / view.counts.length) * view.span;
          return (
            <div
              key={i}
              className={`flex-1 rounded-t-[2px] ${
                center >= 0 ? "bg-up-500/75" : "bg-down-500/75"
              }`}
              style={{ height: `${Math.max(2, (c / view.peak) * 100)}%` }}
            />
          );
        })}

        {markerValue !== undefined && (
          <div
            className="absolute bottom-0 top-0 z-20 w-[2px] bg-grey-900"
            style={{ left: `${Math.max(0, Math.min(100, pctOf(markerValue)))}%` }}
          />
        )}
      </div>

      <div className="mt-2 flex justify-between text-[11px] font-medium text-grey-700">
        <span>{Math.round(view.min * 100)}%</span>
        <span className="text-grey-800">
          중앙 {view.median > 0 ? "+" : ""}
          {(view.median * 100).toFixed(0)}%
        </span>
        <span>+{Math.round(view.max * 100)}%</span>
      </div>
      {markerLabel && (
        <div className="mt-1 text-center text-[11px] font-bold text-grey-900">{markerLabel}</div>
      )}
    </div>
  );
}
