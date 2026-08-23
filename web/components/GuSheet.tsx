"use client";

import { BottomSheet } from "./toss/BottomSheet";
import { SEOUL_GU } from "@/lib/seoul";

export function GuSheet({
  open, onClose, value, onChange,
}: {
  open: boolean;
  onClose: () => void;
  value: string;
  onChange: (sgg: string) => void;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title="동네 고르기">
      <div className="grid grid-cols-3 gap-2 px-5 pb-6">
        <button
          onClick={() => { onChange("all"); onClose(); }}
          className={`col-span-3 rounded-[12px] px-3 py-3.5 text-[15px] font-semibold ${
            value === "all" ? "bg-blue-500 text-white" : "bg-blue-50 text-blue-600"
          }`}
        >
          서울 전체
        </button>
        {Object.entries(SEOUL_GU).map(([code, name]) => (
          <button
            key={code}
            onClick={() => { onChange(code); onClose(); }}
            className={`rounded-[12px] px-3 py-3.5 text-[15px] font-semibold ${
              value === code ? "bg-grey-900 text-white" : "bg-grey-100 text-grey-800"
            }`}
          >
            {name}
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}
