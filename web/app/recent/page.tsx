"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { loadRecent, type RecentFile } from "@/lib/loader";
import { GYEONGGI_GU, SEOUL_GU, SIDO_OF, guName } from "@/lib/seoul";
import { formatAmount, formatPpa, toPyeong } from "@/lib/format";
import { BottomSheet } from "@/components/toss/BottomSheet";
import { Chip, ListRow, Notice, SkeletonRows } from "@/components/toss/primitives";

/**
 * 최근 거래 피드.
 *
 * 순위·대시보드가 "기간 동안 얼마나 올랐나"를 보는 화면이라면, 여기는
 * "지금 무슨 거래가 체결되고 있나"를 보는 화면이다. 같은 단지·같은 면적형의
 * 직전 1년 중위가보다 눈에 띄게 싸게 팔린 거래를 '저가'로 표시한다.
 */
export default function RecentPage() {
  return (
    <Suspense fallback={<SkeletonRows count={10} />}>
      <RecentContent />
    </Suspense>
  );
}

type Row = RecentFile["rows"][number];
const PAGE = 120;

/** URL 의 area 값: all | seoul | sin(신분당선 전체) | st:역이름 | 시군구코드 */
function areaLabel(area: string): string {
  if (area === "all") return "전체";
  if (area === "seoul") return "서울 전체";
  if (area === "sin") return "신분당선 역세권";
  if (area.startsWith("st:")) return `${area.slice(3)}역`;
  return guName(area);
}

function inArea(area: string, r: Row): boolean {
  if (area === "all") return true;
  if (area === "seoul") return r[1].startsWith("11");
  if (area === "sin") return r[11].length > 0;
  if (area.startsWith("st:")) return r[11].includes(area.slice(3));
  return r[1] === area;
}

function daysAgo(today: string, d: string): number {
  return Math.round((Date.parse(today) - Date.parse(d)) / 86400000);
}

