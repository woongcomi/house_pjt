"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { compute, rank as rankFn, ymToIdx, type MetricKey, type MetricResult } from "@/lib/metrics";
import { loadGu, loadMeta, prefetchAreas, type Meta } from "@/lib/loader";
import type { ComplexRow } from "@/lib/series";
import { GU_CODES, SEOUL_GU } from "@/lib/seoul";
import { METRICS, METRIC_BY_KEY } from "@/lib/metricDefs";
import { parsePeriod, periodToQuery, type Period } from "@/lib/period";
import { formatMonth, formatPct, formatPctAbs, formatPctArrow, formatPpa, trendColor } from "@/lib/format";
import { SkeletonRows, Tabs, Notice } from "@/components/toss/primitives";
import { Sparkline } from "@/components/chart/Sparkline";
import { PeriodSheet } from "@/components/PeriodSheet";
import { GuSheet } from "@/components/GuSheet";
import { ComplexSheet } from "@/components/ComplexSheet";
import { RankMap, type MapPoint } from "@/components/map/RankMap";

export default function RankPage() {
  return (
    <Suspense fallback={<SkeletonRows count={10} />}>
      <RankContent />
    </Suspense>
  );
}

interface Scored {
  row: ComplexRow;
  m: MetricResult;
  sgg: string;
}

