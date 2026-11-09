"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, ScatterChart, CustomChart } from "echarts/charts";
import {
  GridComponent, TooltipComponent, LegendComponent, MarkLineComponent,
  MarkAreaComponent, MarkPointComponent, DataZoomComponent, GraphicComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption, ECharts } from "echarts/core";

echarts.use([
  BarChart, LineChart, ScatterChart, CustomChart,
  GridComponent, TooltipComponent, LegendComponent, MarkLineComponent,
  MarkAreaComponent, MarkPointComponent, DataZoomComponent, GraphicComponent,
  CanvasRenderer,
]);

/** 차트 공통 톤 — 헤어라인 격자, 회색 축, 시스템 서체. 각 차트는 이 위에 데이터만 얹는다. */
export const CHART_TEXT = "#4e5968";
export const CHART_MUTED = "#8b95a1";
export const CHART_GRID = "#e5e8eb";
export const CHART_AXIS = "#d1d6db";
export const CHART_FONT = '"Pretendard Variable", Pretendard, system-ui, sans-serif';

export const tooltipStyle = {
  backgroundColor: "#ffffff",
  borderColor: "#e5e8eb",
  borderWidth: 1,
  padding: [8, 12],
  textStyle: { color: "#191f28", fontSize: 12, fontFamily: CHART_FONT },
  extraCssText: "box-shadow:0 6px 20px rgba(0,0,0,.08);border-radius:10px;",
};

export function EChart({
  option, height = 280, className = "", onClick, onHover,
}: {
  option: EChartsCoreOption;
  height?: number | string;
  className?: string;
  onClick?: (params: { name?: string; dataIndex?: number; seriesName?: string; value?: unknown }) => void;
  onHover?: (params: { name?: string; dataIndex?: number } | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ECharts | null>(null);
  const clickRef = useRef(onClick);
  const hoverRef = useRef(onHover);
  clickRef.current = onClick;
  hoverRef.current = onHover;

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    chart.on("click", (p) => clickRef.current?.(p as never));
    chart.on("mouseover", (p) => hoverRef.current?.(p as never));
    chart.on("globalout", () => hoverRef.current?.(null));
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(
      { textStyle: { fontFamily: CHART_FONT }, animationDuration: 300, ...option },
      { notMerge: true },
    );
  }, [option]);

  return <div ref={ref} className={className} style={{ height, width: "100%" }} />;
}
