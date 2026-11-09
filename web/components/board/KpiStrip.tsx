"use client";

import { eok, pctArrow, pctColor, type GroupMetrics } from "@/lib/insights";

function Tile({
  label, value, valueClass = "text-grey-900", caption,
}: { label: string; value: string; valueClass?: string; caption: string }) {
  return (
    <div className="rounded-[14px] bg-white p-4">
      <div className="text-[12px] font-medium text-grey-600">{label}</div>
      <div className={`mt-1 text-[22px] font-bold tracking-tight ${valueClass}`}>{value}</div>
      <div className="mt-0.5 text-[12px] text-grey-700">{caption}</div>
    </div>
  );
}

/** 보드 상단 요약. 기준 역(기본 오리역) 한 곳의 숫자를 여섯 조각으로. */
export function KpiStrip({ g, sizeLabel, stationName }: { g: GroupMetrics; sizeLabel: string; stationName: string }) {
  const rel = g.relGangnam;
  const z = g.volZ;
  const stress = g.stress90;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Tile
        label={`${stationName}역 ${sizeLabel} 실거래 중위`}
        value={eok(g.amtNow)}
        caption={g.amtSrc === "deals" ? `최근 90일 ${g.n90}건 기준` : "지수 환산 (최근 거래 적음)"}
      />
      <Tile label="1년 변동" value={pctArrow(g.chg1y)} valueClass={pctColor(g.chg1y)}
            caption={`3년 ${pctArrow(g.chg3y)}`} />
      <Tile label="고점 대비" value={pctArrow(g.drawdown)} valueClass={pctColor(g.drawdown)}
            caption={g.peakYm ? `고점 ${g.peakYm.replace("-", ".")} · 저점 이후 ${pctArrow(g.recovery)}` : "표본 부족"} />
      <Tile
        label="거래량 신호"
        value={z === null ? "–" : `${z > 0 ? "+" : ""}${z.toFixed(1)}σ`}
        valueClass={z === null ? "text-grey-600" : z >= 1 ? "text-up-500" : z <= -1 ? "text-down-500" : "text-grey-900"}
        caption={`최근 3개월 ${g.vol3m ?? 0}건 · 5년 평균 대비`}
      />
      <Tile
        label="강남 대비 상대가치"
        value={rel ? `${Math.round(rel * 100)}%` : "–"}
        caption={g.relPct !== null && g.relPct !== undefined
          ? `10년 범위에서 ${g.relPct <= 30 ? "낮은 편" : g.relPct >= 70 ? "높은 편" : "중간"} (${g.relPct}%)`
          : "강남 59㎡대 평당가 대비"}
      />
      <Tile
        label="저가 거래 (90일)"
        value={`${g.low90}건`}
        valueClass={g.low90 > 0 ? "text-down-600" : "text-grey-900"}
        caption={stress !== null && stress !== undefined ? `판정 가능 거래의 ${(stress * 100).toFixed(0)}%` : "직전 1년 중위 대비 −10%↓"}
      />
    </div>
  );
}
