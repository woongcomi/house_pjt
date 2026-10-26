"""실거래가 수집기.

  최초 적재:  .venv/Scripts/python -m rebot.collect --months 60
  매일 갱신:  .venv/Scripts/python -m rebot.collect            (최근 3개월 재수집)

실거래 신고는 계약 후 30일 이내라 최근 몇 달은 매번 다시 받아 신규/해제 건을 반영한다.
"""

import argparse
import sys
import time
from datetime import date

import httpx

from rebot import config, db, molit
from rebot.regions import REGIONS


def month_range(months: int, end: date | None = None) -> list[str]:
    """이번 달부터 거슬러 months 개의 YYYYMM (오래된 순)."""
    end = end or date.today()
    y, m = end.year, end.month
    out = []
    for _ in range(months):
        out.append(f"{y:04d}{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out[::-1]


def run(months: int, regions: list[str], pause: float = 0.3) -> None:
    key = config.get("DATA_GO_KR_KEY")
    yms = month_range(months)
    total_new = 0
    with db.connect() as con, httpx.Client() as client:
        for ym in yms:
            for code in regions:
                try:
                    deals = molit.fetch_month(client, key, code, ym)
                except molit.QuotaExceeded:
                    print("일일 호출 한도 초과. 내일 이어서 받으세요.")
                    con.commit()
                    sys.exit(2)
                new = db.upsert_deals(con, deals)
                db.log_fetch(con, code, ym, len(deals))
                con.commit()
                total_new += new
                print(f"{ym} {REGIONS[code].name}: {len(deals)}건 (신규 {new})", flush=True)
                time.sleep(pause)
    print(f"완료. 신규 {total_new}건")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--months", type=int, default=3, help="수집할 최근 개월 수")
    ap.add_argument("--regions", nargs="*", default=list(REGIONS), help="LAWD_CD 목록")
    args = ap.parse_args()
    run(args.months, args.regions)
