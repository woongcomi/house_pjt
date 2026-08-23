"""수집 오케스트레이션 — 증분·재개·쿼터 가드.

사용 예:
  python pipeline/collect.py --lawd 11680 --from 202501 --to 202512
  python pipeline/collect.py --all                      # 전량 백필
  python pipeline/collect.py --all --refresh-recent 4   # 최근 4개월만 재수집
"""
from __future__ import annotations

import argparse
import sys
from datetime import date

import config as C
from db import connect, init_schema, set_meta
from fetch import Fetcher, QuotaExceeded, ServiceKeyError, utcnow
from load import load_month, log_fetch


def month_range(start: str, end: str) -> list[str]:
    """'200601','202608' -> ['200601', ..., '202608']"""
    sy, sm = int(start[:4]), int(start[4:])
    ey, em = int(end[:4]), int(end[4:])
    out, y, m = [], sy, sm
    while (y, m) <= (ey, em):
        out.append(f"{y:04d}{m:02d}")
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return out


def current_ym() -> str:
    t = date.today()
    return f"{t.year:04d}{t.month:02d}"


def shift_ym(ym: str, months: int) -> str:
    y, m = int(ym[:4]), int(ym[4:])
    total = y * 12 + (m - 1) + months
    return f"{total // 12:04d}{total % 12 + 1:02d}"


def is_done(conn, lawd: str, ymd: str) -> bool:
    row = conn.execute(
        "SELECT status FROM fetch_log WHERE lawd_cd=? AND deal_ymd=? AND page_no=1",
        (lawd, ymd),
    ).fetchone()
    return bool(row and row["status"] in ("ok", "empty"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lawd", default=None, help="시군구코드 (미지정 시 서울 25개 구)")
    ap.add_argument("--from", dest="ym_from", default=C.START_YM)
    ap.add_argument("--to", dest="ym_to", default=None)
    ap.add_argument("--all", action="store_true", help="서울 전역 × 전체 기간")
    ap.add_argument("--refresh-recent", type=int, default=None,
                    help="최근 N개월만 (재)수집")
    ap.add_argument("--force", action="store_true", help="이미 수집한 달도 다시")
    ap.add_argument("--from-cache", action="store_true",
                    help="API 호출 없이 저장된 원시 XML로 재적재")
    args = ap.parse_args()

    ym_to = args.ym_to or current_ym()
    ym_from = args.ym_from
    if args.refresh_recent:
        ym_from = shift_ym(ym_to, -(args.refresh_recent - 1))

    gus = [args.lawd] if args.lawd else list(C.SEOUL_GU)
    months = month_range(ym_from, ym_to)

    # 최근 N개월은 항상 재수집 (신고 지연 + 해제 신고 반영)
    refetch_from = shift_ym(current_ym(), -(C.RECENT_REFETCH_MONTHS - 1))

    conn = connect()
    init_schema(conn)

    try:
        fetcher = Fetcher()
    except ServiceKeyError as e:
        print(f"\n[중단] {e}\n", file=sys.stderr)
        return 2

    total_tasks = len(gus) * len(months)
    done = skipped = loaded = deleted = 0
    print(f"수집 대상: {len(gus)}개 구 × {len(months)}개월 = {total_tasks} 작업")
    print(f"기간 {ym_from} ~ {ym_to} · 최근 {C.RECENT_REFETCH_MONTHS}개월은 강제 재수집\n")

    try:
        for gu in gus:
            name = C.SEOUL_GU.get(gu, gu)
            for ymd in months:
                done += 1
                must_refetch = args.force or ymd >= refetch_from
                if not must_refetch and is_done(conn, gu, ymd):
                    skipped += 1
                    continue

                try:
                    items, total, status = fetcher.fetch_month(
                        gu, ymd, use_cache=args.from_cache
                    )
                except QuotaExceeded as e:
                    print(f"\n[쿼터] {e} — 안전 중단. 내일 같은 명령으로 재개하세요.")
                    raise
                except Exception as e:
                    log_fetch(conn, gu, ymd, status="error", result_code=str(e)[:100])
                    conn.commit()
                    print(f"  ! {name} {ymd} 실패: {e}")
                    continue

                n_in, n_del = load_month(conn, gu, ymd, items)
                loaded += n_in
                deleted += n_del
                log_fetch(conn, gu, ymd, status=status,
                          total_count=total, row_count=len(items), result_code="00")
                conn.commit()

                pct = done * 100 // total_tasks
                print(f"  [{pct:3d}%] {name} {ymd}  {len(items):5,}건"
                      + (f"  (-{n_del})" if n_del else ""), flush=True)

    except (QuotaExceeded, KeyboardInterrupt):
        conn.commit()
    finally:
        set_meta(conn, "last_collect_at", utcnow())
        conn.commit()

    print(f"\n완료: {done - skipped}개 작업 수행 (스킵 {skipped})")
    print(f"적재 {loaded:,}건 · 삭제(신고취소) {deleted:,}건 · API 호출 {fetcher.calls:,}회")
    n = conn.execute("SELECT COUNT(*) c FROM trade_raw").fetchone()["c"]
    print(f"trade_raw 총 {n:,}행")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
