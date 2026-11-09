"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "투자 보드" },
  { href: "/recent/", label: "최근 거래" },
  { href: "/rank/", label: "단지 순위" },
  { href: "/dashboard/", label: "구별 대시보드" },
  { href: "/seoul/", label: "서울 전체" },
];

export function Nav() {
  const path = usePathname() ?? "/";
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href.replace(/\/$/, "")));
  return (
    <nav className="sticky top-0 z-30 border-b border-grey-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-1 px-4 sm:px-6">
        <Link href="/" className="mr-4 flex items-center gap-2 text-[16px] font-bold tracking-tight text-grey-900">
          <span className="inline-block h-6 w-6 rounded-[7px] bg-blue-500" aria-hidden />
          집값 인사이트
        </Link>
        <div className="scrollbar-none flex gap-1 overflow-x-auto">
          {ITEMS.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className={`shrink-0 rounded-[9px] px-3 py-1.5 text-[14px] font-semibold transition-colors ${
                active(it.href) ? "bg-grey-900 text-white" : "text-grey-700 hover:bg-grey-100"
              }`}
            >
              {it.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
