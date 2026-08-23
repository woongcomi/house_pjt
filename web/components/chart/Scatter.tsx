"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface ScatterPoint {
  x: number;
  y: number;
  id: string;
  label: string;
}

/**
 * 변동폭(X) × 수익률(Y) 산점도.
 *
 * 사분면 해석이 핵심이다.
 *   왼쪽 위 = 안 흔들리고 오른 곳   (조용한 상승)
 *   오른쪽 위 = 크게 흔들리며 오른 곳 (롤러코스터)
 *   아래쪽 = 결국 내린 곳
 * 축 눈금보다 이 구분선과 라벨이 훨씬 많은 걸 설명한다.
 */
export function Scatter({
  points, height = 260, onSelect,
}: {
  points: ScatterPoint[];
  height?: number;
  onSelect?: (id: string) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(340);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width);
      if (w > 0) setW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = height;
  const PAD = { top: 14, right: 12, bottom: 26, left: 12 };

  const view = useMemo(() => {
    if (points.length === 0) return null;
    const xs = points.map((p) => p.x).sort((a, b) => a - b);
    const ys = points.map((p) => p.y).sort((a, b) => a - b);
    const q = (arr: number[], f: number) => arr[Math.floor(arr.length * f)];

    // 극단값이 전체를 눌러버리지 않도록 1~99% 구간으로 스케일
    const x0 = Math.min(0, q(xs, 0.01));
    const x1 = q(xs, 0.99);
    const y0 = Math.min(q(ys, 0.01), 0);
    const y1 = Math.max(q(ys, 0.99), 0);

    const sx = (v: number) =>
      PAD.left + ((Math.max(x0, Math.min(v, x1)) - x0) / (x1 - x0 || 1)) * (W - PAD.left - PAD.right);
    const sy = (v: number) =>
      PAD.top +
      (1 - (Math.max(y0, Math.min(v, y1)) - y0) / (y1 - y0 || 1)) * (H - PAD.top - PAD.bottom);

    return { sx, sy, x0, x1, y0, y1, zeroY: sy(0), midX: sx((x0 + x1) / 2) };
  }, [points, W, H]);

  if (!view) return null;

  return (
    <div ref={boxRef} className="w-full">
      <svg width={W} height={H}>
        {/* 수익률 0% 선 — 위는 오른 곳, 아래는 내린 곳 */}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={view.zeroY}
          y2={view.zeroY}
          stroke="var(--color-grey-300)"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
        <text
          x={PAD.left + 2}
          y={view.zeroY - 4}
          style={{ fontSize: 10, fontWeight: 600, fill: "var(--color-grey-600)" }}
        >
          0%
        </text>

        {points.map((p) => {
          const up = p.y >= 0;
          return (
            <circle
              key={p.id}
              cx={view.sx(p.x)}
              cy={view.sy(p.y)}
              r="3.2"
              fill={up ? "var(--color-up-500)" : "var(--color-down-500)"}
              fillOpacity="0.5"
              onClick={onSelect ? () => onSelect(p.id) : undefined}
              style={onSelect ? { cursor: "pointer" } : undefined}
            />
          );
        })}

        <text
          x={PAD.left}
          y={H - 6}
          style={{ fontSize: 11, fontWeight: 600, fill: "var(--color-grey-700)" }}
        >
          덜 흔들림
        </text>
        <text
          x={W - PAD.right}
          y={H - 6}
          textAnchor="end"
          style={{ fontSize: 11, fontWeight: 600, fill: "var(--color-grey-700)" }}
        >
          많이 흔들림 →
        </text>
      </svg>
    </div>
  );
}
