"use client";

import { useEffect, type ReactNode } from "react";

/**
 * 토스식 바텀시트.
 * 모달 대신 시트를 쓰는 이유: 모바일에서 손가락이 닿는 아래쪽에 조작부가 오고,
 * 뒤 화면의 맥락(어느 구, 어느 기간을 보고 있었는지)이 계속 보인다.
 */
export function BottomSheet({
  open, onClose, title, children, footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div
        className="animate-fade-in absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <div className="animate-sheet-up relative flex max-h-[88dvh] w-full max-w-[560px] flex-col rounded-t-[20px] bg-white">
        <div className="flex shrink-0 items-center justify-between px-5 pb-2 pt-4">
          <div className="text-[18px] font-bold text-grey-900">{title}</div>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="-mr-2 rounded-full p-2 text-grey-700 active:bg-grey-100"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor"
                    strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
        {footer && (
          <div className="shrink-0 border-t border-grey-100 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function PrimaryButton({
  children, onClick, disabled,
}: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-[12px] bg-blue-500 py-4 text-[16px] font-bold text-white
                 transition-transform duration-150 active:scale-[0.985]
                 disabled:bg-grey-200 disabled:text-grey-600"
    >
      {children}
    </button>
  );
}
