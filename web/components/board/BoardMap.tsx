"use client";

import { useEffect, useRef, useState } from "react";
import { useKakaoLoader, type KakaoLatLng, type KakaoMap, type KakaoOverlay } from "@/lib/kakao";
import {
  BUNDANG_ORDER, LINE_ORDER, changeColor, eok, pctArrow,
  type InsightPoint, type SizeKey, type StationInsight,
} from "@/lib/insights";

export type MapMode = "chg1y" | "drawdown" | "low";

/* lib/kakao.ts 에 없는 SDK 일부 (선·원) 만 여기서 좁게 선언 */
interface KakaoShapeMaps {
  maps: {
    LatLng: new (lat: number, lng: number) => KakaoLatLng;
    LatLngBounds: new () => { extend(l: KakaoLatLng): void; isEmpty(): boolean };
    Map: new (el: HTMLElement, o: { center: KakaoLatLng; level: number }) => KakaoMap;
    Polyline: new (o: { path: KakaoLatLng[]; strokeWeight: number; strokeColor: string; strokeOpacity: number; strokeStyle?: string; map?: KakaoMap }) => KakaoOverlay;
    Circle: new (o: { center: KakaoLatLng; radius: number; strokeWeight: number; strokeColor: string; strokeOpacity: number; fillColor: string; fillOpacity: number; map?: KakaoMap }) => KakaoOverlay;
    CustomOverlay: new (o: { position: KakaoLatLng; content: HTMLElement; map?: KakaoMap; yAnchor?: number; zIndex?: number; clickable?: boolean }) => KakaoOverlay;
  };
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/**
 * 보드 지도 — 노선·역과 단지 점. 점 색은 모드(1년 변동 / 고점 대비 / 저가)에 따르고
 * 크기는 최근 90일 거래량. 역을 고르면 그 역 반경 700m 원을 그리고 중심을 옮긴다.
 */
export function BoardMap({
  stations, points, size, mode, selectedStation, onSelectStation, onSelectComplex, height = 420,
}: {
  stations: StationInsight[];
  points: InsightPoint[];
  size: SizeKey;
  mode: MapMode;
  selectedStation: string | null;
  onSelectStation: (name: string) => void;
  onSelectComplex: (id: string) => void;
  height?: number;
}) {
  const state = useKakaoLoader();
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KakaoMap | null>(null);
  const overlays = useRef<KakaoOverlay[]>([]);
  const staticOverlays = useRef<KakaoOverlay[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const cbRef = useRef({ onSelectStation, onSelectComplex });
  cbRef.current = { onSelectStation, onSelectComplex };

  // 지도 생성 + 노선·역 (한 번)
  useEffect(() => {
    if (state !== "ready" || !ref.current || mapRef.current) return;
    const kakao = window.kakao as unknown as KakaoShapeMaps;
    const center = stations.find((s) => s.name === "오리") ?? stations[0];
    const map = new kakao.maps.Map(ref.current, { center: new kakao.maps.LatLng(center.lat, center.lng), level: 7 });
    mapRef.current = map;

    const by = new Map(stations.map((s) => [s.name, s]));
    const path = (names: string[]) => names.map((n) => by.get(n)).filter(Boolean).map((s) => new kakao.maps.LatLng(s!.lat, s!.lng));
    staticOverlays.current.push(
      new kakao.maps.Polyline({ path: path(LINE_ORDER), strokeWeight: 5, strokeColor: "#d4003b", strokeOpacity: 0.75, map }),
      new kakao.maps.Polyline({ path: path(["정자", "미금", ...BUNDANG_ORDER]), strokeWeight: 5, strokeColor: "#f5a200", strokeOpacity: 0.8, map }),
    );
    for (const s of stations) {
      const el = document.createElement("div");
      el.style.cssText = "transform:translate(-50%,-50%);cursor:pointer;display:flex;flex-direction:column;align-items:center;";
      el.innerHTML = `<div style="width:12px;height:12px;border-radius:50%;background:#fff;border:3px solid ${s.line === "신분당선" ? "#d4003b" : "#f5a200"};box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>
        <div style="margin-top:2px;font-size:11px;font-weight:700;color:#191f28;text-shadow:0 0 3px #fff,0 0 3px #fff;white-space:nowrap">${esc(s.name)}</div>`;
      el.addEventListener("click", () => cbRef.current.onSelectStation(s.name));
      staticOverlays.current.push(new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(s.lat, s.lng), content: el, map, zIndex: 50, clickable: true }));
    }
    const b = new kakao.maps.LatLngBounds();
    for (const s of stations) b.extend(new kakao.maps.LatLng(s.lat, s.lng));
    map.setBounds(b);
  }, [state, stations]);

