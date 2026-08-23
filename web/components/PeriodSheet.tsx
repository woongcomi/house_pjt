"use client";

import { useEffect, useRef, useState } from "react";
import { BottomSheet, PrimaryButton } from "./toss/BottomSheet";
import { Chip } from "./toss/primitives";
import { PRESETS, matchPreset, type Period } from "@/lib/period";
import { formatDuration } from "@/lib/format";

/**
 * 기간 선택.
 *
 * 월 단위 슬라이더 두 개로는 245개월 중 원하는 달을 정확히 짚을 수 없다.
 * '시작 / 끝' 을 탭으로 전환하고 연도·월을 격자에서 직접 고르게 바꿨다.
 * 위쪽 타임라인 막대가 지금 어느 구간을 보고 있는지 한눈에 알려준다.
 */
export function PeriodSheet({
  open, onClose, value, onChange, first, last,
}: {
  open: boolean;
  onClose: () => void;
  value: Period;
  onChange: (p: Period) => void;
  first: number;
  last: number;
}) {
  const [draft, setDraft] = useState<Period>(value);
  const [edge, setEdge] = useState<"start" | "end">("start");
  const yearRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setDraft(value);
      setEdge("start");
    }
  }, [open, value]);

  const firstYear = Math.floor(first / 12);
  const lastYear = Math.floor(last / 12);
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i);

  const cur = edge === "start" ? draft.t0 : draft.t1;
  const curYear = Math.floor(cur / 12);
  const curMonth = (cur % 12) + 1;

  // 선택한 연도가 보이도록 스크롤
  useEffect(() => {
    if (!open) return;
    const el = yearRef.current?.querySelector<HTMLElement>(`[data-year="${curYear}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [open, curYear]);

  const setEdgeValue = (t: number) => {
    const clamped = Math.max(first, Math.min(t, last));
    setDraft((d) =>
      edge === "start"
        ? { t0: Math.min(clamped, d.t1), t1: d.t1 }
        : { t0: d.t0, t1: Math.max(clamped, d.t0) },
    );
  };

  const activePreset = matchPreset(draft, last, first);
  const months = draft.t1 - draft.t0;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="기간 고르기"
      footer={
        <PrimaryButton onClick={() => { onChange(draft); onClose(); }} disabled={months < 1}>
          {months < 1 ? "1개월 이상 골라주세요" : `${formatDuration(months)} 보기`}
        </PrimaryButton>
      }
    >
      {/* 자주 쓰는 기간 */}
      <div className="scrollbar-none flex gap-2 overflow-x-auto px-5 pb-4">
        {PRESETS.map((p) => (
          <Chip
            key={p.key}
            active={activePreset === p.key}
            onClick={() => {
              const q = p.make(last, first);
              setDraft({
                t0: Math.max(first, Math.min(q.t0, last)),
                t1: Math.max(first, Math.min(q.t1, last)),
              });
            }}
          >
            {p.label}
          </Chip>
        ))}
      </div>

      {/* 타임라인 — 전체 구간 중 어디를 보고 있는지 */}
      <div className="px-5 pb-4">
        <div className="relative h-2 rounded-full bg-grey-200">
          <div
            className="absolute h-2 rounded-full bg-blue-500"
            style={{
              left: `${((draft.t0 - first) / Math.max(1, last - first)) * 100}%`,
              width: `${((draft.t1 - draft.t0) / Math.max(1, last - first)) * 100}%`,
            }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] font-medium text-grey-600">
          <span>{firstYear}년</span>
          <span>{lastYear}년</span>
        </div>
      </div>

      {/* 시작 / 끝 전환 */}
      <div className="mx-5 grid grid-cols-2 gap-2 rounded-[14px] bg-grey-100 p-1.5">
        {(["start", "end"] as const).map((e) => {
          const t = e === "start" ? draft.t0 : draft.t1;
          const on = edge === e;
          return (
            <button
              key={e}
              onClick={() => setEdge(e)}
              className={`rounded-[10px] px-3 py-3 text-center transition-colors ${
                on ? "bg-white shadow-sm" : ""
              }`}
            >
              <div className={`text-[12px] font-semibold ${on ? "text-blue-600" : "text-grey-600"}`}>
                {e === "start" ? "시작" : "끝"}
              </div>
              <div
                className={`mt-0.5 text-[17px] font-bold ${
                  on ? "text-grey-900" : "text-grey-700"
                }`}
              >
                {Math.floor(t / 12)}.{String((t % 12) + 1).padStart(2, "0")}
              </div>
            </button>
          );
        })}
      </div>

      <div className="px-5 pb-2 pt-5 text-[13px] font-semibold text-grey-700">
        {edge === "start" ? "시작" : "끝"} 연도
      </div>
      <div ref={yearRef} className="scrollbar-none flex gap-2 overflow-x-auto px-5 pb-1">
        {years.map((y) => (
          <button
            key={y}
            data-year={y}
            onClick={() => setEdgeValue(y * 12 + (curMonth - 1))}
            className={`shrink-0 rounded-[10px] px-3.5 py-2.5 text-[15px] font-bold tabular-nums ${
              y === curYear ? "bg-blue-500 text-white" : "bg-grey-100 text-grey-800"
            }`}
          >
            {y}
          </button>
        ))}
      </div>

      <div className="px-5 pb-2 pt-5 text-[13px] font-semibold text-grey-700">월</div>
      <div className="grid grid-cols-6 gap-2 px-5 pb-8">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((mo) => {
          const t = curYear * 12 + (mo - 1);
          const disabled = t < first || t > last;
          return (
            <button
              key={mo}
              disabled={disabled}
              onClick={() => setEdgeValue(t)}
              className={`rounded-[10px] py-2.5 text-[15px] font-bold tabular-nums ${
                disabled
                  ? "bg-grey-50 text-grey-400"
                  : mo === curMonth
                    ? "bg-blue-500 text-white"
                    : "bg-grey-100 text-grey-800"
              }`}
            >
              {mo}
            </button>
          );
        })}
      </div>
    </BottomSheet>
  );
}
