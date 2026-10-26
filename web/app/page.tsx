"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { loadMeta, loadRegion, type Meta, type RegionFile } from "@/lib/loader";
import { GYEONGGI_GU, SEOUL_GU, SIDO_OF } from "@/lib/seoul";
import { formatPctArrow, trendColor } from "@/lib/format";
import { idxToYm } from "@/lib/metrics";
import { SearchSheet } from "@/components/SearchSheet";

/** 구별 최근 1년 변동률 — 첫 화면에서 이미 정보를 준다 (빈 화면 금지) */
function useGuChange(region: RegionFile | null, lastT: number) {
  return useMemo(() => {
    const out: Record<string, number | null> = {};
    if (!region) return out;
    for (const code of [...Object.keys(SEOUL_GU), ...Object.keys(GYEONGGI_GU)]) {
      const s = region.region[`sgg:${code}`];
      if (!s) { out[code] = null; continue; }
      const findAt = (t: number) => {
        let best = -1;
        for (let i = 0; i < s.t.length; i++) {
          if (s.t[i] <= t) best = i; else break;
        }
        return best;
      };
      const iEnd = findAt(lastT);
      const iStart = findAt(lastT - 12);
      out[code] =
        iEnd >= 0 && iStart >= 0 && iStart !== iEnd
          ? s.p[iEnd] / s.p[iStart] - 1
          : null;
    }
    return out;
  }, [region, lastT]);
}

