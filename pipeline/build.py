"""집계 파이프라인 오케스트레이터.

  complexes → buckets → clean → aggregate
각 단계의 통계를 출력해 데이터가 어디서 얼마나 걸러지는지 눈으로 확인한다.

사용:  python pipeline/build.py
"""
from __future__ import annotations

import sys
import time

import aggregate
import buckets
import clean
import complexes
from db import connect, init_schema, set_meta
from fetch import utcnow


def main() -> int:
    conn = connect()
    init_schema(conn)

    n_raw = conn.execute("SELECT COUNT(*) c FROM trade_raw").fetchone()["c"]
    if n_raw == 0:
        print("trade_raw 가 비어 있습니다. 먼저 collect.py 를 실행하세요.")
        return 1

    print(f"원시 거래 {n_raw:,}건\n")

    t = time.time()
    print("[1/4] 단지 마스터…")
    r = complexes.build(conn)
    print(f"      단지 {r['complexes']:,}개"
          + (f" · aptSeq 없는 거래 {r['orphan_trades']:,}건" if r["orphan_trades"] else ""))

    print("[2/4] 면적 버킷…")
    r = buckets.build(conn)
    print(f"      버킷 {r['buckets']:,}개 · 단지당 평균 {r['avg_buckets']}개")

    print("[3/4] 정제…")
    r = clean.build(conn)
    print(f"      필터 통과 {r['after_filter']:,} / {r['raw']:,}"
          f"  (제외 {r['dropped_by_filter']:,})")
    print(f"      버킷 미매칭 {r['dropped_no_bucket']:,} · "
          f"평당가 범위 밖 {r['dropped_ppa_range']:,} · MAD 이상치 {r['dropped_mad']:,}")
    print(f"      최종 {r['kept']:,}건 "
          f"({r['kept'] / max(1, r['raw']) * 100:.1f}%)")

    print("[4/4] 믹스보정 집계…")
    r = aggregate.build(conn)
    print(f"      단지×월 {r['complex_month_rows']:,}행 · "
          f"타입×월 {r['type_month_rows']:,}행")

    set_meta(conn, "last_build_at", utcnow())
    conn.commit()
    print(f"\n완료 ({time.time() - t:.1f}초)")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
