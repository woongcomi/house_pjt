"use client";

import { BottomSheet } from "./toss/BottomSheet";
import { GYEONGGI_GU, SEOUL_GU, SIDO_OF } from "@/lib/seoul";

export function GuSheet({
  open, onClose, value, onChange,
}: {
  open: boolean;
  onClose: () => void;
  value: string;
  onChange: (sgg: string) => void;
}) {
  const pick = (code: string) => { onChange(code); onClose(); };
  const cls = (active: boolean) =>
    `rounded-[12px] px-3 py-3.5 text-[15px] font-semibold ${
      active ? "bg-grey-900 text-white" : "bg-grey-100 text-grey-800"
    }`;

  return (
    <BottomSheet open={open} onClose={onClose} title="동네 고르기">
      <div className="grid grid-cols-3 gap-2 px-5 pb-6">
        <button
          onClick={() => pick("all")}
          className={`col-span-3 rounded-[12px] px-3 py-3.5 text-[15px] font-semibold ${
            value === "all" ? "bg-blue-500 text-white" : "bg-blue-50 text-blue-600"
          }`}
        >
          서울 전체
        </button>
        {Object.entries(SEOUL_GU).map(([code, name]) => (
          <button key={code} onClick={() => pick(code)} className={cls(value === code)}>
            {name}
          </button>
        ))}

        <div className="col-span-3 pt-3 text-[13px] font-medium text-grey-600">
          경기 · 신분당선
        </div>
        {Object.entries(GYEONGGI_GU).map(([code, name]) => (
          <button key={code} onClick={() => pick(code)} className={cls(value === code)}>
            <span className="text-[12px] font-medium text-current/70">{SIDO_OF[code]} </span>
            {name}
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}