export default function Home() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [region, setRegion] = useState<RegionFile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    Promise.all([loadMeta(), loadRegion()])
      .then(([m, r]) => { setMeta(m); setRegion(r); })
      .catch((e) => setErr(String(e)));
  }, []);

  const lastT = meta
    ? Number(meta.lastYm.slice(0, 4)) * 12 + Number(meta.lastYm.slice(5, 7)) - 1
    : 0;
  const changes = useGuChange(region, lastT);

  if (err) {
    return (
      <main className="p-6">
        <p className="text-[15px] font-semibold text-grey-900">데이터를 불러오지 못했어요</p>
        <p className="mt-2 text-[13px] text-grey-700">
          아직 데이터가 준비되지 않았을 수 있어요. 파이프라인을 먼저 실행해 주세요.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-[12px] bg-grey-100 p-3 text-[11px] text-grey-600">
          python pipeline/collect.py --all{"\n"}
          python pipeline/build.py{"\n"}
          python pipeline/export.py
        </pre>
      </main>
    );
  }

  return (
    <main className="pb-10">
      <header className="px-5 pb-4 pt-8">
        <h1 className="text-[26px] font-bold leading-[1.3] tracking-tight text-grey-900">
          서울 아파트,
          <br />
          얼마나 올랐을까요?
        </h1>
        <p className="mt-2 text-[14px] text-grey-600">
          동네와 기간을 고르면 순위까지 알려드려요
        </p>
      </header>

      <button
        onClick={() => setSearchOpen(true)}
        className="mx-5 flex w-[calc(100%-2.5rem)] items-center gap-2 rounded-[12px] bg-grey-100 px-4 py-3.5 text-left active:bg-grey-200"
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" className="text-grey-700">
          <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.8" />
          <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <span className="text-[15px] text-grey-700">아파트 이름으로 찾기</span>
      </button>

      <div className="px-5 pb-2 pt-7">
        <h2 className="text-[17px] font-bold text-grey-900">동네 고르기</h2>
        <p className="mt-1 text-[13px] text-grey-700">
          {meta ? `최근 1년 변동률 · ${meta.lastYm.replace("-", "년 ")}월 기준` : " "}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 px-5">
        {Object.entries(SEOUL_GU).map(([code, name]) => {
          const ch = changes[code];
          return (
            <Link
              key={code}
              href={`/rank?sgg=${code}`}
              className="rounded-[14px] bg-grey-50 px-3 py-3.5 transition-transform duration-150 active:scale-[0.97]"
            >
              <div className="text-[15px] font-semibold text-grey-900">{name}</div>
              <div
                className={`mt-1 text-[13px] font-bold tabular-nums ${
                  ch === null || ch === undefined ? "text-grey-600" : trendColor(ch)
                }`}
              >
                {ch === null || ch === undefined ? "—" : formatPctArrow(ch)}
              </div>
            </Link>
          );
        })}
      </div>

      <div className="px-5 pb-2 pt-6">
        <h2 className="text-[17px] font-bold text-grey-900">경기 · 신분당선</h2>
        <p className="mt-1 text-[13px] text-grey-700">판교·정자·미금 / 수지 / 광교</p>
      </div>
      <div className="grid grid-cols-3 gap-2 px-5">
        {Object.entries(GYEONGGI_GU).map(([code, name]) => {
          const ch = changes[code];
          return (
            <Link
              key={code}
              href={`/rank?sgg=${code}`}
              className="rounded-[14px] bg-grey-50 px-3 py-3.5 transition-transform duration-150 active:scale-[0.97]"
            >
              <div className="text-[15px] font-semibold text-grey-900">
                <span className="text-[12px] font-medium text-grey-600">{SIDO_OF[code]} </span>
                {name}
              </div>
              <div
                className={`mt-1 text-[13px] font-bold tabular-nums ${
                  ch === null || ch === undefined ? "text-grey-600" : trendColor(ch)
                }`}
              >
                {ch === null || ch === undefined ? "—" : formatPctArrow(ch)}
              </div>
            </Link>
          );
        })}
      </div>

      <div className="mt-8 space-y-2 px-5">
        <Link
          href="/recent"
          className="flex items-center justify-between rounded-[14px] bg-down-50 px-5 py-4 active:opacity-90"
        >
          <div>
            <div className="text-[15px] font-bold text-down-600">최근 거래 · 저가 거래</div>
            <div className="mt-0.5 text-[12px] text-down-600/80">
              지금 체결되는 거래와 1년 중위가보다 싸게 팔린 집
            </div>
          </div>
          <Chevron />
        </Link>
        <Link
          href="/rank?sgg=11680&view=map"
          className="flex items-center justify-between rounded-[14px] bg-grey-900 px-5 py-4 active:opacity-90"
        >
          <div>
            <div className="text-[15px] font-bold text-white">지도로 둘러보기</div>
            <div className="mt-0.5 text-[12px] text-grey-300">
              오른 곳은 빨갛게, 내린 곳은 파랗게 보여요
            </div>
          </div>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" className="shrink-0 text-grey-400">
            <path d="M7.5 4l6 6-6 6" stroke="currentColor" strokeWidth="1.8"
                  strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <Link
          href="/rank?sgg=all"
          className="flex items-center justify-between rounded-[14px] bg-blue-50 px-5 py-4 active:bg-blue-100"
        >
          <div>
            <div className="text-[15px] font-bold text-blue-600">서울 전체 순위 보기</div>
            <div className="mt-0.5 text-[12px] text-blue-500/80">
              25개 구 아파트를 한 줄로 세워요
            </div>
          </div>
          <Chevron />
        </Link>
        <Link
          href="/dashboard"
          className="flex items-center justify-between rounded-[14px] bg-grey-50 px-5 py-4 active:bg-grey-100"
        >
          <div>
            <div className="text-[15px] font-bold text-grey-900">대시보드</div>
            <div className="mt-0.5 text-[12px] text-grey-700">
              구별 비교, 분포, 고점 시점까지
            </div>
          </div>
          <Chevron />
        </Link>
      </div>

      {meta && (
        <footer className="mt-10 px-5 text-[11px] leading-relaxed text-grey-600">
          국토교통부 실거래가 · 아파트 매매 {meta.trades.toLocaleString()}건 ·
          단지 {meta.complexes.toLocaleString()}곳
          <br />
          평당가는 <strong className="font-semibold text-grey-700">전용면적 기준</strong>이라
          공급면적 기준으로 표기하는 곳보다 높게 보여요.
          <br />
          최근 2개월은 신고가 진행 중이라 값이 바뀔 수 있어요.
        </footer>
      )}

      <SearchSheet open={searchOpen} onClose={() => setSearchOpen(false)} />
    </main>
  );
}

function Chevron() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" className="shrink-0 text-grey-600">
      <path d="M7.5 4l6 6-6 6" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