function RecentContent() {
  const router = useRouter();
  const params = useSearchParams();
  const area = params.get("area") ?? "sin";
  const lowOnly = params.get("low") === "1";
  const openCid = params.get("complex");

  const [data, setData] = useState<RecentFile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [areaOpen, setAreaOpen] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    loadRecent().then(setData).catch((e) => setErr(String(e)));
  }, []);

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      router.replace(`/recent?${next.toString()}`, { scroll: false });
    },
    [params, router],
  );

  const isLow = useCallback(
    (r: Row) => r[9] !== null && r[9] <= (data?.lowPct ?? -10),
    [data],
  );

  const scoped = useMemo(
    () => (data ? data.rows.filter((r) => inArea(area, r)) : []),
    [data, area],
  );
  const shown = useMemo(
    () => (lowOnly ? scoped.filter(isLow) : scoped),
    [scoped, lowOnly, isLow],
  );

  const stats = useMemo(() => {
    if (!data) return null;
    const last30 = scoped.filter((r) => daysAgo(data.today, r[0]) <= 30);
    return {
      n30: last30.length,
      low30: last30.filter(isLow).length,
      lowAll: scoped.filter(isLow).length,
    };
  }, [data, scoped, isLow]);

  useEffect(() => { setLimit(PAGE); }, [area, lowOnly]);

  const openRows = useMemo(
    () => (data && openCid ? data.rows.filter((r) => r[3] === openCid) : []),
    [data, openCid],
  );

  return (
    <main className="pb-16">
      <header className="sticky top-0 z-20 border-b border-grey-100 bg-white/95 backdrop-blur">
        <div className="flex items-center gap-2 px-5 pb-2 pt-4">
          <Link href="/" aria-label="홈으로" className="-ml-2 rounded-full p-2 active:bg-grey-100">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-grey-700">
              <path d="M12.5 4l-6 6 6 6" stroke="currentColor" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <button
            onClick={() => setAreaOpen(true)}
            className="flex items-center gap-1 text-[20px] font-bold text-grey-900"
          >
            {areaLabel(area)}
            <Caret />
          </button>
        </div>
        <div className="flex items-center gap-2 px-5 pb-3">
          <span className="text-[14px] font-medium text-grey-600">
            최근 {data?.days ?? 90}일 거래
          </span>
          <div className="ml-auto flex gap-2">
            <Chip active={!lowOnly} onClick={() => setParam({ low: null })}>전체</Chip>
            <Chip active={lowOnly} onClick={() => setParam({ low: "1" })}>저가 거래만</Chip>
          </div>
        </div>
      </header>

      {err && (
        <p className="p-6 text-[14px] text-grey-600">
          최근 거래 데이터가 아직 준비되지 않았어요. 다음 갱신 때 채워져요.
          <span className="mt-1 block text-[11px] text-grey-500">{err}</span>
        </p>
      )}
      {!data && !err && <SkeletonRows count={10} />}

      {data && stats && (
        <>
          <div className="mx-5 mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-[16px] bg-grey-50 p-4">
              <div className="text-[13px] font-medium text-grey-600">최근 30일 계약</div>
              <div className="mt-1 text-[24px] font-bold tracking-tight text-grey-900">
                {stats.n30.toLocaleString()}건
              </div>
              <div className="mt-0.5 text-[12px] text-grey-700">신고된 것만 · 계속 늘어나요</div>
            </div>
            <div className="rounded-[16px] bg-down-50 p-4">
              <div className="text-[13px] font-medium text-down-600">저가 거래</div>
              <div className="mt-1 text-[24px] font-bold tracking-tight text-down-600">
                {stats.low30.toLocaleString()}건
              </div>
              <div className="mt-0.5 text-[12px] text-down-600/80">
                최근 30일 · 90일 누적 {stats.lowAll.toLocaleString()}건
              </div>
            </div>
          </div>

          <Notice>
            <strong className="font-semibold text-grey-700">저가 거래</strong>는 같은 단지·같은
            면적형의 직전 1년 거래 중위가보다{" "}
            <strong className="font-semibold text-grey-700">{Math.abs(data.lowPct)}% 이상</strong>{" "}
            싸게 계약된 거래예요. 직전 1년 거래가 {data.refMinDeals}건 미만이면 판정하지 않아요.
            직거래는 증여·특수관계 거래일 수 있어 따로 표시해요.
          </Notice>

          {shown.length === 0 && (
            <p className="px-5 py-10 text-center text-[14px] text-grey-600">
              해당하는 거래가 아직 없어요
            </p>
          )}

          <div className="mt-2">
            {shown.slice(0, limit).map((r, i) => (
              <DealRow key={`${r[3]}-${r[0]}-${i}`} r={r} area={area} low={isLow(r)}
                       onClick={() => setParam({ complex: r[3] })} />
            ))}
          </div>

          {shown.length > limit && (
            <button
              onClick={() => setLimit((l) => l + PAGE)}
              className="mx-5 mt-3 w-[calc(100%-2.5rem)] rounded-[12px] bg-grey-100 py-3.5 text-[14px] font-semibold text-grey-800 active:bg-grey-200"
            >
              더 보기 ({(shown.length - limit).toLocaleString()}건 남음)
            </button>
          )}

          <footer className="mt-10 px-5 text-[11px] leading-relaxed text-grey-600">
            {data.today} 기준 · 국토교통부 실거래가 · 해제된 거래 제외
            <br />
            실거래 신고 기한은 계약일로부터 30일이라 최근 한 달은 건수가 계속 늘어나요.
          </footer>
        </>
      )}

      <AreaSheet open={areaOpen} onClose={() => setAreaOpen(false)} value={area}
                 stations={data?.stations ?? []}
                 onChange={(a) => setParam({ area: a === "sin" ? null : a })} />

      <BottomSheet
        open={!!openCid && openRows.length > 0}
        onClose={() => setParam({ complex: null })}
        title={openRows[0]?.[4]}
      >
        <div className="px-5 pb-1 text-[13px] text-grey-700">
          {openRows[0] && `${guName(openRows[0][1])} ${openRows[0][2]}`}
          {openRows[0]?.[11].length ? ` · ${openRows[0][11].map((s) => `${s}역`).join("·")}` : ""}
          {" · "}최근 {data?.days}일 {openRows.length}건
        </div>
        <div className="pb-2">
          {openRows.map((r, i) => (
            <DealRow key={i} r={r} area="all" low={isLow(r)} compact />
          ))}
        </div>
        {openRows[0] && (
          <div className="px-5 pb-6 pt-2">
            <Link
              href={`/rank?sgg=${openRows[0][1]}&complex=${openRows[0][3]}`}
              className="block w-full rounded-[12px] bg-blue-50 py-3.5 text-center text-[15px] font-bold text-blue-600 active:bg-blue-100"
            >
              이 단지 기간 수익률 보기
            </Link>
          </div>
        )}
      </BottomSheet>
    </main>
  );
}

