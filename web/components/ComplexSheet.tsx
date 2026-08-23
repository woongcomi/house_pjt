"use client";

import { useEffect, useMemo, useState } from "react";
import { BottomSheet } from "./toss/BottomSheet";
import { LineChart } from "./chart/LineChart";
import { ComplexMap } from "./map/ComplexMap";
import { compute, type MetricResult } from "@/lib/metrics";
import { loadAreas } from "@/lib/loader";
import type { AreaRow, ComplexRow } from "@/lib/series";
import type { Period } from "@/lib/period";
import {
  formatAmount, formatMonth, formatPct, formatPctAbs, formatPercentile, formatPpa, trendColor,
} from "@/lib/format";

/**
 * 단지 상세.
 *
 * '변동폭', '고점 대비' 같은 지표 이름만 늘어놓으면 무슨 뜻인지 전달되지 않는다.
 * 숫자를 문장 안에 넣고, 차트를 위로 올려 먼저 그림으로 이해시킨 뒤 숫자를 준다.
 */
export function ComplexSheet({
  open, onClose, row, sgg, period, rankRow, total, regionName,
}: {
  open: boolean;
  onClose: () => void;
  row: ComplexRow;
  sgg: string;
  period: Period;
  rankRow: { rank: number; percentile: number } | null;
  total: number;
  regionName: string;
}) {
  const [areas, setAreas] = useState<AreaRow[] | null>(null);
  const [bucket, setBucket] = useState<number | null>(null);

  useEffect(() => {
    setBucket(null);
    loadAreas(sgg)
      .then((m) => setAreas(m.get(row.id) ?? []))
      .catch(() => setAreas([]));
  }, [sgg, row.id]);

  // 면적 토글: null 이면 단지 전체(믹스보정 지수), 아니면 해당 타입 원본 시세
  const active = useMemo(() => {
    if (bucket === null) return { series: row.series, amount: row.amount };
    const a = areas?.find((x) => x.bucketId === bucket);
    return a ? { series: a.series, amount: a.amount } : { series: row.series, amount: row.amount };
  }, [bucket, areas, row]);

  const m: MetricResult = useMemo(
    () => compute(active.series, period.t0, period.t1),
    [active.series, period.t0, period.t1],
  );

  const amountAt = (t: number) => {
    const i = active.series.t.indexOf(t);
    return i >= 0 ? active.amount[i] : 0;
  };

  const points = useMemo(
    () => active.series.t.map((t, i) => ({ t, p: active.series.p[i], n: active.series.n[i] })),
    [active.series],
  );

  const startAmt = amountAt(m.tStart);
  const endAmt = amountAt(m.tEnd);
  const maxAmt = amountAt(m.tMax);
  const minAmt = amountAt(m.tMin);
  const up = m.ret >= 0;

  return (
    <BottomSheet open={open} onClose={onClose} title={row.name}>
      <p className="px-5 pb-3 text-[13px] text-grey-700">
        {regionName} {row.dong}
        {row.buildYear ? ` · ${row.buildYear}년 준공` : ""}
      </p>

      {!m.ok ? (
        <div className="px-5 py-12 text-center">
          <p className="text-[16px] font-bold text-grey-900">이 기간엔 거래가 없었어요</p>
          <p className="mt-2 text-[14px] leading-relaxed text-grey-700">
            {row.series.t.length > 0 ? (
              <>
                마지막 거래는 {formatMonth(row.series.t[row.series.t.length - 1])}이에요.
                <br />
                기간을 넓히면 볼 수 있어요.
              </>
            ) : (
              "실거래 기록이 없어요."
            )}
          </p>
        </div>
      ) : (
        <>
          {/* ① 한눈에 — 얼마에서 얼마로, 얼마나 */}
          <div className="px-5">
            <div className="flex items-baseline gap-2">
              <span
                className={`text-[34px] font-bold leading-none tracking-tight ${trendColor(m.ret)}`}
              >
                {up ? "▲" : "▼"} {formatPctAbs(m.ret)}
              </span>
              <span className="text-[15px] font-semibold text-grey-700">
                {up ? "올랐어요" : "내렸어요"}
              </span>
            </div>

            {startAmt > 0 && endAmt > 0 && (
              <div className="mt-3 text-[19px] font-bold tracking-tight text-grey-900">
                {formatAmount(startAmt)}
                <span className="mx-1.5 text-grey-600">→</span>
                {formatAmount(endAmt)}
              </div>
            )}

            <div className="mt-1.5 text-[13px] text-grey-700">
              {formatMonth(m.tStart)} → {formatMonth(m.tEnd)}
              {(m.modeStart !== "exact" || m.modeEnd !== "exact") && (
                <span className="text-grey-600"> · 거래가 있던 달 기준</span>
              )}
            </div>
          </div>

          {/* ② 그림으로 먼저 */}
          <div className="mt-5 px-2">
            <LineChart
              points={points}
              t0={period.t0}
              t1={period.t1}
              tMax={m.tMax}
              tMin={m.tMin}
              height={200}
            />
          </div>

          {/* 면적 타입 */}
          {areas && areas.length > 1 && (
            <div className="scrollbar-none mt-1 flex gap-2 overflow-x-auto px-5 pb-1">
              <TypeChip active={bucket === null} onClick={() => setBucket(null)}>
                전체
              </TypeChip>
              {areas.map((a) => (
                <TypeChip
                  key={a.bucketId}
                  active={bucket === a.bucketId}
                  onClick={() => setBucket(a.bucketId)}
                >
                  {a.label}
                </TypeChip>
              ))}
            </div>
          )}

          {/* ③ 고점·저점을 문장으로 */}
          <div className="mx-5 mt-5 overflow-hidden rounded-[14px] border border-grey-200">
            <div className="border-b border-grey-200 bg-grey-50 px-4 py-2.5 text-[13px] font-bold text-grey-800">
              이 기간 안에서
            </div>

            <PriceRow
              icon="▲"
              iconClass="text-up-500"
              label="가장 비쌌을 때"
              when={formatMonth(m.tMax)}
              amount={maxAmt}
              ppa={m.pMax}
            />
            <PriceRow
              icon="▼"
              iconClass="text-down-500"
              label="가장 쌌을 때"
              when={formatMonth(m.tMin)}
              amount={minAmt}
              ppa={m.pMin}
              last
            />

            <div className="border-t border-grey-200 bg-grey-50 px-4 py-3">
              <div className="text-[13px] text-grey-800">
                가장 쌌을 때와 비쌌을 때의 차이{" "}
                <strong className="font-bold text-grey-900">
                  {formatPctAbs(m.volatility)}
                </strong>
              </div>
            </div>
          </div>

          {/* ④ 지금 위치 */}
          <div className="mx-5 mt-3 overflow-hidden rounded-[14px] border border-grey-200">
            <div className="border-b border-grey-200 bg-grey-50 px-4 py-2.5 text-[13px] font-bold text-grey-800">
              {formatMonth(m.tEnd)} 지금은
            </div>
            <CompareRow
              label="가장 비쌌을 때보다"
              value={m.drawdown}
              zeroText="그때가 지금이에요"
            />
            <CompareRow
              label="가장 쌌을 때보다"
              value={m.recovery}
              zeroText="그때가 지금이에요"
              last
            />
          </div>

          {/* ⑤ 위치 */}
          <div className="mt-5 px-5">
            <div className="pb-2 text-[13px] font-bold text-grey-800">위치</div>
            <ComplexMap
              lat={row.lat}
              lng={row.lng}
              name={row.name}
              ret={m.ret}
              height={190}
            />
          </div>

          {/* ⑥ 순위 */}
          {rankRow && bucket === null && (
            <div className="mx-5 mt-3 rounded-[14px] bg-blue-50 px-4 py-3.5">
              <div className="text-[15px] font-bold text-blue-700">
                {regionName} {total.toLocaleString()}곳 중 {rankRow.rank}위
              </div>
              <div className="mt-0.5 text-[12px] font-medium text-blue-600">
                {formatPercentile(rankRow.percentile)} · 거래가 충분한 단지끼리 비교했어요
              </div>
            </div>
          )}

          {/* ⑦ 근거와 한계 */}
          <div className="mx-5 mt-3 rounded-[14px] bg-grey-50 px-4 py-3">
            <div className="flex items-center justify-between text-[12px] font-semibold text-grey-800">
              <span>이 기간 거래 {m.nTrades}건 · 시세가 잡힌 달 {m.nObs}개월</span>
              <span
                className={
                  m.confidence === "A"
                    ? "text-blue-600"
                    : m.confidence === "B"
                      ? "text-grey-700"
                      : "text-up-600"
                }
              >
                {m.confidence === "A" ? "표본 충분" : m.confidence === "B" ? "표본 보통" : "표본 부족"}
              </span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-grey-700">
              단지 전체의 중간 시세예요. 개별 세대는 층·향·상태에 따라 달라요.
              <br />
              평당가는 <strong className="font-semibold text-grey-800">전용면적 기준</strong>이라
              공급면적으로 표기하는 곳보다 높게 보여요.
              {bucket === null && areas && areas.length > 1 && (
                <>
                  <br />
                  &lsquo;전체&rsquo;는 달마다 거래된 평형이 달라 생기는 착시를 걷어낸 값이에요.
                </>
              )}
              {m.confidence === "C" && (
                <>
                  <br />
                  <strong className="font-bold text-up-600">
                    거래가 적어 참고용으로만 봐주세요.
                  </strong>
                </>
              )}
            </p>
          </div>

          <div className="h-8" />
        </>
      )}
    </BottomSheet>
  );
}

