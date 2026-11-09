"use client";

import { useMemo } from "react";
import type { EChartsCoreOption } from "echarts/core";
import { EChart, CHART_GRID, CHART_MUTED, CHART_TEXT, tooltipStyle } from "@/components/chart/EChart";
import { BUNDANG_ORDER, LINE_ORDER, type InsightsFile, type SizeKey, type StationInsight } from "@/lib/insights";

const ORDER = [...LINE_ORDER, ...BUNDANG_ORDER];
const sortByLine = (a: StationInsight, b: StationInsight) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name);

/* ── 흐름 전이 ─────────────────────────────────────── */
export function LeadLagPanel({ data, size }: { data: InsightsFile; size: SizeKey }) {
  const rows = useMemo(
    () => data.stations.filter((s) => s.groups[size].lagCorr !== null && s.groups[size].lagCorr !== undefined && s.sgg !== "11680").sort(sortByLine),
    [data, size],
  );
  const gangnam = useMemo(() => {
    const s = data.gangnam[size].series;
    if (s.length < 12) return null;
    const last3 = s.slice(-3).reduce((a, x) => a + x[1], 0) / 3;
    const prev9 = s.slice(-12, -3).reduce((a, x) => a + x[1], 0) / 9;
    return last3 / prev9 - 1;
  }, [data, size]);

  const option = useMemo<EChartsCoreOption>(() => ({
    tooltip: { ...tooltipStyle, trigger: "item", formatter: (p: unknown) => {
      const q = p as { dataIndex: number };
      const g = rows[q.dataIndex].groups[size];
      return `<b>${rows[q.dataIndex].name}역</b><br/>강남을 <b>${g.lag}개월</b> 뒤따름<br/>상관 r=${g.lagCorr?.toFixed(2)}`;
    } },
    grid: { left: 70, right: 44, top: 8, bottom: 24 },
    xAxis: { type: "value", min: 0, max: 6, interval: 1, name: "개월", nameTextStyle: { color: CHART_MUTED, fontSize: 10 },
      splitLine: { lineStyle: { color: CHART_GRID } }, axisLabel: { color: CHART_MUTED, fontSize: 10 } },
    yAxis: { type: "category", data: rows.map((s) => s.name), inverse: true, axisTick: { show: false }, axisLine: { show: false },
      axisLabel: { color: CHART_TEXT, fontSize: 11 } },
    series: [{
      type: "bar", data: rows.map((s) => s.groups[size].lag ?? 0), barMaxWidth: 12,
      itemStyle: { color: (p: { dataIndex: number }) => {
        const r = rows[p.dataIndex].groups[size].lagCorr ?? 0;
        return r >= 0.25 ? "#1b64da" : r >= 0.15 ? "#7fb0f5" : "#c9ced6";
      }, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: "right", color: CHART_TEXT, fontSize: 10,
        formatter: (p: { dataIndex: number }) => `r=${(rows[p.dataIndex].groups[size].lagCorr ?? 0).toFixed(2)}` },
    }],
  }), [rows, size]);

  const followers = rows.filter((s) => (s.groups[size].lagCorr ?? 0) >= 0.2 && (s.groups[size].lag ?? 0) >= 2);
  return (
    <div>
      <p className="mb-2 text-[13px] leading-relaxed text-grey-700">
        강남 {data.sizeGroups[size]} 지수의 월간 변화를 각 역이 <b className="text-grey-900">몇 달 뒤</b> 따라오는지(교차상관 최대 시차).
        {gangnam !== null && (
          <> 강남은 최근 3개월이 이전 9개월보다 <b className={gangnam > 0 ? "text-up-500" : "text-down-500"}>{gangnam > 0 ? "+" : ""}{(gangnam * 100).toFixed(1)}%</b>
            {followers.length > 0 && gangnam > 0.01 && <> — 뒤따를 차례: <b className="text-grey-900">{followers.map((s) => `${s.name}(${s.groups[size].lag})`).join(", ")}</b></>}
          </>
        )}
      </p>
      <EChart option={option} height={Math.max(180, rows.length * 22 + 40)} />
      <p className="mt-1 text-[11px] text-grey-500">진한 막대일수록 상관이 뚜렷(r≥0.25). 상관이 약한 역은 강남과 따로 움직이는 편이에요.</p>
    </div>
  );
}

