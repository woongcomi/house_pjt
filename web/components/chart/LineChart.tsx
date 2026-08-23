"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatMonthShort, formatPpa } from "@/lib/format";

export interface ChartPoint {
  t: number;
  p: number;
  n: number;
}

/**
 * 단지 시세 라인차트. 라이브러리 없이 SVG 로 직접 그린다.
 *
 * 토스 미감은 매우 특정적이라 recharts/chart.js 를 쓰면 스타일을 되돌리는
 * 싸움이 되고 번들도 100KB 넘게 늘어난다. 필요한 건 선 하나와 마커 몇 개뿐이다.
 *
 * viewBox 를 고정하고 늘리는 대신 컨테이너 폭을 실측해 픽셀 좌표로 그린다.
 * viewBox + preserveAspectRatio="none" 은 글자까지 가로로 늘려버린다.
 *
 * 거래가 끊긴 구간은 점선으로 잇는다. 거래가 없던 달을 실선으로 이으면
 * 그 사이에도 시세가 있었던 것처럼 보인다.
 */
export function LineChart({
  points, t0, t1, tMax, tMin, height = 200,
}: {
  points: ChartPoint[];
  t0: number;
  t1: number;
  tMax?: number;
  tMin?: number;
  height?: number;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(340);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = height;
  const PAD = { top: 26, right: 10, bottom: 24, left: 10 };

  const view = useMemo(() => {
    const inRange = points.filter((p) => p.t >= t0 && p.t <= t1);
    if (inRange.length === 0) return null;

    let min = inRange[0].p;
    let max = inRange[0].p;
    for (const p of inRange) {
      if (p.p < min) min = p.p;
      if (p.p > max) max = p.p;
    }
    const pad = (max - min) * 0.22 || max * 0.08 || 1;
    min -= pad;
    max += pad;

    const spanT = Math.max(1, t1 - t0);
    const spanP = max - min || 1;
    const x = (t: number) => PAD.left + ((t - t0) / spanT) * (W - PAD.left - PAD.right);
    const y = (p: number) => PAD.top + (1 - (p - min) / spanP) * (H - PAD.top - PAD.bottom);

    // 4개월 넘게 거래가 끊기면 실선을 끊는다
    const segments: ChartPoint[][] = [];
    let cur: ChartPoint[] = [];
    for (let i = 0; i < inRange.length; i++) {
      if (i > 0 && inRange[i].t - inRange[i - 1].t > 4) {
        if (cur.length) segments.push(cur);
        cur = [];
      }
      cur.push(inRange[i]);
    }
    if (cur.length) segments.push(cur);

    const line = (seg: ChartPoint[]) =>
      seg.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.p).toFixed(1)}`).join(" ");

    const gaps: string[] = [];
    for (let i = 1; i < segments.length; i++) {
      const a = segments[i - 1][segments[i - 1].length - 1];
      const b = segments[i][0];
      gaps.push(
        `M${x(a.t).toFixed(1)},${y(a.p).toFixed(1)} L${x(b.t).toFixed(1)},${y(b.p).toFixed(1)}`,
      );
    }

    const areaPath =
      inRange.length > 1
        ? `${inRange
            .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.p).toFixed(1)}`)
            .join(" ")} L${x(inRange[inRange.length - 1].t).toFixed(1)},${(H - PAD.bottom).toFixed(
            1,
          )} L${x(inRange[0].t).toFixed(1)},${(H - PAD.bottom).toFixed(1)} Z`
        : null;

    const first = inRange[0];
    const last = inRange[inRange.length - 1];

    const at = (t?: number) => {
      if (t === undefined) return null;
      const f = inRange.find((p) => p.t === t);
      return f ? { x: x(f.t), y: y(f.p), p: f.p } : null;
    };

    return {
      segments, line, gaps, areaPath,
      up: last.p >= first.p,
      start: { x: x(first.t), y: y(first.p) },
      end: { x: x(last.t), y: y(last.p) },
      peak: at(tMax),
      trough: at(tMin),
      baseline: H - PAD.bottom,
    };
  }, [points, t0, t1, tMax, tMin, W, H]);

  return (
    <div ref={boxRef} className="w-full">
      {!view ? (
        <div
          style={{ height: H }}
          className="flex items-center justify-center rounded-[14px] bg-grey-50 text-[13px] font-medium text-grey-700"
        >
          이 기간엔 거래가 없어요
        </div>
      ) : (
        <svg width={W} height={H} role="img" aria-label="기간 내 시세 추이">
          <defs>
            <linearGradient id="lc-fill" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor={view.up ? "var(--color-up-500)" : "var(--color-down-500)"}
                stopOpacity="0.22"
              />
              <stop
                offset="100%"
                stopColor={view.up ? "var(--color-up-500)" : "var(--color-down-500)"}
                stopOpacity="0"
              />
            </linearGradient>
          </defs>

          {view.areaPath && <path d={view.areaPath} fill="url(#lc-fill)" />}

          {view.gaps.map((d, i) => (
            <path
              key={`g${i}`}
              d={d}
              fill="none"
              stroke={view.up ? "var(--color-up-500)" : "var(--color-down-500)"}
              strokeWidth="1.8"
              strokeDasharray="4 5"
              opacity="0.5"
            />
          ))}

          {view.segments.map((seg, i) => (
            <path
              key={`s${i}`}
              d={view.line(seg)}
              fill="none"
              stroke={view.up ? "var(--color-up-500)" : "var(--color-down-500)"}
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          <Dot {...view.start} color={view.up ? "var(--color-up-500)" : "var(--color-down-500)"} hollow />
          <Dot {...view.end} color={view.up ? "var(--color-up-500)" : "var(--color-down-500)"} />

          {view.peak && (
            <>
              <Dot x={view.peak.x} y={view.peak.y} color="var(--color-up-500)" />
              <Label
                x={view.peak.x}
                y={Math.max(13, view.peak.y - 12)}
                text={`최고 ${formatPpa(view.peak.p)}`}
                color="var(--color-up-600)"
                W={W}
              />
            </>
          )}

          {view.trough && (
            <>
              <Dot x={view.trough.x} y={view.trough.y} color="var(--color-down-500)" />
              <Label
                x={view.trough.x}
                y={Math.min(view.baseline + 1, view.trough.y + 20)}
                text={`최저 ${formatPpa(view.trough.p)}`}
                color="var(--color-down-600)"
                W={W}
              />
            </>
          )}

          <text
            x={PAD.left}
            y={H - 6}
            style={{ fontSize: 11, fontWeight: 600, fill: "var(--color-grey-700)" }}
          >
            {formatMonthShort(t0)}
          </text>
          <text
            x={W - PAD.right}
            y={H - 6}
            textAnchor="end"
            style={{ fontSize: 11, fontWeight: 600, fill: "var(--color-grey-700)" }}
          >
            {formatMonthShort(t1)}
          </text>
        </svg>
      )}
    </div>
  );
}

function Dot({
  x, y, color, hollow,
}: { x: number; y: number; color: string; hollow?: boolean }) {
  return (
    <>
      <circle cx={x} cy={y} r="5.5" fill="white" />
      <circle cx={x} cy={y} r="3.6" fill={hollow ? "white" : color} stroke={color} strokeWidth="2" />
    </>
  );
}

function Label({
  x, y, text, color, W,
}: { x: number; y: number; text: string; color: string; W: number }) {
  const cx = Math.max(46, Math.min(W - 46, x));
  return (
    <text x={cx} y={y} textAnchor="middle" style={{ fontSize: 11, fontWeight: 700, fill: color }}>
      {text}
    </text>
  );
}
