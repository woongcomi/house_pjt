"""API 응답 구조 실측 — 파서를 짜기 전에 반드시 먼저 돌린다.

문서마다 필드명이 엇갈리므로 추측하지 않고 실제 응답으로 확정한다.
  1) numOfRows 상한이 정말 1000인지 (100으로 캡되면 수집 계획이 2배가 됨)
  2) 실제 item 필드 목록
  3) aptSeq 존재 여부와 형태
  4) 과거 연도에도 aptSeq / dealingGbn 이 채워지는지
"""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from collections import Counter

import config as C
from fetch import Fetcher, ServiceKeyError
from parse import parse_header

PROBE_TARGETS = [
    ("11680", "202006", "강남구 · 거래 피크기"),
    ("11680", "200601", "강남구 · 최초 공개월"),
    ("11710", "201305", "송파구 · 바닥 구간"),
    ("11110", "202312", "종로구 · 소규모 구"),
]


def main() -> int:
    try:
        f = Fetcher(save_raw=True)
    except ServiceKeyError as e:
        print(f"\n[중단] {e}\n", file=sys.stderr)
        return 2

    C.SAMPLE_DIR.mkdir(parents=True, exist_ok=True)
    print("=" * 68)
    print("국토부 아파트 매매 실거래가 상세 API — 응답 구조 실측")
    print("=" * 68)

    all_tags: Counter[str] = Counter()

    for lawd, ymd, desc in PROBE_TARGETS:
        print(f"\n▶ {desc}  ({lawd} / {ymd})")
        try:
            res = f.fetch_page(lawd, ymd, page_no=1)
        except Exception as e:
            print(f"  실패: {e}")
            continue

        raw = f._read_cache(lawd, ymd, 1) or ""
        (C.SAMPLE_DIR / f"{lawd}_{ymd}.xml").write_text(raw, encoding="utf-8")
        code, msg, total = parse_header(raw)

        print(f"  resultCode={code} ({msg})  totalCount={total}  item={len(res.items)}")

        # ① numOfRows 상한
        root = ET.fromstring(raw)
        echo = root.find(".//numOfRows")
        echo_v = echo.text.strip() if echo is not None and echo.text else "?"
        if total > len(res.items):
            print(f"  numOfRows: 요청 {C.NUM_OF_ROWS} / 응답 에코 {echo_v} "
                  f"/ 실제 {len(res.items)}건  ← 상한 있음!")
        else:
            print(f"  numOfRows: 요청 {C.NUM_OF_ROWS} / 응답 에코 {echo_v} "
                  f"/ 실제 {len(res.items)}건")

        if not res.items:
            continue

        # ② 필드 목록
        first_item = root.find(".//item")
        tags = [e.tag for e in first_item] if first_item is not None else []
        all_tags.update(tags)

        # ③ aptSeq 형태 + 결측률
        seqs = [r.get("apt_seq") or "" for r in res.items]
        missing = sum(1 for s in seqs if not s)
        print(f"  aptSeq 결측 {missing}/{len(seqs)}"
              f"  예시: {', '.join(s for s in seqs[:3] if s)}")

        # ④ 주요 필드 채움률
        for col in ("dealing_gbn", "cdeal_type", "rgst_date", "land_leasehold_gbn"):
            filled = sum(1 for r in res.items if (r.get(col) or "").strip())
            print(f"  {col:20s} 채움 {filled:4d}/{len(res.items)}")

        # ⑤ 값 샘플
        s = res.items[0]
        print(f"  샘플: {s['apt_nm']} {s['excl_ar']}㎡ {s['floor']}층 "
              f"{s['deal_amount']:,}만원 ({s['deal_date']})")

    print("\n" + "=" * 68)
    print("관측된 item 필드 전체:")
    for tag, cnt in sorted(all_tags.items()):
        known = "  " if tag in _known_tags() else " ★"  # ★ = 파서에 없는 새 필드
        print(f" {known} {tag}")
    print(f"\nAPI 호출 {f.calls}회 · 샘플 저장 → {C.SAMPLE_DIR}")
    return 0


def _known_tags() -> set[str]:
    from parse import FIELD_MAP
    return set(FIELD_MAP) | {"dealYear", "dealMonth", "dealDay"}


if __name__ == "__main__":
    sys.exit(main())
