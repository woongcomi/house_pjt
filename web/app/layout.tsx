import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "서울 아파트, 얼마나 올랐을까",
  description:
    "국토교통부 실거래가로 보는 서울 아파트 기간별 상승률·변동폭과 동네 순위",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
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
        {/* 모바일 우선. 데스크톱에서도 앱처럼 가운데 한 컬럼으로 읽히게 한다 */}
        <div className="mx-auto min-h-dvh w-full max-w-[560px] bg-white shadow-[0_0_40px_rgba(0,0,0,0.04)]">
          {children}
        </div>
      </body>
    </html>
  );
}
