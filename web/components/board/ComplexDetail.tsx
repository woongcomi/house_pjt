"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { EChartsCoreOption } from "echarts/core";
import { BottomSheet } from "@/components/toss/BottomSheet";
import { EChart, CHART_GRID, CHART_MUTED, CHART_TEXT, tooltipStyle } from "@/components/chart/EChart";
import { formatAmount } from "@/lib/format";
import { eok, monthFull, monthLabel, pctArrow, pctColor, type InsightsFile, type SizeKey, type WatchComplex } from "@/lib/insights";

const PYEONG = 3.305785;

/** 관심 단지 상세 — 면적형 가격 추이(강남 같은 면적형과 같은 축), 1년 거래 밴드, 최근 거래 */
export function ComplexDetail({ complex, data, size, onClose }: {
  complex: WatchComplex | null; data: InsightsFile; size: SizeKey; onClose: () => void;
}) {
  const g = complex?.groups[size];
  const area = g?.areas?.length ? g.areas[Math.floor(g.areas.length / 2)] : size === "S60" ? 59.9 : 84.9;
  const toEok = (ppa: number) => (ppa * (area / PYEONG)) / 10000;

  const option = useMemo<EChartsCoreOption | null>(() => {
    if (!g) return null;
    const mine = new Map(g.series.map((r) => [r[0], r[1]]));
    const gn = new Map(data.gangnam[size].series.map((r) => [r[0], r[1]]));
    const offs = Array.from(new Set([...mine.keys(), ...gn.keys()])).sort((a, b) => a - b);
    const band = g.band1y;
    return {
      tooltip: { ...tooltipStyle, trigger: "axis", valueFormatter: (v: unknown) => (typeof v === "number" ? `${v.toFixed(2)}억` : "–"),
        formatter: (ps: unknown) => {
          const arr = ps as { axisValueLabel: string; seriesName: string; value: number | null; color: string; dataIndex: number }[];
          const head = `<b>${monthFull(data.seriesStart, offs[arr[0].dataIndex])}</b>`;
          return head + arr.filter((p) => p.value !== null).map((p) => `<div><span style="display:inline-block;width:12px;height:3px;background:${p.color};vertical-align:middle;margin-right:6px"></span>${p.seriesName} <b>${(p.value as number).toFixed(2)}억</b></div>`).join("");
        } },
      legend: { top: 0, right: 0, icon: "roundRect", itemWidth: 12, itemHeight: 3, textStyle: { color: CHART_TEXT, fontSize: 11 } },
      grid: { left: 48, right: 16, top: 28, bottom: 28 },
      xAxis: { type: "category", data: offs.map((o) => monthLabel(data.seriesStart, o)), axisTick: { show: false },
        axisLine: { lineStyle: { color: CHART_GRID } }, axisLabel: { color: CHART_MUTED, fontSize: 10, interval: 11 } },
      yAxis: { type: "value", scale: true, name: "억", nameTextStyle: { color: CHART_MUTED, fontSize: 10 },
        splitLine: { lineStyle: { color: CHART_GRID } }, axisLabel: { color: CHART_MUTED, fontSize: 10 } },
      series: [
        { name: `${complex!.name} ${Math.round(area)}㎡`, type: "line", showSymbol: false, connectNulls: true, lineStyle: { width: 2.5, color: "#2a78d6" }, itemStyle: { color: "#2a78d6" },
          data: offs.map((o) => (mine.has(o) ? +toEok(mine.get(o)!).toFixed(2) : null)),
          markLine: band ? { silent: true, symbol: "none", lineStyle: { color: "#8b95a1", type: "solid", width: 1 },
            label: { color: CHART_MUTED, fontSize: 10, formatter: (p: { value: number }) => `${p.value.toFixed(1)}` },
            data: [{ yAxis: band[0], name: "p25" }, { yAxis: band[2], name: "p75" }] } : undefined },
        { name: `강남 ${data.sizeGroups[size]} (${Math.round(area)}㎡ 환산)`, type: "line", showSymbol: false, connectNulls: true, lineStyle: { width: 2, color: "#eb6834" }, itemStyle: { color: "#eb6834" },
          data: offs.map((o) => (gn.has(o) ? +toEok(gn.get(o)!).toFixed(2) : null)) },
      ],
    };
  }, [g, complex, data, size, area]);

  if (!complex || !g) return null;
  return (
    <BottomSheet open onClose={onClose} title={complex.name}>
      <div className="px-5 pb-6">
        <div className="text-[13px] text-grey-700">
          {complex.umd} · {complex.builtYear}년 준공 · 오리역 {complex.dist}m{complex.stations.length ? ` · ${complex.stations.map((s) => s + "역").join("·")} 역세권` : ""}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["최근 실거래 중위", eok(g.amtNow), "text-grey-900", `90일 ${g.n90}건`],
            ["1년 변동", pctArrow(g.chg1y), pctColor(g.chg1y), `3년 ${pctArrow(g.chg3y)}`],
            ["고점 대비", pctArrow(g.drawdown), pctColor(g.drawdown), g.peakYm ? `고점 ${g.peakYm.replace("-", ".")}` : ""],
            ["강남 대비", g.relGangnam ? `${Math.round(g.relGangnam * 100)}%` : "–", "text-grey-900", g.relPct !== null && g.relPct !== undefined ? `10년 중 ${g.relPct}% 위치` : ""],
          ].map(([l, v, c, s]) => (
            <div key={l} className="rounded-[12px] bg-grey-50 p-3">
              <div className="text-[11px] text-grey-600">{l}</div>
              <div className={`text-[18px] font-bold ${c}`}>{v}</div>
              <div className="text-[11px] text-grey-600">{s}</div>
            </div>
          ))}
        </div>

        {g.band1y && (
          <p className="mt-3 text-[13px] text-grey-700">
            최근 1년 {g.n1y}건의 거래가 <b className="text-grey-900">{eok(g.band1y[0])} ~ {eok(g.band1y[2])}</b> (중위 {eok(g.band1y[1])}) 사이예요.
            {g.amtNow && g.band1y && (g.amtNow <= g.band1y[0]
              ? <> 최근가는 그 <b className="text-down-600">하단</b> — 급하게 파는 매물이 체결되는 구간.</>
              : g.amtNow >= g.band1y[2]
                ? <> 최근가는 그 <b className="text-up-500">상단</b> — 신고가 영역.</>
                : <> 최근가는 밴드 안쪽이에요.</>)}
          </p>
        )}

        <div className="mt-4">{option && <EChart option={option} height={260} />}</div>
        {g.score && (
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-grey-700">
            <span className="rounded-full bg-grey-900 px-2 py-0.5 font-bold text-white">점수 {g.score.total}</span>
            {([["상대가치", g.score.value], ["회복 여지", g.score.upside], ["모멘텀", g.score.momentum], ["거래량", g.score.volume], ["협상 여지", g.score.stress]] as const).map(([k, v]) => (
              <span key={k} className="rounded-full bg-grey-100 px-2 py-0.5">{k} {v}</span>
            ))}
          </div>
        )}

        <h3 className="mt-5 text-[14px] font-bold text-grey-900">최근 거래 ({data.sizeGroups[size]})</h3>
        <div className="mt-1 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr className="text-left text-[11px] text-grey-600">
              <th className="py-1.5 pr-3 font-medium">계약일</th><th className="py-1.5 pr-3 text-right font-medium">전용</th>
              <th className="py-1.5 pr-3 text-right font-medium">층</th><th className="py-1.5 pr-3 text-right font-medium">거래가</th>
              <th className="py-1.5 text-right font-medium">직전 1년 대비</th>
            </tr></thead>
            <tbody>
              {(g.deals ?? []).slice(0, 25).map((d, i) => (
                <tr key={i} className="border-t border-grey-100">
                  <td className="py-1.5 pr-3 tabular-nums text-grey-700">{d[0]}{d[5] ? <span className="ml-1 rounded bg-grey-100 px-1 text-[10px] text-grey-600">직거래</span> : ""}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-grey-700">{d[1].toFixed(1)}㎡</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-grey-700">{d[2] ?? "–"}</td>
                  <td className="py-1.5 pr-3 text-right font-semibold tabular-nums text-grey-900">{formatAmount(d[3])}</td>
                  <td className={`py-1.5 text-right tabular-nums ${d[4] === null ? "text-grey-500" : d[4] <= -10 ? "font-semibold text-down-600" : d[4] > 0 ? "text-up-500" : "text-down-500"}`}>
                    {d[4] === null ? "–" : d[4] <= -10 ? `▼ 저가 ${Math.abs(d[4]).toFixed(1)}%` : `${d[4] > 0 ? "▲" : "▼"} ${Math.abs(d[4]).toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Link href={`/rank?sgg=${complex.sgg}&complex=${complex.id}`}
              className="mt-4 block w-full rounded-[12px] bg-blue-50 py-3 text-center text-[14px] font-bold text-blue-600 active:bg-blue-100">
          기간별 수익률·순위 보기
        </Link>
      </div>
    </BottomSheet>
  );
}