function RankContent() {
  const router = useRouter();
  const params = useSearchParams();

  const sgg = params.get("sgg") ?? "11680";
  const metric = (params.get("metric") ?? "ret") as MetricKey;
  const openId = params.get("complex");
  const view = params.get("view") === "map" ? "map" : "list";

  const [meta, setMeta] = useState<Meta | null>(null);
  const [raw, setRaw] = useState<{ sgg: string; rows: ComplexRow[] }[] | null>(null);
  const [rows, setRows] = useState<Scored[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [guOpen, setGuOpen] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);

  useEffect(() => {
    loadMeta().then(setMeta).catch((e) => setErr(String(e)));
  }, []);

  const bounds = useMemo(() => {
    if (!meta) return { first: 0, last: 0 };
    return { first: ymToIdx(meta.startYm), last: ymToIdx(meta.lastYm) };
  }, [meta]);

  const period: Period = useMemo(
    () =>
      parsePeriod(params.get("from"), params.get("to"), {
        t0: Math.max(bounds.first, bounds.last - 60),
        t1: bounds.last,
      }),
    [params, bounds],
  );

  useEffect(() => {
    if (!meta) return;
    setLoading(true);
    setErr(null);
    const codes = sgg === "all" ? GU_CODES : [sgg];
    Promise.all(
      codes.map((c) =>
        loadGu(c)
          .then((r) => ({ sgg: c, rows: r }))
          .catch(() => ({ sgg: c, rows: [] as ComplexRow[] })),
      ),
    )
      .then((res) => {
        setRaw(res);
        setLoading(false);
      })
      .catch((e) => {
        setErr(String(e));
        setLoading(false);
      });
    if (sgg !== "all") prefetchAreas(sgg);
  }, [sgg, meta]);

  useEffect(() => {
    if (!raw) return;
    const out: Scored[] = [];
    for (const g of raw) {
      for (const row of g.rows) {
        out.push({ row, m: compute(row.series, period.t0, period.t1), sgg: g.sgg });
      }
    }
    setRows(out);
  }, [raw, period.t0, period.t1]);

  const def = METRIC_BY_KEY[metric] ?? METRIC_BY_KEY.ret;

  const ranked = useMemo(() => {
    if (!rows) return null;
    const byId = new Map(rows.map((s) => [s.row.id, s]));
    const list = rankFn(
      rows.map((s) => [s.row.id, s.m] as [string, MetricResult]),
      def.key,
      def.descending,
    );
    return list.map((r) => ({ ...r, s: byId.get(r.id)! }));
  }, [rows, def]);

  const excluded = rows && ranked ? rows.length - ranked.length : 0;

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      router.replace(`/rank?${next.toString()}`, { scroll: false });
    },
    [params, router],
  );

  const openScored = rows?.find((s) => s.row.id === openId) ?? null;

  const summary = useMemo(() => {
    if (!ranked || ranked.length === 0 || !rows) return null;
    const rets = ranked.map((r) => r.s.m.ret).sort((a, b) => a - b);

    // 단지 수로는 30% 남짓만 순위에 들지만, 그 30%가 실제 거래의 8할 이상을
    // 차지한다. '1,294곳 제외' 보다 '거래의 84% 포함' 이 훨씬 정직한 설명이다.
    let covered = 0;
    let all = 0;
    for (const s of rows) all += s.m.nTrades;
    for (const r of ranked) covered += r.s.m.nTrades;

    return {
      med: rets[Math.floor(rets.length / 2)],
      ppaStart: avg(ranked.map((r) => r.s.m.pStart)),
      ppaEnd: avg(ranked.map((r) => r.s.m.pEnd)),
      n: ranked.length,
      coverage: all > 0 ? covered / all : 0,
    };
  }, [ranked, rows]);

  /** 지도에 얹을 점 — 좌표가 없는 단지는 제외 */
  const mapPoints: MapPoint[] = useMemo(() => {
    if (!ranked) return [];
    const out: MapPoint[] = [];
    for (const r of ranked) {
      const row = r.s.row;
      if (!row.lat || !row.lng) continue;
      out.push({
        id: row.id,
        name: row.name,
        lat: row.lat,
        lng: row.lng,
        ret: def.signed ? r.value : r.s.m.ret,
        nTrades: r.s.m.nTrades,
        rank: r.rank,
      });
    }
    return out;
  }, [ranked, def]);

  /** 순위에 들지 못한 단지 — 목록에서 사라지게 하지 않는다 */
  const [showExcluded, setShowExcluded] = useState(false);
  const excludedRows = useMemo(() => {
    if (!rows || !ranked) return [];
    const inRank = new Set(ranked.map((r) => r.id));
    return rows
      .filter((s) => !inRank.has(s.row.id))
      .sort((a, b) => b.row.series.nLife - a.row.series.nLife);
  }, [rows, ranked]);

  const title = sgg === "all" ? "서울 전체" : SEOUL_GU[sgg] ?? sgg;

  return (
    <main className="pb-16">
      <header className="sticky top-0 z-20 border-b border-grey-100 bg-white/95 backdrop-blur">
        <div className="flex items-center gap-2 px-5 pb-2 pt-4">
          <Link href="/" aria-label="홈으로" className="-ml-2 rounded-full p-2 active:bg-grey-100">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-grey-700">
              <path
                d="M12.5 4l-6 6 6 6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          <button
            onClick={() => setGuOpen(true)}
            className="flex items-center gap-1 text-[20px] font-bold text-grey-900"
          >
            {title}
            <Caret />
          </button>

          <div className="ml-auto flex rounded-[10px] bg-grey-100 p-1">
            {(["list", "map"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setParam({ view: v === "list" ? null : v })}
                className={`rounded-[7px] px-3 py-1.5 text-[13px] font-bold transition-colors ${
                  view === v ? "bg-white text-grey-900 shadow-sm" : "text-grey-700"
                }`}
              >
                {v === "list" ? "목록" : "지도"}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => setPeriodOpen(true)}
          className="flex w-full items-center gap-1 px-5 pb-3 text-left"
        >
          <span className="text-[14px] font-medium text-grey-600">
            {formatMonth(period.t0)} ~ {formatMonth(period.t1)}
          </span>
          <Caret small />
        </button>

        <Tabs
          items={METRICS.map((m) => ({ key: m.key, label: m.tab }))}
          value={def.key}
          onChange={(k) => setParam({ metric: k })}
        />

        <p className="px-5 pb-3 pt-2 text-[13px] leading-relaxed text-grey-700">{def.help}</p>
      </header>

      {err && <p className="p-6 text-[14px] text-grey-600">불러오지 못했어요: {err}</p>}
      {(loading || !ranked) && !err && <SkeletonRows count={10} />}

      {ranked && summary && (
        <>
          <div className="mx-5 mt-4 rounded-[16px] bg-grey-50 p-5">
            <div className="text-[13px] font-medium text-grey-600">
              이 기간 {title} 아파트 중간값
            </div>
            <div className={`mt-1 text-[30px] font-bold tracking-tight ${trendColor(summary.med)}`}>
              {formatPctArrow(summary.med)}
            </div>
            <div className="mt-1 text-[13px] text-grey-700">
              전용 평당 {formatPpa(summary.ppaStart)} → {formatPpa(summary.ppaEnd)}
            </div>
            <div className="mt-3 text-[12px] leading-relaxed text-grey-700">
              순위에 든 {summary.n.toLocaleString()}곳이 이 기간 거래의{" "}
              <strong className="font-semibold text-grey-600">
                {Math.round(summary.coverage * 100)}%
              </strong>
              를 차지해요
            </div>
          </div>

          {ranked.length === 0 && (
            <Notice>
              이 기간에는 순위를 매길 만큼 거래가 있는 단지가 없어요. 기간을 넓혀보세요.
            </Notice>
          )}

          {view === "map" && (
            <div className="mt-4">
              <RankMap
                points={mapPoints}
                selectedId={openId}
                onSelect={(id) => setParam({ complex: id })}
                height={460}
              />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 pt-3 text-[11px] font-medium text-grey-700">
                <Legend color="#B81F2C" label="+50% 이상" />
                <Legend color="#F04452" label="+20%" />
                <Legend color="#F5808A" label="+5%" />
                <Legend color="#8B95A1" label="보합" />
                <Legend color="#7FB0F5" label="-5%" />
                <Legend color="#1B64DA" label="-20% 이하" />
              </div>
              <p className="px-5 pt-2 text-[12px] leading-relaxed text-grey-700">
                점이 클수록 이 기간 거래가 많았던 단지예요. 점을 누르면 상세가 열려요.
                {mapPoints.length < ranked.length && (
                  <>
                    {" "}
                    위치를 찾지 못한 {(ranked.length - mapPoints.length).toLocaleString()}곳은
                    지도에 없어요.
                  </>
                )}
              </p>
            </div>
          )}

          <ul className={view === "map" ? "hidden" : "mt-2"}>
            {ranked.slice(0, 300).map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => setParam({ complex: r.id })}
                  className="flex w-full items-center gap-2.5 px-5 py-3.5 text-left active:bg-grey-50"
                >
                  <span
                    className={`w-7 shrink-0 text-[15px] font-bold tabular-nums ${
                      r.rank <= 3 ? "text-blue-600" : "text-grey-700"
                    }`}
                  >
                    {r.rank}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold text-grey-900">
                      {r.s.row.name}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-grey-700">
                      {sgg === "all" ? `${SEOUL_GU[r.s.sgg]} ` : ""}
                      {r.s.row.dong}
                      {r.s.row.buildYear ? ` · ${r.s.row.buildYear}년` : ""}
                    </span>
                  </span>
                  <Sparkline
                    values={sliceValues(r.s.row, period)}
                    up={r.s.m.ret >= 0}
                    width={52}
                    height={22}
                  />
                  <span
                    className={`w-[80px] shrink-0 text-right text-[15px] font-bold tabular-nums ${
                      def.signed ? trendColor(r.value) : "text-grey-900"
                    }`}
                  >
                    {def.signed ? formatPctArrow(r.value) : formatPctAbs(r.value)}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {view === "list" && ranked.length > 300 && (
            <p className="px-5 py-4 text-center text-[12px] text-grey-700">
              상위 300곳만 보여드려요 (전체 {ranked.length.toLocaleString()}곳)
            </p>
          )}

          {/* 순위에서 빠진 단지도 찾을 수 있어야 한다. 목록에서 아예 지우면
              사용자는 '내 아파트가 없다' 고 느끼고 데이터를 의심한다. */}
          {view === "list" && excludedRows.length > 0 && (
            <div className="mt-4 border-t border-grey-100 pt-2">
              <button
                onClick={() => setShowExcluded((v) => !v)}
                className="flex w-full items-center justify-between px-5 py-4 text-left active:bg-grey-50"
              >
                <span>
                  <span className="block text-[14px] font-semibold text-grey-700">
                    거래가 적어 순위를 못 매긴 단지 {excludedRows.length.toLocaleString()}곳
                  </span>
                  <span className="mt-0.5 block text-[12px] text-grey-700">
                    이 기간 거래가 너무 적으면 순위가 의미 없어져요
                  </span>
                </span>
                <span className={`shrink-0 transition-transform ${showExcluded ? "rotate-180" : ""}`}>
                  <Caret />
                </span>
              </button>

              {showExcluded && (
                <ul className="pb-4">
                  {excludedRows.slice(0, 100).map((s) => (
                    <li key={s.row.id}>
                      <button
                        onClick={() => setParam({ complex: s.row.id })}
                        className="flex w-full items-center gap-3 px-5 py-3 text-left active:bg-grey-50"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium text-grey-600">
                            {s.row.name}
                          </span>
                          <span className="mt-0.5 block truncate text-[12px] text-grey-600">
                            {sgg === "all" ? `${SEOUL_GU[s.sgg]} ` : ""}
                            {s.row.dong}
                            {s.row.series.t.length > 0 &&
                              ` · 마지막 거래 ${formatMonth(
                                s.row.series.t[s.row.series.t.length - 1],
                              )}`}
                          </span>
                        </span>
                        <span className="shrink-0 text-[12px] text-grey-600">
                          {s.m.ok ? `거래 ${s.m.nTrades}` : "거래 없음"}
                        </span>
                      </button>
                    </li>
                  ))}
                  {excludedRows.length > 100 && (
                    <li className="px-5 py-3 text-center text-[12px] text-grey-600">
                      100곳만 보여드려요
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      <GuSheet
        open={guOpen}
        onClose={() => setGuOpen(false)}
        value={sgg}
        onChange={(v) => setParam({ sgg: v, complex: null })}
      />

      <PeriodSheet
        open={periodOpen}
        onClose={() => setPeriodOpen(false)}
        value={period}
        first={bounds.first}
        last={bounds.last}
        onChange={(p) => {
          const q = new URLSearchParams(periodToQuery(p));
          setParam({ from: q.get("from"), to: q.get("to") });
        }}
      />

      {openScored && (
        <ComplexSheet
          open
          onClose={() => setParam({ complex: null })}
          row={openScored.row}
          sgg={openScored.sgg}
          period={period}
          rankRow={ranked?.find((r) => r.id === openScored.row.id) ?? null}
          total={ranked?.length ?? 0}
          regionName={title}
        />
      )}
    </main>
  );
}

function sliceValues(row: ComplexRow, p: Period): number[] {
  const out: number[] = [];
  for (let i = 0; i < row.series.t.length; i++) {
    const t = row.series.t[i];
    if (t >= p.t0 && t <= p.t1) out.push(row.series.p[i]);
  }
  return out;
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function Caret({ small }: { small?: boolean }) {
  const s = small ? 14 : 18;
  return (
    <svg width={s} height={s} viewBox="0 0 20 20" fill="none" className="text-grey-600">
      <path
        d="M5.5 8l4.5 4.5L14.5 8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