  // 단지 점 (모드·면적형·선택 바뀔 때 다시)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || state !== "ready") return;
    const kakao = window.kakao as unknown as KakaoShapeMaps;
    for (const o of overlays.current) o.setMap(null);
    overlays.current = [];

    const st = stations.find((s) => s.name === selectedStation);
    if (st) {
      overlays.current.push(new kakao.maps.Circle({
        center: new kakao.maps.LatLng(st.lat, st.lng), radius: 700, strokeWeight: 1.5, strokeColor: "#191f28",
        strokeOpacity: 0.5, fillColor: "#191f28", fillOpacity: 0.04, map,
      }));
      map.setCenter(new kakao.maps.LatLng(st.lat, st.lng));
      if (map.getLevel() > 5) map.setLevel(5);
    }

    const sorted = [...points].sort((a, b) => (a[size]?.n90 ?? 0) - (b[size]?.n90 ?? 0));
    for (const p of sorted) {
      const g = p[size];
      if (!g || !p.lat) continue;
      const dim = !!st && !p.st.includes(st.name);
      let color = "#b0b8c1";
      if (mode === "chg1y") color = changeColor(g.chg1y);
      else if (mode === "drawdown") color = g.drawdown === null ? "#b0b8c1" : g.drawdown <= -0.15 ? "#1b64da" : g.drawdown <= -0.05 ? "#7fb0f5" : "#8b95a1";
      else color = g.low90 > 0 ? "#1b64da" : "#c9ced6";
      const sz = g.n90 >= 10 ? 16 : g.n90 >= 4 ? 13 : g.n90 >= 1 ? 10 : 7;
      const el = document.createElement("div");
      el.style.cssText = `transform:translate(-50%,-50%);cursor:pointer;opacity:${dim ? 0.25 : 1}`;
      el.innerHTML = `<div style="width:${sz}px;height:${sz}px;border-radius:50%;background:${color};border:2px solid ${g.low90 > 0 && mode !== "low" ? "#1b64da" : "rgba(255,255,255,.95)"};box-shadow:0 1px 3px rgba(0,0,0,.25)"></div>`;
      el.title = `${p.name} · ${eok(g.amtNow)} · 1년 ${pctArrow(g.chg1y)} · 90일 ${g.n90}건`;
      el.addEventListener("click", () => cbRef.current.onSelectComplex(p.id));
      el.addEventListener("mouseenter", () => setHover(`${p.name} · ${eok(g.amtNow)} · 1년 ${pctArrow(g.chg1y)} · 고점 대비 ${pctArrow(g.drawdown)} · 90일 ${g.n90}건${g.low90 ? ` (저가 ${g.low90})` : ""}`));
      el.addEventListener("mouseleave", () => setHover(null));
      overlays.current.push(new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(p.lat, p.lng), content: el, map, zIndex: g.low90 > 0 ? 20 : 10, clickable: true }));
    }
  }, [state, points, size, mode, selectedStation, stations]);

  if (state === "nokey" || state === "error") {
    return <div className="flex items-center justify-center rounded-[12px] bg-grey-50 text-[13px] text-grey-600" style={{ height }}>지도를 불러오지 못했어요</div>;
  }
  return (
    <div className="relative">
      <div ref={ref} style={{ height }} className="w-full overflow-hidden rounded-[12px] bg-grey-100" />
      <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-[10px] bg-white/95 px-3 py-2 text-[12px] text-grey-800 shadow-sm">
        {hover ?? (selectedStation ? `${selectedStation}역 반경 700m · 점을 누르면 단지 상세` : "역을 누르면 반경 700m 단지만 강조돼요 · 점 크기 = 90일 거래량")}
      </div>
    </div>
  );
}
