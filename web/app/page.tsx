"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { loadInsights } from "@/lib/loader";
import { eok, type InsightsFile, type SizeKey } from "@/lib/insights";
import { SkeletonRows } from "@/components/toss/primitives";
import { KpiStrip } from "@/components/board/KpiStrip";
import { LineProfile } from "@/components/board/LineProfile";
import { BoardMap, type MapMode } from "@/components/board/BoardMap";
import { WatchTable } from "@/components/board/WatchTable";
import { LeadLagPanel, RelativeValuePanel, StressPanel } from "@/components/board/InsightPanels";
import { ComplexDetail } from "@/components/board/ComplexDetail";

export default function BoardPage() {
  return (
    <Suspense fallback={<SkeletonRows count={10} />}>
      <Board />
    </Suspense>
  );
}

function Card({ title, sub, right, children, className = "" }: {
  title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-[16px] bg-white p-5 ${className}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[16px] font-bold text-grey-900">{title}</h2>
          {sub && <p className="mt-0.5 text-[12px] text-grey-600">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function Seg<T extends string>({ items, value, onChange }: { items: { key: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-[10px] bg-grey-100 p-1">
      {items.map((it) => (
        <button key={it.key} onClick={() => onChange(it.key)}
                className={`rounded-[7px] px-3 py-1.5 text-[13px] font-bold transition-colors ${value === it.key ? "bg-white text-grey-900 shadow-sm" : "text-grey-700"}`}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

function Board() {
  const router = useRouter();
  const params = useSearchParams();
  const size = (params.get("size") === "M85" ? "M85" : "S60") as SizeKey;
  const station = params.get("st");
  const complexId = params.get("complex");

  const [data, setData] = useState<InsightsFile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState<MapMode>("chg1y");

  useEffect(() => { loadInsights().then(setData).catch((e) => setErr(String(e))); }, []);

  const setParam = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null) next.delete(k); else next.set(k, v); }
    const q = next.toString();
    router.replace(q ? `/?${q}` : "/", { scroll: false });
  }, [params, router]);

  const focusStation = useMemo(() => data?.stations.find((s) => s.name === (station ?? "오리")) ?? data?.stations.find((s) => s.name === "오리") ?? null, [data, station]);
  const selectedComplex = useMemo(() => data?.watch.complexes.find((c) => c.id === complexId) ?? null, [data, complexId]);
  const opp = useMemo(() => (data ? data.opportunities.filter((o) => o[4] === size).slice(0, 12) : []), [data, size]);

  if (err) return <main className="p-8 text-[14px] text-grey-700">데이터를 불러오지 못했어요. 파이프라인(insights.py)을 먼저 실행해 주세요.<br /><span className="text-[12px] text-grey-500">{err}</span></main>;
  if (!data || !focusStation) return <SkeletonRows count={12} />;

  const sizeLabel = data.sizeGroups[size];
  const fg = focusStation.groups[size];

  return (
    <main className="space-y-4 px-4 pb-16 pt-5 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight text-grey-900">오리역 · 신분당선 {sizeLabel} 투자 보드</h1>
          <p className="mt-1 text-[13px] text-grey-600">
            국토교통부 실거래가 · 역 반경 {data.radiusM}m 단지 기준 · {data.asOf.replace("-", "년 ")}월까지 반영 · {data.today} 갱신
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Seg items={[{ key: "S60", label: "59㎡대" }, { key: "M85", label: "84㎡대" }]} value={size} onChange={(v) => setParam({ size: v === "S60" ? null : v })} />
          <select value={focusStation.name} onChange={(e) => setParam({ st: e.target.value === "오리" ? null : e.target.value })}
                  className="rounded-[10px] border border-grey-200 bg-white px-3 py-2 text-[13px] font-semibold text-grey-900">
            {data.stations.map((s) => <option key={s.name} value={s.name}>{s.name}역 · {s.line}</option>)}
          </select>
        </div>
      </header>

      <KpiStrip g={fg} sizeLabel={sizeLabel} stationName={focusStation.name} />

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="노선 프로파일" sub={`신사 → 광교, 그리고 분당선 오리·죽전. 막대 = ${sizeLabel} 실거래 중위가(억), 색 = 1년 변동. 역을 누르면 기준 역이 바뀌어요.`}>
          <LineProfile stations={data.stations} size={size} selected={focusStation.name} onSelect={(n) => n && setParam({ st: n === "오리" ? null : n })} />
        </Card>
        <Card className="xl:col-span-2" title="지도" sub="점 크기 = 90일 거래량 · 파란 테두리 = 저가 거래 있음"
              right={<Seg items={[{ key: "chg1y", label: "1년 변동" }, { key: "drawdown", label: "고점 대비" }, { key: "low", label: "저가" }]} value={mapMode} onChange={setMapMode} />}>
          <BoardMap stations={data.stations} points={data.points} size={size} mode={mapMode} selectedStation={focusStation.name}
                    onSelectStation={(n) => setParam({ st: n === "오리" ? null : n })} onSelectComplex={(id) => setParam({ complex: id })} height={440} />
        </Card>
      </div>

      <Card title={`오리역 생활권 단지 · ${sizeLabel}`} sub={`오리역·죽전역 ${data.watch.radiusM / 1000}km 안 단지. 벽산블루밍은 파란 배경. 머리글을 누르면 정렬, 행을 누르면 상세.`}
            right={<span className="text-[12px] text-grey-600">점수 = 상대가치 30 · 회복 여지 25 · 모멘텀 20 · 거래량 15 · 협상 여지 10</span>}>
        <WatchTable complexes={data.watch.complexes} size={size} onSelect={(id) => setParam({ complex: id })} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="흐름 전이 — 강남을 몇 달 뒤따르나">
          <LeadLagPanel data={data} size={size} />
        </Card>
        <Card title="강남 대비 상대가치">
          <RelativeValuePanel data={data} size={size} selected={focusStation.name} onSelect={(n) => setParam({ st: n === "오리" ? null : n })} />
        </Card>
        <Card title="시장 스트레스 — 저가 거래 비율">
          <StressPanel data={data} size={size} focus={Array.from(new Set([focusStation.name, "오리", "수지구청", "미금", "정자"])).slice(0, 4)} />
        </Card>
      </div>

      <Card title={`최근 90일 저가 거래 · 역세권 ${sizeLabel}`} sub="같은 단지·면적형의 직전 1년 중위가보다 10% 이상 싸게 체결된 거래. 매수자에겐 가격 협상의 근거가 돼요."
            right={<Link href={`/recent/?area=sin&low=1`} className="text-[13px] font-semibold text-blue-600">전체 보기 →</Link>}>
        {opp.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-grey-600">최근 90일엔 {sizeLabel} 저가 거래가 없었어요 — 시장이 강하다는 뜻이기도 해요.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {opp.map((o, i) => (
              <div key={i} className="flex items-center justify-between rounded-[12px] bg-grey-50 px-4 py-3">
                <div>
                  <div className="text-[14px] font-semibold text-grey-900">{o[2]} <span className="font-medium text-grey-600">{o[5].toFixed(1)}㎡ · {o[6] ?? "-"}층</span></div>
                  <div className="text-[12px] text-grey-600">{o[0]} · {o[3].map((s) => s + "역").join("·")}</div>
                </div>
                <div className="text-right">
                  <div className="text-[15px] font-bold text-grey-900">{eok(o[7] / 10000)}</div>
                  <div className="text-[12px] font-semibold text-down-600">▼ {Math.abs(o[8]).toFixed(1)}%</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <footer className="px-1 text-[11px] leading-relaxed text-grey-600">
        실거래 신고는 계약 후 30일 이내라 최근 한 달 수치는 계속 늘어나요. 이번 달은 표본이 적어 지수는 지난달({data.asOf.replace("-", ".")})까지를 '현재'로 봐요.
        평당가는 전용면적 기준. 점수는 과거 패턴 기반 참고 지표이며 투자 판단의 근거로 삼기 전 원본(실거래가 공개시스템)을 확인하세요.
      </footer>

      <ComplexDetail complex={selectedComplex} data={data} size={size} onClose={() => setParam({ complex: null })} />
    </main>
  );
}
