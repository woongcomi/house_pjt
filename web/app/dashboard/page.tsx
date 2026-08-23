"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { compute, ymToIdx, type MetricResult } from "@/lib/metrics";
import { loadGu, loadMeta, loadRegion, type Meta, type RegionFile } from "@/lib/loader";
import type { ComplexRow } from "@/lib/series";
import { SEOUL_GU } from "@/lib/seoul";
import { parsePeriod, periodToQuery, type Period } from "@/lib/period";
import { formatMonth, formatPct, formatPctAbs, formatPctArrow, formatPpa, trendColor } from "@/lib/format";
import { SkeletonRows } from "@/components/toss/primitives";
import { Histogram } from "@/components/chart/Histogram";
import { Scatter } from "@/components/chart/Scatter";
import { PeriodSheet } from "@/components/PeriodSheet";

export default function DashboardPage() {
  return (
    <Suspense fallback={<SkeletonRows count={8} />}>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const router = useRouter();
  const params = useSearchParams();

  const [meta, setMeta] = useState<Meta | null>(null);
  const [region, setRegion] = useState<RegionFile | null>(null);
  const [periodOpen, setPeriodOpen] = useState(false);

  const focusGu = params.get("sgg") ?? "11680";

  useEffect(() => {
    Promise.all([loadMeta(), loadRegion()])
      .then(([m, r]) => {
        setMeta(m);
        setRegion(r);
      })
      .catch(() => {});
  }, []);

  const bounds = useMemo(
    () =>
      meta
        ? { first: ymToIdx(meta.startYm), last: ymToIdx(meta.lastYm) }
        : { first: 0, last: 0 },
    [meta],
  );

  const period = useMemo(
    () =>
      parsePeriod(params.get("from"), params.get("to"), {
        t0: Math.max(bounds.first, bounds.last - 60),
        t1: bounds.last,
      }),
    [params, bounds],
  );

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      router.replace(`/dashboard?${next.toString()}`, { scroll: false });
    },
    [params, router],
  );

  // ── 구별 기간 수익률 ────────────────────────────
  const guStats = useMemo(() => {
    if (!region) return [];
    const out: { code: string; name: string; ret: number; ppaEnd: number }[] = [];
    for (const [code, name] of Object.entries(SEOUL_GU)) {
      const s = region.region[`sgg:${code}`];
      if (!s) continue;
      const m = compute({ t: s.t, p: s.p, n: s.n, nLife: 999 }, period.t0, period.t1);
      if (m.ok) out.push({ code, name, ret: m.ret, ppaEnd: m.pEnd });
    }
    return out.sort((a, b) => b.ret - a.ret);
  }, [region, period]);

  // ── 거래량 추이 ────────────────────────────────
  const volume = useMemo(() => {
    if (!region) return [];
    const s = region.region["seoul:11"];
    if (!s) return [];
    const byYear = new Map<number, number>();
    for (let i = 0; i < s.t.length; i++) {
      const y = Math.floor(s.t[i] / 12);
      byYear.set(y, (byYear.get(y) ?? 0) + s.n[i]);
    }
    return [...byYear.entries()].sort((a, b) => a[0] - b[0]);
  }, [region]);

  // ── 선택한 구의 단지 단위 분석 ────────────────────
  const [guRows, setGuRows] = useState<ComplexRow[] | null>(null);
  useEffect(() => {
    setGuRows(null);
    loadGu(focusGu).then(setGuRows).catch(() => setGuRows([]));
  }, [focusGu]);

  const scored = useMemo(() => {
    if (!guRows) return null;
    return guRows
      .map((row) => ({ row, m: compute(row.series, period.t0, period.t1) }))
      .filter((s) => s.m.ok && s.m.eligible);
  }, [guRows, period]);

  const byAge = useMemo(() => {
    if (!scored) return [];
    const buckets: { label: string; min: number; max: number; rets: number[] }[] = [
      { label: "5년 이내", min: 2021, max: 9999, rets: [] },
      { label: "5~10년", min: 2016, max: 2020, rets: [] },
      { label: "10~20년", min: 2006, max: 2015, rets: [] },
      { label: "20~30년", min: 1996, max: 2005, rets: [] },
      { label: "30년 이상", min: 0, max: 1995, rets: [] },
    ];
    for (const s of scored) {
      const y = s.row.buildYear;
      if (!y) continue;
      const b = buckets.find((x) => y >= x.min && y <= x.max);
      if (b) b.rets.push(s.m.ret);
    }
    return buckets
      .filter((b) => b.rets.length >= 3)
      .map((b) => ({
        label: b.label,
        n: b.rets.length,
        med: [...b.rets].sort((x, y) => x - y)[Math.floor(b.rets.length / 2)],
      }));
  }, [scored]);

  const peakMonths = useMemo(() => {
    if (!scored) return [];
    const byYear = new Map<number, number>();
    for (const s of scored) byYear.set(Math.floor(s.m.tMax / 12), (byYear.get(Math.floor(s.m.tMax / 12)) ?? 0) + 1);
    return [...byYear.entries()].sort((a, b) => a[0] - b[0]);
  }, [scored]);

  if (!meta || !region) return <SkeletonRows count={8} />;

  const maxVol = Math.max(...volume.map((v) => v[1]), 1);
  const maxPeak = Math.max(...peakMonths.map((v) => v[1]), 1);

  return (
    <main className="pb-16">
      <header className="sticky top-0 z-20 border-b border-grey-100 bg-white/95 px-5 pb-3 pt-4 backdrop-blur">
        <div className="flex items-center gap-2">
          <Link href="/" aria-label="홈으로" className="-ml-2 rounded-full p-2 active:bg-grey-100">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-grey-700">
              <path d="M12.5 4l-6 6 6 6" stroke="currentColor" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <h1 className="text-[20px] font-bold text-grey-900">대시보드</h1>
        </div>
        <button
          onClick={() => setPeriodOpen(true)}
          className="mt-1 flex items-center gap-1 text-[14px] font-medium text-grey-700"
        >
          {formatMonth(period.t0)} ~ {formatMonth(period.t1)}
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" className="text-grey-600">
            <path d="M5.5 8l4.5 4.5L14.5 8" stroke="currentColor" strokeWidth="1.8"
                  strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      {/* ① 구별 순위 */}
      <Section title="어느 동네가 올랐나" sub="구별 시세 지수의 기간 변화">
        <div className="space-y-1.5 px-5">
          {guStats.map((g, i) => {
            const maxAbs = Math.max(...guStats.map((x) => Math.abs(x.ret)), 0.01);
            const w = (Math.abs(g.ret) / maxAbs) * 100;
            return (
              <button
                key={g.code}
                onClick={() => setParam({ sgg: g.code })}
                className={`flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left ${
                  g.code === focusGu ? "bg-blue-50" : "active:bg-grey-50"
                }`}
              >
                <span className="w-5 shrink-0 text-[12px] font-bold tabular-nums text-grey-600">
                  {i + 1}
                </span>
                <span className="w-[52px] shrink-0 text-[13px] font-bold text-grey-900">
                  {g.name}
                </span>
                <span className="relative h-5 flex-1 overflow-hidden rounded-[4px] bg-grey-100">
                  <span
                    className={`absolute inset-y-0 left-0 rounded-[4px] ${
                      g.ret >= 0 ? "bg-up-500/85" : "bg-down-500/85"
                    }`}
                    style={{ width: `${w}%` }}
                  />
                </span>
                <span
                  className={`w-[70px] shrink-0 text-right text-[13px] font-bold tabular-nums ${trendColor(g.ret)}`}
                >
                  {formatPctArrow(g.ret)}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* ② 거래량 */}
      <Section title="시장이 얼어붙은 때" sub="연도별 아파트 매매 거래 건수">
        <div className="px-5">
          <div className="flex h-[120px] items-end gap-[3px]">
            {volume.map(([y, n]) => (
              <div key={y} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full rounded-t-[2px] bg-blue-500/80"
                  style={{ height: `${Math.max(2, (n / maxVol) * 100)}%` }}
                  title={`${y}년 ${n.toLocaleString()}건`}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[11px] font-medium text-grey-700">
            <span>{volume[0]?.[0]}년</span>
            <span>{volume[volume.length - 1]?.[0]}년</span>
          </div>
        </div>
      </Section>

      {/* ③ 선택 구 상세 */}
      <div className="mt-8 border-t-8 border-grey-100 pt-2">
        <div className="scrollbar-none flex gap-2 overflow-x-auto px-5 py-4">
          {Object.entries(SEOUL_GU).map(([code, name]) => (
            <button
              key={code}
              onClick={() => setParam({ sgg: code })}
              className={`shrink-0 rounded-full px-3.5 py-2 text-[14px] font-bold ${
                code === focusGu ? "bg-grey-900 text-white" : "bg-grey-100 text-grey-800"
              }`}
            >
              {name}
            </button>
          ))}
        </div>

        {!scored ? (
          <SkeletonRows count={4} />
        ) : scored.length < 5 ? (
          <p className="px-5 py-8 text-center text-[14px] text-grey-700">
            이 기간 {SEOUL_GU[focusGu]}에는 분석할 만큼 거래가 있는 단지가 적어요.
          </p>
        ) : (
          <>
            <Section
              title={`${SEOUL_GU[focusGu]} 단지별 성적 분포`}
              sub={`순위 대상 ${scored.length.toLocaleString()}곳 · 오른쪽일수록 많이 오른 단지`}
            >
              <div className="px-5">
                <Histogram values={scored.map((s) => s.m.ret)} />
              </div>
            </Section>

            <Section
              title="많이 흔들렸나, 조용히 올랐나"
              sub="가로는 최저~최고 변동폭, 세로는 기간 수익률"
            >
              <div className="px-5">
                <Scatter
                  points={scored.map((s) => ({
                    x: s.m.volatility,
                    y: s.m.ret,
                    id: s.row.id,
                    label: s.row.name,
                  }))}
                  onSelect={(id) =>
                    router.push(`/rank?sgg=${focusGu}&${periodToQuery(period)}&complex=${id}`)
                  }
                />
                <p className="mt-2 text-[12px] leading-relaxed text-grey-700">
                  왼쪽 위는 크게 출렁이지 않고 오른 단지, 오른쪽 위는 롤러코스터를 탄 뒤 오른
                  단지예요. 점을 누르면 그 단지로 갈 수 있어요.
                </p>
              </div>
            </Section>

            {byAge.length > 1 && (
              <Section title="신축이 더 올랐을까" sub="준공 연차별 수익률 중앙값">
                <div className="space-y-2 px-5">
                  {byAge.map((b) => {
                    const maxAbs = Math.max(...byAge.map((x) => Math.abs(x.med)), 0.01);
                    return (
                      <div key={b.label} className="flex items-center gap-2">
                        <span className="w-[62px] shrink-0 text-[13px] font-semibold text-grey-800">
                          {b.label}
                        </span>
                        <span className="relative h-6 flex-1 overflow-hidden rounded-[4px] bg-grey-100">
                          <span
                            className={`absolute inset-y-0 left-0 rounded-[4px] ${
                              b.med >= 0 ? "bg-up-500/85" : "bg-down-500/85"
                            }`}
                            style={{ width: `${(Math.abs(b.med) / maxAbs) * 100}%` }}
                          />
                        </span>
                        <span className={`w-[64px] shrink-0 text-right text-[13px] font-bold tabular-nums ${trendColor(b.med)}`}>
                          {formatPct(b.med)}
                        </span>
                        <span className="w-9 shrink-0 text-right text-[11px] text-grey-600">
                          {b.n}곳
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}

            {peakMonths.length > 1 && (
              <Section title="언제가 고점이었나" sub="단지별 최고가 시점이 몰린 해">
                <div className="px-5">
                  <div className="flex h-[90px] items-end gap-1">
                    {peakMonths.map(([y, n]) => (
                      <div key={y} className="flex flex-1 flex-col items-center">
                        <div
                          className="w-full rounded-t-[2px] bg-up-500/80"
                          style={{ height: `${Math.max(3, (n / maxPeak) * 100)}%` }}
                          title={`${y}년 ${n}곳`}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex justify-between text-[11px] font-medium text-grey-700">
                    <span>{peakMonths[0][0]}년</span>
                    <span>{peakMonths[peakMonths.length - 1][0]}년</span>
                  </div>
                </div>
              </Section>
            )}

            <Section title="양 끝" sub="이 기간 가장 많이 오른 곳과 내린 곳">
              <div className="space-y-1 px-5">
                {[...scored].sort((a, b) => b.m.ret - a.m.ret).slice(0, 3).map((s) => (
                  <ExtremeRow key={s.row.id} s={s} gu={focusGu} period={period} />
                ))}
                <div className="py-1 text-center text-[12px] text-grey-600">⋯</div>
                {[...scored].sort((a, b) => a.m.ret - b.m.ret).slice(0, 3).reverse().map((s) => (
                  <ExtremeRow key={s.row.id} s={s} gu={focusGu} period={period} />
                ))}
              </div>
            </Section>
          </>
        )}
      </div>

      <p className="mt-8 px-5 text-[11px] leading-relaxed text-grey-600">
        국토교통부 실거래가 · 평당가는 전용면적 기준 · 거래가 적은 단지는 분석에서 제외했어요
      </p>

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
    </main>
  );
}

function Section({
  title, sub, children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="pt-7">
      <div className="px-5 pb-3">
        <h2 className="text-[17px] font-bold text-grey-900">{title}</h2>
        {sub && <p className="mt-1 text-[13px] text-grey-700">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function ExtremeRow({
  s, gu, period,
}: {
  s: { row: ComplexRow; m: MetricResult };
  gu: string;
  period: Period;
}) {
  return (
    <Link
      href={`/rank?sgg=${gu}&${periodToQuery(period)}&complex=${s.row.id}`}
      className="flex items-center gap-2 rounded-[10px] px-2 py-2 active:bg-grey-50"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-bold text-grey-900">{s.row.name}</span>
        <span className="block truncate text-[12px] text-grey-700">
          {s.row.dong} · 전용 평당 {formatPpa(s.m.pEnd)}
        </span>
      </span>
      <span className={`shrink-0 text-[15px] font-bold tabular-nums ${trendColor(s.m.ret)}`}>
        {formatPctArrow(s.m.ret)}
      </span>
    </Link>
  );
}
