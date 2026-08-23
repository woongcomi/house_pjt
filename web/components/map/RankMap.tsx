"use client";

import { useEffect, useRef, useState } from "react";
import { useKakaoLoader, markerColor, markerSize } from "@/lib/kakao";
import type { KakaoMap, KakaoOverlay } from "@/lib/kakao";
import { formatPctArrow } from "@/lib/format";

export interface MapPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  ret: number;
  nTrades: number;
  rank: number;
}

/**
 * 여러 단지를 한 지도에 얹는다.
 *
 * 서울 전체는 9천 곳이 넘어 전부 그리면 브라우저가 버티지 못한다.
 * 현재 보이는 영역 안에서 거래가 많은 순으로 잘라 그리고, 확대할수록
 * 자연히 더 촘촘해진다. 잘려나간 개수는 화면에 표시해 '전부 다 본다'는
 * 오해를 남기지 않는다.
 */
const MAX_MARKERS = 400;

export function RankMap({
  points, selectedId, onSelect, height = 420,
}: {
  points: MapPoint[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  height?: number;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KakaoMap | null>(null);
  const overlaysRef = useRef<KakaoOverlay[]>([]);
  const pointsRef = useRef(points);
  const selectedRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);

  const state = useKakaoLoader();
  const [hidden, setHidden] = useState(0);

  pointsRef.current = points;
  selectedRef.current = selectedId;
  onSelectRef.current = onSelect;

  // ── 지도 생성 (한 번만) ─────────────────────────
  useEffect(() => {
    if (state !== "ready" || !boxRef.current || mapRef.current) return;
    const kakao = window.kakao!;

    const first = points.find((p) => p.lat && p.lng);
    const map = new kakao.maps.Map(boxRef.current, {
      center: new kakao.maps.LatLng(first?.lat ?? 37.5665, first?.lng ?? 126.978),
      level: 6,
    });
    mapRef.current = map;

    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(draw, 120);
    };

    const draw = () => {
      const m = mapRef.current;
      if (!m) return;
      const b = m.getBounds();
      const sw = b.getSouthWest();
      const ne = b.getNorthEast();

      const visible = pointsRef.current.filter(
        (p) =>
          p.lat >= sw.getLat() && p.lat <= ne.getLat() &&
          p.lng >= sw.getLng() && p.lng <= ne.getLng(),
      );
      visible.sort((a, b2) => b2.nTrades - a.nTrades);

      const shown = visible.slice(0, MAX_MARKERS);
      setHidden(visible.length - shown.length);

      for (const o of overlaysRef.current) o.setMap(null);
      overlaysRef.current = [];

      const sel = selectedRef.current;
      for (const p of shown) {
        const isSel = p.id === sel;
        const size = markerSize(p.nTrades);
        const el = document.createElement("div");
        el.style.cssText = "transform:translate(-50%,-50%);cursor:pointer;";

        if (isSel) {
          el.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;">
              <div style="background:${markerColor(p.ret)};color:#fff;font-size:12px;
                          font-weight:700;padding:5px 10px;border-radius:14px;
                          white-space:nowrap;box-shadow:0 3px 10px rgba(0,0,0,.28);">
                ${escapeHtml(p.name)} ${formatPctArrow(p.ret)}
              </div>
              <div style="width:10px;height:10px;margin-top:-2px;border-radius:50%;
                          background:#fff;border:3px solid ${markerColor(p.ret)};"></div>
            </div>`;
        } else {
          el.innerHTML = `
            <div style="width:${size}px;height:${size}px;border-radius:50%;
                        background:${markerColor(p.ret)};opacity:.82;
                        border:1.5px solid rgba(255,255,255,.9);
                        box-shadow:0 1px 3px rgba(0,0,0,.2);"></div>`;
        }

        el.addEventListener("click", () => onSelectRef.current(p.id));

        overlaysRef.current.push(
          new kakao.maps.CustomOverlay({
            position: new kakao.maps.LatLng(p.lat, p.lng),
            content: el,
            map: m,
            zIndex: isSel ? 100 : 1,
            clickable: true,
          }),
        );
      }
    };

    kakao.maps.event.addListener(map, "bounds_changed", schedule);
    kakao.maps.event.addListener(map, "zoom_changed", schedule);

    // 처음에는 데이터가 담긴 영역이 다 보이도록 맞춘다
    const withGeo = points.filter((p) => p.lat && p.lng);
    if (withGeo.length > 1) {
      const bounds = new kakao.maps.LatLngBounds();
      for (const p of withGeo.slice(0, 3000)) {
        bounds.extend(new kakao.maps.LatLng(p.lat, p.lng));
      }
      if (!bounds.isEmpty()) map.setBounds(bounds);
    }
    draw();

    return () => {
      window.clearTimeout(timer);
      for (const o of overlaysRef.current) o.setMap(null);
      overlaysRef.current = [];
      mapRef.current = null;
    };
    // points/selectedId 는 ref 로 넘겨 지도 재생성을 막는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // ── 데이터·선택이 바뀌면 다시 그린다 ───────────────
  useEffect(() => {
    const m = mapRef.current;
    const kakao = window.kakao;
    if (!m || !kakao) return;
    // bounds_changed 를 억지로 발생시키지 않고 현재 중심을 다시 세팅해 재draw 유도
    m.setCenter(m.getCenter());
  }, [points, selectedId]);

  // 선택한 단지로 이동
  useEffect(() => {
    const m = mapRef.current;
    const kakao = window.kakao;
    if (!m || !kakao || !selectedId) return;
    const p = points.find((x) => x.id === selectedId);
    if (p?.lat && p?.lng) {
      m.setCenter(new kakao.maps.LatLng(p.lat, p.lng));
      if (m.getLevel() > 5) m.setLevel(5, { animate: true });
    }
  }, [selectedId, points]);

  if (state === "nokey") {
    return (
      <Placeholder height={height}>
        지도 키가 설정되지 않았어요 (.env 의 NEXT_PUBLIC_KAKAO_JS_KEY)
      </Placeholder>
    );
  }
  if (state === "error") {
    return <Placeholder height={height}>지도를 불러오지 못했어요</Placeholder>;
  }

  return (
    <div className="relative">
      <div ref={boxRef} style={{ height }} className="w-full bg-grey-100" />
      {hidden > 0 && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-grey-900/85 px-3 py-1.5 text-[11px] font-semibold text-white">
          거래 많은 {MAX_MARKERS}곳만 표시 · {hidden.toLocaleString()}곳 더 있어요
        </div>
      )}
    </div>
  );
}

function Placeholder({ height, children }: { height: number; children: React.ReactNode }) {
  return (
    <div
      style={{ height }}
      className="flex items-center justify-center bg-grey-50 px-6 text-center text-[13px] font-medium text-grey-700"
    >
      {children}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
