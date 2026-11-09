import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "집값 인사이트 — 오리역·신분당선 59㎡ 투자 보드",
  description:
    "국토교통부 실거래가로 보는 신분당선·분당선 역세권 아파트의 가격·고점 대비·거래량·강남 대비 상대가치와 저가 거래",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#3182F6",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <head>
        {/*
          Pretendard 를 globals.css 의 @import 로 넣으면 Tailwind v4 처리 과정에서
          누락된다. link 로 직접 걸어야 확실히 로드되고, preconnect 덕에 더 빠르다.
        */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-dvh">
        <Nav />
        {/* 넓은 화면은 넓게 쓴다. 좁은 열이 필요한 페이지는 각자 max-w 를 건다 */}
        <div className="mx-auto min-h-dvh w-full max-w-[1440px]">{children}</div>
      </body>
    </html>
  );
}