function PriceRow({
  icon, iconClass, label, when, amount, ppa, last,
}: {
  icon: string;
  iconClass: string;
  label: string;
  when: string;
  amount: number;
  ppa: number;
  last?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${last ? "" : "border-b border-grey-100"}`}>
      <span className={`text-[13px] font-bold ${iconClass}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-grey-900">{label}</div>
        <div className="mt-0.5 text-[12px] text-grey-700">{when}</div>
      </div>
      <div className="text-right">
        <div className="text-[15px] font-bold text-grey-900">
          {amount > 0 ? formatAmount(amount) : formatPpa(ppa)}
        </div>
        {amount > 0 && (
          <div className="mt-0.5 text-[11px] text-grey-700">평당 {formatPpa(ppa)}</div>
        )}
      </div>
    </div>
  );
}

function CompareRow({
  label, value, zeroText, last,
}: {
  label: string;
  value: number;
  zeroText: string;
  last?: boolean;
}) {
  const zero = Math.abs(value) < 0.0005;
  return (
    <div
      className={`flex items-center justify-between px-4 py-3 ${
        last ? "" : "border-b border-grey-100"
      }`}
    >
      <span className="text-[14px] font-medium text-grey-800">{label}</span>
      {zero ? (
        <span className="text-[13px] font-semibold text-grey-700">{zeroText}</span>
      ) : (
        <span className={`text-[17px] font-bold tabular-nums ${trendColor(value)}`}>
          {value > 0 ? "▲" : "▼"} {formatPctAbs(value)}
        </span>
      )}
    </div>
  );
}

function TypeChip({
  active, children, onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full px-3.5 py-2 text-[13px] font-bold ${
        active ? "bg-grey-900 text-white" : "bg-grey-100 text-grey-800"
      }`}
    >
      {children}
    </button>
  );
}
