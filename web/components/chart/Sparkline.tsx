"use client";

/**
 * 랭킹 행에 붙는 초소형 추세선. 라이브러리 없이 SVG 로 직접 그린다.
 * 리스트에 수백 개가 깔리므로 DOM 노드 수를 최소로 유지한다 (path 1개).
 */
export function Sparkline({
  values, width = 44, height = 18, up,
}: { values: number[]; width?: number; height?: number; up: boolean }) {
  if (values.length < 2) return <div style={{ width, height }} />;

  let min = values[0];
  let max = values[0];
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min || 1;
  const stepX = width / (values.length - 1);

  let d = "";
  for (let i = 0; i < values.length; i++) {
    const x = i * stepX;
    const y = height - ((values[i] - min) / span) * height;
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }

  return (
    <svg width={width} height={height} className="shrink-0 overflow-visible">
      <path
        d={d}
        fill="none"
        stroke={up ? "var(--color-up-500)" : "var(--color-down-500)"}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.85"
      />
    </svg>
  );
}
