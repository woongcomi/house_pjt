"use client";

import { useEffect, useRef } from "react";
import { useKakaoLoader, markerColor } from "@/lib/kakao";
import type { KakaoMap, KakaoOverlay } from "@/lib/kakao";

/**
 * 단지 하나의 위치. 상세 시트 안에서 '여기가 어디인지' 만 보여주면 되므로
 * 조작 UI 를 최소화하고 마커 하나에 집중한다.
 */
export function ComplexMap({
  lat, lng, name, ret, height = 180,
}: {
  lat: number;
  lng: number;
  name: string;
  ret: number;
  height?: number;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const state = useKakaoLoader();

  useEffect(() => {
    if (state !== "ready" || !boxRef.current || !lat || !lng) return;
    const kakao = window.kakao!;
    const center = new kakao.maps.LatLng(lat, lng);
    const map = new kakao.maps.Map(boxRef.current, { center, level: 4 });

    const el = document.createElement("div");
    el.style.cssText = "transform:translate(-50%,-100%);white-space:nowrap;";
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;">
        <div style="background:${markerColor(ret)};color:#fff;font-size:12px;font-weight:700;
                    padding:5px 10px;border-radius:14px;
                    box-shadow:0 2px 8px rgba(0,0,0,.22);">${escapeHtml(name)}</div>
        <div style="width:0;height:0;border-left:5px solid transparent;
                    border-right:5px solid transparent;
                    border-top:6px solid ${markerColor(ret)};"></div>
      </div>`;

    const overlay: KakaoOverlay = new kakao.maps.CustomOverlay({
      position: center,
      content: el,
      map,
      yAnchor: 1,
    });

    // 시트가 열리는 애니메이션 중에 지도가 그려지면 크기를 잘못 잡는다
    const t = window.setTimeout(() => {
      (map as KakaoMap).relayout();
      map.setCenter(center);
    }, 320);

    return () => {
      window.clearTimeout(t);
      overlay.setMap(null);
    };
  }, [state, lat, lng, name, ret]);

  if (!lat || !lng) {
    // 좌표를 못 찾는 단지는 대부분 재건축으로 사라진 곳이다
    // (청실1차 → 래미안대치팰리스처럼). 지도 서비스에 더 이상 존재하지 않는다.
    return (
      <div
        style={{ height }}
        className="flex flex-col items-center justify-center gap-1 rounded-[14px] bg-grey-50 px-6 text-center"
      >
        <span className="text-[13px] font-semibold text-grey-800">
          지도에서 찾을 수 없는 단지예요
        </span>
        <span className="text-[12px] leading-relaxed text-grey-700">
          재건축으로 이름이 바뀌었거나 없어진 단지일 수 있어요
        </span>
      </div>
    );
  }

  if (state === "nokey" || state === "error") {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center rounded-[14px] bg-grey-50 text-[13px] font-medium text-grey-700"
      >
        지도를 불러오지 못했어요
      </div>
    );
  }

  return (
    <div
      ref={boxRef}
      style={{ height }}
      className="overflow-hidden rounded-[14px] bg-grey-100"
    />
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
