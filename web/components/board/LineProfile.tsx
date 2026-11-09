"use client";

import { useMemo } from "react";
import type { EChartsCoreOption } from "echarts/core";
import { EChart, CHART_AXIS, CHART_GRID, CHART_MUTED, CHART_TEXT, tooltipStyle } from "@/components/chart/EChart";
import {
  BUNDANG_ORDER, LINE_ORDER, changeColor, eok, pctArrow, type SizeKey, type StationInsight,
} from "@/lib/insights";

/**
 * 노선 프로파일 — 역을 노선 순서대로 늘어놓고 가격(막대 높이)과 1년 변동(막대 색)을 함께 본다.
 * 아래 작은 막대는 최근 90일 거래량. 두 지표는 축을 따로 가진 두 차트로 쌓는다 (이중축 금지).
 */
export function LineProfile({
  stations, size, selected, onSelect,
}: {
  stations: StationInsight[];
  size: SizeKey;
  selected: string | null;
  onSelect: (name: string | null) => void;
}) {
  const ordered = useMemo(() => {
    const by = new Map(stations.map((s) => [s.name, s]));
    return [...LINE_ORDER, ...BUNDANG_ORDER].map((n) => by.get(n)).filter((s): s is StationInsight => !!s);
  }, [stations]);

  const option = useMemo<EChartsCoreOption>(() => {
    const names = ordered.map((s) => s.name);
    const groups = ordered.map((s) => s.groups[size]);
    const prices = groups.map((g) => g.amtNow);
    const vols = groups.map((g) => g.n90);
    const lows = groups.map((g) => g.low90);
    const splitIdx = LINE_ORDER.filter((n) => names.includes(n)).length; // 분당선 시작 위치

    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(25,31,40,0.04)" } },
        ...tooltipStyle,
        formatter: (params: unknown) => {
          const p = (params as { dataIndex: number }[])[0];
          const s = ordered[p.dataIndex];
          const g = s.groups[size];
          if (!g.amtNow) return `<b>${s.name}역</b><br/><span style="color:${CHART_MUTED}">${size === "S60" ? "59㎡대" : "84㎡대"} 표본 없음</span>`;
          const row = (k: string, v: string) =>
            `<div style="display:flex;justify-content:space-between;gap:18px"><span style="color:${CHART_TEXT}">${k}</span><b>${v}</b></div>`;
          return `<div style="min-width:190px"><b>${s.name}역</b> <span style="color:${CHART_MUTED};font-size:11px">${s.line} · 단지 ${g.nComplexes ?? 0}곳</span>` +
            row("실거래 중위", eok(g.amtNow)) +
            row("1년 변동", pctArrow(g.chg1y)) +
            row("고점 대비", pctArrow(g.drawdown)) +
            row("90일 거래 / 저가", `${g.n90}건 / ${g.low90}건`) +
            row("강남 대비", g.relGangnam ? `${Math.round(g.relGangnam * 100)}%` : "–") +
            row("강남 후행", g.lagCorr ? `${g.lag}개월 (r=${g.lagCorr.toFixed(2)})` : "–") +
            row("종합 점수", g.score ? `${g.score.total}` : "–") + `</div>`;
        },
      },
      grid: [
        { left: 56, right: 16, top: 28, height: "56%" },
        { left: 56, right: 16, bottom: 36, height: "16%" },
      ],
      xAxis: [
        { type: "category", data: names, gridIndex: 0, axisTick: { show: false }, axisLine: { show: false },
          axisLabel: { show: false } },
        { type: "category", data: names, gridIndex: 1, axisTick: { show: false },
          axisLine: { lineStyle: { color: CHART_AXIS } },
          axisLabel: { color: CHART_TEXT, fontSize: 11, interval: 0,
            formatter: (v: string) => (v.length > 4 ? v.slice(0, 4) + "…" : v) } },
      ],
      yAxis: [
        { type: "value", gridIndex: 0, name: "억", nameTextStyle: { color: CHART_MUTED, fontSize: 11 },
          splitLine: { lineStyle: { color: CHART_GRID } }, axisLabel: { color: CHART_MUTED, fontSize: 11 } },
        { type: "value", gridIndex: 1, splitNumber: 2, splitLine: { lineStyle: { color: CHART_GRID } },
          axisLabel: { color: CHART_MUTED, fontSize: 10 } },
      ],
      series: [
        {
          name: "실거래 중위가", type: "bar", xAxisIndex: 0, yAxisIndex: 0, data: prices,
          barMaxWidth: 30, barCategoryGap: "35%",
          itemStyle: {
            color: (p: { dataIndex: number }) => changeColor(groups[p.dataIndex].chg1y),
            borderRadius: [4, 4, 0, 0],
            borderColor: "#191f28",
            borderWidth: 0,
          },
          emphasis: { itemStyle: { borderWidth: 0, opacity: 0.85 } },
          label: {
            show: true, position: "top", color: CHART_TEXT, fontSize: 11,
            formatter: (p: { value: number | null }) => (p.value ? `${p.value.toFixed(1)}` : "–"),
          },
          markArea: splitIdx < names.length ? {
            silent: true, itemStyle: { color: "rgba(49,130,246,0.05)" },
            label: { show: true, position: "insideTop", color: CHART_MUTED, fontSize: 11, formatter: "분당선" },
            data: [[{ xAxis: names[splitIdx] }, { xAxis: names[names.length - 1] }]],
          } : undefined,
          markPoint: selected && names.includes(selected) ? {
            symbol: "triangle", symbolSize: 10, symbolRotate: 180, symbolOffset: [0, -30],
            itemStyle: { color: "#191f28" },
            data: [{ coord: [selected, prices[names.indexOf(selected)] ?? 0] }],
            label: { show: false },
          } : undefined,
        },
        {
          name: "90일 거래", type: "bar", xAxisIndex: 1, yAxisIndex: 1, data: vols,
          barMaxWidth: 30, barCategoryGap: "35%", itemStyle: { color: "#b0b8c1", borderRadius: [3, 3, 0, 0] },
        },
        {
          name: "저가 거래", type: "bar", xAxisIndex: 1, yAxisIndex: 1, data: lows, barGap: "-100%",
          barMaxWidth: 30, itemStyle: { color: "#1b64da", borderRadius: [3, 3, 0, 0] },
        },
      ],
    };
  }, [ordered, size, selected]);

  return (
    <div>
      <EChart option={option} height={380} onClick={(p) => onSelect(p.name ?? null)} />
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-grey-600">
        <span className="font-medium text-grey-700">막대 색 = 1년 변동</span>
        {[["▼ 12%↓", -0.2], ["▼ 3~12%", -0.08], ["보합", 0], ["▲ 3~12%", 0.08], ["▲ 12~25%", 0.18], ["▲ 25%↑", 0.3]].map(([l, v]) => (
          <span key={l as string} className="inline-flex items-center gap-1">
            <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: changeColor(v as number) }} />{l}
          </span>
        ))}
        <span className="ml-auto inline-flex items-center gap-1">
          <i className="inline-block h-2.5 w-2.5 rounded-sm bg-grey-400" /> 90일 거래
          <i className="ml-2 inline-block h-2.5 w-2.5 rounded-sm bg-down-600" /> 그중 저가
        </span>
      </div>
    </div>
  );
}
