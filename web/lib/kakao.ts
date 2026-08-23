"use client";

import { useEffect, useState } from "react";

/* 카카오맵 SDK 는 타입 패키지를 따로 깔지 않고 필요한 부분만 좁게 선언한다. */
export interface KakaoLatLng {
  getLat(): number;
  getLng(): number;
}
export interface KakaoBounds {
  getSouthWest(): KakaoLatLng;
  getNorthEast(): KakaoLatLng;
}
export interface KakaoMap {
  setCenter(latlng: KakaoLatLng): void;
  getCenter(): KakaoLatLng;
  setLevel(level: number, options?: { animate?: boolean }): void;
  getLevel(): number;
  getBounds(): KakaoBounds;
  setBounds(bounds: unknown): void;
  relayout(): void;
}
export interface KakaoOverlay {
  setMap(map: KakaoMap | null): void;
}

interface KakaoMaps {
  maps: {
    load(cb: () => void): void;
    Map: new (container: HTMLElement, options: { center: KakaoLatLng; level: number }) => KakaoMap;
    LatLng: new (lat: number, lng: number) => KakaoLatLng;
    LatLngBounds: new () => { extend(latlng: KakaoLatLng): void; isEmpty(): boolean };
    CustomOverlay: new (options: {
      position: KakaoLatLng;
      content: HTMLElement | string;
      map?: KakaoMap;
      yAnchor?: number;
      xAnchor?: number;
      zIndex?: number;
      clickable?: boolean;
    }) => KakaoOverlay;
    event: {
      addListener(target: unknown, type: string, handler: () => void): void;
      removeListener(target: unknown, type: string, handler: () => void): void;
    };
  };
}

declare global {
  interface Window {
    kakao?: KakaoMaps;
  }
}

const SDK_ID = "kakao-maps-sdk";

export type LoadState = "idle" | "loading" | "ready" | "error" | "nokey";

/**
 * 카카오맵 SDK 로더.
 *
 * autoload=false 로 받아 kakao.maps.load() 로 명시적으로 초기화한다.
 * 그러지 않으면 스크립트 로드 시점과 React 렌더 시점이 어긋나 첫 지도가 빈 채로 뜬다.
 * SDK 는 페이지 전체에서 한 번만 붙인다.
 */
export function useKakaoLoader(): LoadState {
  const [state, setState] = useState<LoadState>("idle");

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;
    if (!key) {
      setState("nokey");
      return;
    }

    if (window.kakao?.maps?.Map) {
      setState("ready");
      return;
    }

    const finish = () => {
      const k = window.kakao;
      if (!k) {
        setState("error");
        return;
      }
      k.maps.load(() => setState("ready"));
    };

    const existing = document.getElementById(SDK_ID) as HTMLScriptElement | null;
    if (existing) {
      setState("loading");
      existing.addEventListener("load", finish);
      existing.addEventListener("error", () => setState("error"));
      // 이미 로드가 끝난 뒤 마운트된 경우
      if (window.kakao) finish();
      return () => {
        existing.removeEventListener("load", finish);
      };
    }

    setState("loading");
    const s = document.createElement("script");
    s.id = SDK_ID;
    s.async = true;
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false`;
    s.onload = finish;
    s.onerror = () => setState("error");
    document.head.appendChild(s);
  }, []);

  return state;
}

/** 상승률에 따른 마커 색 — 한국 관행대로 오르면 빨강, 내리면 파랑 */
export function markerColor(ret: number): string {
  if (!Number.isFinite(ret)) return "#8B95A1";
  if (ret >= 0.5) return "#B81F2C";
  if (ret >= 0.2) return "#F04452";
  if (ret >= 0.05) return "#F5808A";
  if (ret > -0.05) return "#8B95A1";
  if (ret > -0.2) return "#7FB0F5";
  return "#1B64DA";
}

/** 거래가 많은 단지일수록 크게 — 어느 블록이 활발한지 눈에 들어온다 */
export function markerSize(nTrades: number): number {
  if (nTrades >= 300) return 15;
  if (nTrades >= 120) return 13;
  if (nTrades >= 40) return 11;
  return 9;
}
