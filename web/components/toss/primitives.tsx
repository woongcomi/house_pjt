"use client";

import { type ReactNode } from "react";

/* ── 카드 ────────────────────────────────────────── */
export function Card({
  children, className = "", onClick,
}: { children: ReactNode; className?: string; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`w-full rounded-[16px] bg-white p-5 text-left ${
        onClick ? "active:scale-[0.985] transition-transform duration-150" : ""
      } ${className}`}
    >
      {children}
    </Tag>
  );
}

/**
 * 지표 카드.
 * 숫자를 먼저 크게, 설명은 작게 아래로. 각 카드에 한 줄 해설을 붙여
 * '-9.4%' 같은 숫자가 무엇 대비인지 오해가 없게 한다.
 */
export function StatCard({
  label, value, valueClass = "text-grey-900", caption, sub, onClick,
}: {
  label: string;
  value: string;
  valueClass?: string;
  caption?: string;
  sub?: string;
  onClick?: () => void;
}) {
  return (
    <Card onClick={onClick} className="bg-grey-50 p-4">
      <div className="text-[13px] font-medium text-grey-600">{label}</div>
      <div className={`mt-1 text-[24px] font-bold tracking-tight ${valueClass}`}>
        {value}
      </div>
      {caption && <div className="mt-0.5 text-[12px] text-grey-700">{caption}</div>}
      {sub && <div className="mt-2 text-[12px] font-medium text-blue-500">{sub}</div>}
    </Card>
  );
}

/* ── 리스트 행 ───────────────────────────────────── */
export function ListRow({
  leading, title, subtitle, value, valueClass = "text-grey-900", trailing, onClick,
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  valueClass?: string;
  trailing?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 px-5 py-3.5 text-left active:bg-grey-50"
    >
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold text-grey-900">{title}</div>
        {subtitle && (
          <div className="mt-0.5 truncate text-[13px] text-grey-700">{subtitle}</div>
        )}
      </div>
      {value !== undefined && (
        <div className={`shrink-0 text-[15px] font-bold tabular-nums ${valueClass}`}>
          {value}
        </div>
      )}
      {trailing}
    </button>
  );
}

/* ── 칩 (기간 프리셋 등) ─────────────────────────── */
export function Chip({
  active, children, onClick,
}: { active?: boolean; children: ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full px-3.5 py-2 text-[14px] font-semibold transition-colors ${
        active
          ? "bg-grey-900 text-white"
          : "bg-grey-100 text-grey-700 active:bg-grey-200"
      }`}
    >
      {children}
    </button>
  );
}

/* ── 탭 (정렬 지표 전환) ─────────────────────────── */
export function Tabs<T extends string>({
  items, value, onChange,
}: {
  items: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="scrollbar-none flex gap-2 overflow-x-auto px-5 py-1">
      {items.map((it) => (
        <Chip key={it.key} active={value === it.key} onClick={() => onChange(it.key)}>
          {it.label}
        </Chip>
      ))}
    </div>
  );
}

/* ── 신뢰도 배지 ─────────────────────────────────── */
export function ConfidenceBadge({
  level, trades,
}: { level: "A" | "B" | "C"; trades: number }) {
  const style = {
    A: "bg-blue-50 text-blue-600",
    B: "bg-grey-100 text-grey-600",
    C: "bg-up-50 text-up-600",
  }[level];
  const text = {
    A: "표본 충분",
    B: "표본 보통",
    C: "표본 부족",
  }[level];
  return (
    <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${style}`}>
      {text} · {trades}건
    </span>
  );
}

/* ── 섹션 헤더 ───────────────────────────────────── */
export function SectionTitle({
  children, sub,
}: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="px-5 pb-2 pt-6">
      <h2 className="text-[17px] font-bold text-grey-900">{children}</h2>
      {sub && <p className="mt-1 text-[13px] text-grey-700">{sub}</p>}
    </div>
  );
}

/* ── 스켈레톤 ────────────────────────────────────── */
export function SkeletonRows({ count = 8 }: { count?: number }) {
  return (
    <div className="space-y-3 px-5 py-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="skeleton h-6 w-6 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <div className="skeleton h-4 w-2/5 rounded" />
            <div className="skeleton h-3 w-1/4 rounded" />
          </div>
          <div className="skeleton h-5 w-16 rounded" />
        </div>
      ))}
    </div>
  );
}

/* ── 안내 배너 ───────────────────────────────────── */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="mx-5 my-3 rounded-[12px] bg-grey-50 px-4 py-3 text-[12px] leading-relaxed text-grey-600">
      {children}
    </div>
  );
}