function DealRow({
  r, area, low, compact, onClick,
}: { r: Row; area: string; low: boolean; compact?: boolean; onClick?: () => void }) {
  const [d, sgg, umd, , apt, ar, fl, amt, ppa, pct, direct, st] = r;
  const where = area.startsWith("st:") || area === "sin"
    ? (st.length ? st.map((s) => `${s}역`).join("·") : `${guName(sgg)} ${umd}`)
    : `${area === sgg ? "" : `${guName(sgg)} `}${umd}`;
  const pctNode =
    pct === null ? (
      <span className="text-[12px] text-grey-500">비교 불가</span>
    ) : low ? (
      <span className="rounded-full bg-down-50 px-2 py-1 text-[11px] font-semibold text-down-600">
        ▼ 저가 {Math.abs(pct).toFixed(1)}%
      </span>
    ) : (
      <span className={`text-[12px] font-semibold tabular-nums ${
        pct > 0 ? "text-up-500" : pct < 0 ? "text-down-500" : "text-grey-600"
      }`}>
        {pct > 0 ? "▲" : pct < 0 ? "▼" : ""} {Math.abs(pct).toFixed(1)}%
      </span>
    );

  return (
    <ListRow
      onClick={onClick}
      title={
        <>
          {!compact && apt}{!compact && " "}
          <span className={compact ? "" : "font-medium text-grey-700"}>
            {ar.toFixed(1)}㎡ <span className="text-grey-500">({toPyeong(ar).toFixed(0)}평)</span> · {fl ?? "-"}층
          </span>
          {direct === 1 && (
            <span className="ml-1.5 rounded-full bg-grey-100 px-1.5 py-0.5 text-[10px] font-semibold text-grey-600">직거래</span>
          )}
        </>
      }
      subtitle={`${d.slice(2).replace(/-/g, ".")} · ${compact ? `평당 ${formatPpa(ppa)}` : where}`}
      value={formatAmount(amt)}
      trailing={<div className="w-[72px] shrink-0 text-right">{pctNode}</div>}
    />
  );
}

function AreaSheet({
  open, onClose, value, stations, onChange,
}: {
  open: boolean;
  onClose: () => void;
  value: string;
  stations: string[];
  onChange: (area: string) => void;
}) {
  const pick = (a: string) => { onChange(a); onClose(); };
  const cls = (active: boolean, accent = false) =>
    `rounded-[12px] px-3 py-3.5 text-[15px] font-semibold ${
      active
        ? accent ? "bg-blue-500 text-white" : "bg-grey-900 text-white"
        : accent ? "bg-blue-50 text-blue-600" : "bg-grey-100 text-grey-800"
    }`;
  return (
    <BottomSheet open={open} onClose={onClose} title="범위 고르기">
      <div className="grid grid-cols-3 gap-2 px-5 pb-6">
        <button onClick={() => pick("sin")} className={`col-span-2 ${cls(value === "sin", true)}`}>
          신분당선 역세권
        </button>
        <button onClick={() => pick("all")} className={cls(value === "all")}>전체</button>
        {stations.map((s) => (
          <button key={s} onClick={() => pick(`st:${s}`)} className={cls(value === `st:${s}`)}>
            {s}
          </button>
        ))}
        <div className="col-span-3 pt-3 text-[13px] font-medium text-grey-600">경기</div>
        {Object.entries(GYEONGGI_GU).map(([code, name]) => (
          <button key={code} onClick={() => pick(code)} className={cls(value === code)}>
            <span className="text-[12px] font-medium opacity-70">{SIDO_OF[code]} </span>{name}
          </button>
        ))}
        <div className="col-span-3 pt-3 text-[13px] font-medium text-grey-600">서울</div>
        <button onClick={() => pick("seoul")} className={`col-span-3 ${cls(value === "seoul", true)}`}>
          서울 전체
        </button>
        {Object.entries(SEOUL_GU).map(([code, name]) => (
          <button key={code} onClick={() => pick(code)} className={cls(value === code)}>
            {name}
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}

function Caret() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" className="text-grey-600">
      <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
