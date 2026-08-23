"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BottomSheet } from "./toss/BottomSheet";
import { ListRow } from "./toss/primitives";
import { loadSearch, type SearchFile } from "@/lib/loader";
import { SEOUL_GU } from "@/lib/seoul";

export function SearchSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [data, setData] = useState<SearchFile | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (open && !data) loadSearch().then(setData).catch(() => {});
  }, [open, data]);

  const results = useMemo(() => {
    const term = q.replace(/\s+/g, "").toLowerCase();
    if (!data || term.length < 1) return [];
    const out: SearchFile["items"] = [];
    for (const item of data.items) {
      if (item[1].replace(/\s+/g, "").toLowerCase().includes(term)) {
        out.push(item);
        if (out.length >= 40) break;
      }
    }
    return out;
  }, [data, q]);

  return (
    <BottomSheet open={open} onClose={onClose} title="아파트 찾기">
      <div className="px-5 pb-3">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="예) 헬리오시티, 은마"
          className="w-full rounded-[12px] bg-grey-100 px-4 py-3.5 text-[16px]
                     text-grey-900 outline-none placeholder:text-grey-600
                     focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {q && results.length === 0 && (
        <p className="px-5 py-8 text-center text-[14px] text-grey-700">
          {data ? "검색 결과가 없어요" : "불러오는 중이에요"}
        </p>
      )}

      <div className="pb-4">
        {results.map(([id, name, dong, sgg]) => (
          <ListRow
            key={id}
            title={name}
            subtitle={`${SEOUL_GU[sgg] ?? sgg} ${dong}`}
            onClick={() => {
              onClose();
              router.push(`/rank?sgg=${sgg}&complex=${encodeURIComponent(id)}`);
            }}
          />
        ))}
      </div>
    </BottomSheet>
  );
}
