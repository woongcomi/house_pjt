"use client";

import { useMemo, useState } from "react";
import { eok, pctArrow, pctColor, type SizeKey, type WatchComplex } from "@/lib/insights";

type SortKey = "dist" | "amtNow" | "chg1y" | "drawdown" | "n90" | "score" | "builtYear";

function ScoreBadge({ v }: { v: number | null | undefined }) {
  if (v === null || v === undefined) return <span className="text-[12px] text-grey-500">–</span>;
  const cls = v >= 60 ? "bg-blue-500 text-white" : v >= 45 ? "bg-blue-50 text-blue-600" : "bg-grey-100 text-grey-700";
  return <span className={`inline-block min-w-[36px] rounded-full px-2 py-0.5 text-center text-[12px] font-bold ${cls}`}>{v}</span>;
}

/**
 * 1년 거래 밴드 — 모든 행이 같은 금액 축(min~max)을 쓰므로 세로로 훑으면
 * '어느 단지가 어느 가격대에 있고 최근가가 그 안에서 어디인지'가 한눈에 보인다.
 */
function Band({ band, now, lo, hi }: { band: [number, number, number] | null | undefined; now: number | null; lo: number; hi: number }) {
  if (!band) return <span className="text-[11px] text-grey-500">표본 부족</span>;
  const x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  return (
    <div className="relative h-5 w-full min-w-[140px]">
      <div className="absolute inset-y-[7px] left-0 right-0 rounded bg-grey-100" />
      <div className="absolute inset-y-[6px] rounded bg-blue-100" style={{ left: x(band[0]), width: `calc(${x(band[2])} - ${x(band[0])})` }} />
      <div className="absolute inset-y-[4px] w-[2px] bg-blue-600" style={{ left: x(band[1]) }} title={`중위 ${eok(band[1])}`} />
      {now !== null && (
        <div className="absolute top-[2px] h-4 w-4 -translate-x-1/2 rounded-full border-2 border-white bg-grey-900 shadow" style={{ left: x(now) }} title={`최근 ${eok(now)}`} />
      )}
    </div>
  );
}

export function WatchTable({
  complexes, size, onSelect, highlight = "벽산",
}: { complexes: WatchComplex[]; size: SizeKey; onSelect: (id: string) => void; highlight?: string }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "dist", desc: false });

  const rows = useMemo(() => {
    const list = complexes.map((c) => ({ c, g: c.groups[size] })).filter((r) => r.g && r.g.amtNow);
    const val = (r: typeof list[number]): number => {
      switch (sort.key) {
        case "dist": return r.c.dist;
        case "builtYear": return r.c.builtYear ?? 0;
        case "amtNow": return r.g!.amtNow ?? 0;
        case "chg1y": return r.g!.chg1y ?? -9;
        case "drawdown": return r.g!.drawdown ?? -9;
        case "n90": return r.g!.n90;
        case "score": return r.g!.score?.total ?? -1;
      }
    };
    return list.sort((a, b) => (val(a) - val(b)) * (sort.desc ? -1 : 1));
  }, [complexes, size, sort]);

  const [lo, hi] = useMemo(() => {
    const vals = rows.flatMap((r) => [r.g!.amtNow ?? 0, ...(r.g!.band1y ?? [])]).filter((v) => v > 0);
    const mn = Math.min(...vals), mx = Math.max(...vals);
    return [mn - (mx - mn) * 0.05, mx + (mx - mn) * 0.05];
  }, [rows]);

  const th = (key: SortKey, label: string, cls = "") => (
    <th className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 text-[12px] font-medium text-grey-600 hover:text-grey-900 ${cls}`}
        onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "dist" && key !== "builtYear" }))}>
      {label}{sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
    </th>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] border-separate border-spacing-0">
        <thead>
          <tr className="text-left">
            <th className="px-3 py-2 text-[12px] font-medium text-grey-600">단지</th>
            {th("dist", "오리역", "text-right")}
            {th("builtYear", "준공", "text-right")}
            {th("amtNow", "최근 실거래", "text-right")}
            {th("chg1y", "1년", "text-right")}
            {th("drawdown", "고점 대비", "text-right")}
            <th className="px-3 py-2 text-[12px] font-medium text-grey-600">1년 거래 밴드 <span className="text-grey-500">(p25–p75 · 중위 · ● 최근)</span></th>
            {th("n90", "90일 거래", "text-right")}
            {th("score", "점수", "text-center")}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ c, g }) => {
            const hit = c.name.includes(highlight);
            return (
              <tr key={c.id} onClick={() => onSelect(c.id)}
                  className={`cursor-pointer text-[13px] transition-colors hover:bg-grey-50 ${hit ? "bg-blue-50/60" : ""}`}>
                <td className="border-t border-grey-100 px-3 py-2.5">
                  <div className={`font-semibold ${hit ? "text-blue-700" : "text-grey-900"}`}>{c.name}</div>
                  <div className="text-[11px] text-grey-600">{c.umd}{c.stations.length ? ` · ${c.stations.map((s) => s + "역").join("·")}` : ""}{g!.areas?.length ? ` · ${g!.areas[0]}㎡` : ""}</div>
                </td>
                <td className="border-t border-grey-100 px-3 py-2.5 text-right tabular-nums text-grey-700">{c.dist}m</td>
                <td className="border-t border-grey-100 px-3 py-2.5 text-right tabular-nums text-grey-700">{c.builtYear ?? "–"}</td>
                <td className="border-t border-grey-100 px-3 py-2.5 text-right">
                  <div className="font-bold tabular-nums text-grey-900">{eok(g!.amtNow)}</div>
                  <div className="text-[11px] text-grey-500">{g!.n90 ? `90일 ${g!.n90}건` : "90일 거래 없음"}</div>
                </td>
                <td className={`border-t border-grey-100 px-3 py-2.5 text-right font-semibold tabular-nums ${pctColor(g!.chg1y)}`}>{pctArrow(g!.chg1y)}</td>
                <td className={`border-t border-grey-100 px-3 py-2.5 text-right font-semibold tabular-nums ${pctColor(g!.drawdown)}`}>{pctArrow(g!.drawdown)}</td>
                <td className="border-t border-grey-100 px-3 py-2.5"><Band band={g!.band1y} now={g!.amtNow} lo={lo} hi={hi} /></td>
                <td className="border-t border-grey-100 px-3 py-2.5 text-right tabular-nums text-grey-700">
                  {g!.n90}{g!.low90 ? <span className="ml-1 rounded-full bg-down-50 px-1.5 text-[11px] font-semibold text-down-600">저가 {g!.low90}</span> : ""}
                </td>
                <td className="border-t border-grey-100 px-3 py-2.5 text-center"><ScoreBadge v={g!.score?.total} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <p className="px-3 py-8 text-center text-[13px] text-grey-600">이 면적형 거래가 있는 단지가 없어요</p>}
    </div>
  );
}