/* ── 강남 대비 상대가치 ────────────────────────────── */
export function RelativeValuePanel({ data, size, selected, onSelect }: {
  data: InsightsFile; size: SizeKey; selected: string | null; onSelect: (n: string) => void;
}) {
  const rows = useMemo(
    () => data.stations.filter((s) => s.groups[size].relGangnam && s.groups[size].relBand && s.sgg !== "11680").sort(sortByLine),
    [data, size],
  );
  const lo = Math.min(...rows.map((s) => s.groups[size].relBand![0]));
  const hi = Math.max(...rows.map((s) => s.groups[size].relBand![1]));
  const x = (v: number) => `${((v - lo) / (hi - lo || 1)) * 100}%`;
  return (
    <div>
      <p className="mb-3 text-[13px] leading-relaxed text-grey-700">
        각 역 {data.sizeGroups[size]} 평당가가 <b className="text-grey-900">강남의 몇 %</b>인지. 막대는 10년 범위, 점은 지금.
        점이 막대 <b className="text-down-600">왼쪽</b>에 있으면 역사적으로 강남 대비 눌려 있는(갭이 벌어진) 상태예요.
      </p>
      <div className="space-y-1.5">
        {rows.map((s) => {
          const g = s.groups[size];
          const pct = g.relPct ?? 50;
          const cheap = pct <= 30, dear = pct >= 70;
          return (
            <button key={s.name} onClick={() => onSelect(s.name)}
                    className={`flex w-full items-center gap-3 rounded-[8px] px-2 py-1 text-left hover:bg-grey-50 ${selected === s.name ? "bg-grey-50" : ""}`}>
              <span className="w-[64px] shrink-0 truncate text-[12px] font-semibold text-grey-800">{s.name}</span>
              <span className="relative h-4 flex-1">
                <span className="absolute inset-y-[6px] rounded bg-grey-100" style={{ left: x(g.relBand![0]), width: `calc(${x(g.relBand![1])} - ${x(g.relBand![0])})` }} />
                <span className={`absolute top-[2px] h-3 w-3 -translate-x-1/2 rounded-full border-2 border-white shadow ${cheap ? "bg-down-600" : dear ? "bg-up-500" : "bg-grey-700"}`} style={{ left: x(g.relGangnam!) }} />
              </span>
              <span className="w-[42px] shrink-0 text-right text-[12px] font-bold tabular-nums text-grey-900">{Math.round(g.relGangnam! * 100)}%</span>
              <span className={`w-[58px] shrink-0 text-right text-[11px] tabular-nums ${cheap ? "text-down-600" : dear ? "text-up-500" : "text-grey-500"}`}>{cheap ? "낮음" : dear ? "높음" : "중간"} {pct}%</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── 시장 스트레스 (저가 거래 비율) ─────────────────── */
export function StressPanel({ data, size, focus }: { data: InsightsFile; size: SizeKey; focus: string[] }) {
  const option = useMemo<EChartsCoreOption>(() => {
    const picked = focus.map((n) => data.stations.find((s) => s.name === n)).filter((s): s is StationInsight => !!s && !!s.groups[size].stress?.length);
    const months = Array.from(new Set(picked.flatMap((s) => s.groups[size].stress!.map((r) => r[0])))).sort().slice(-24);
    const colors = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"];
    return {
      tooltip: { ...tooltipStyle, trigger: "axis", valueFormatter: (v: unknown) => (typeof v === "number" ? `${(v * 100).toFixed(0)}%` : "–") },
      legend: { bottom: 0, icon: "roundRect", itemWidth: 12, itemHeight: 3, textStyle: { color: CHART_TEXT, fontSize: 11 } },
      grid: { left: 40, right: 12, top: 12, bottom: 34 },
      xAxis: { type: "category", data: months.map((m) => m.slice(2).replace("-", ".")), axisTick: { show: false },
        axisLine: { lineStyle: { color: CHART_GRID } }, axisLabel: { color: CHART_MUTED, fontSize: 10, interval: 3 } },
      yAxis: { type: "value", min: 0, max: (v: { max: number }) => Math.min(1, Math.ceil((v.max || 0.1) * 10) / 10), splitNumber: 4, axisLabel: { color: CHART_MUTED, fontSize: 10, formatter: (v: number) => `${Math.round(v * 100)}%` },
        splitLine: { lineStyle: { color: CHART_GRID } } },
      series: picked.map((s, i) => {
        const by = new Map(s.groups[size].stress!.map((r) => [r[0], r]));
        return {
          name: `${s.name}역`, type: "line", smooth: 0.2, showSymbol: false, lineStyle: { width: 2 }, itemStyle: { color: colors[i % colors.length] },
          connectNulls: true,
          data: months.map((m) => { const r = by.get(m); return r && r[1] >= 3 ? r[2] : null; }),
        };
      }),
    };
  }, [data, size, focus]);
  return (
    <div>
      <p className="mb-2 text-[13px] leading-relaxed text-grey-700">
        그 달 거래 중 <b className="text-grey-900">저가 거래</b>(같은 단지·면적형 직전 1년 중위가보다 10%↓) 비율.
        올라가면 급하게 파는 사람이 늘고 있다는 뜻이고, 매수자에겐 협상 여지예요. (판정 3건 미만인 달은 비움)
      </p>
      <EChart option={option} height={220} />
    </div>
  );
}
