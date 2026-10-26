"""정적 사이트 데이터 생성: SQLite → docs/data/*.json (GitHub Pages 가 docs/ 를 그대로 서빙).

실행: .venv/Scripts/python -m rebot.build_site
로컬 확인: .venv/Scripts/python -m http.server -d docs 8000
"""

import json
import shutil
from collections import defaultdict
from datetime import date, datetime, timedelta
from statistics import median

from rebot import db
from rebot.config import ROOT
from rebot.regions import REGIONS, STATIONS, stations_for_umd

PYEONG = 3.3058
OUT = ROOT / "docs" / "data"
RECENT_DAYS = 90
REF_DAYS = 365  # 저가 판정 기준: 동일 단지·면적형 직전 1년 중위가
REF_MIN_DEALS = 3


def load_deals(con) -> list[dict]:
    rows = con.execute(
        "SELECT id, sgg_cd, umd_nm, apt_seq, apt_nm, build_year, area, floor, deal_date, amount "
        "FROM deals WHERE canceled = 0 AND area > 0 ORDER BY deal_date"
    ).fetchall()
    deals = []
    for r in rows:
        d = dict(r)
        d["pp"] = round(d["amount"] / (d["area"] / PYEONG))  # 만원/평
        d["st"] = stations_for_umd(d["sgg_cd"], d["umd_nm"])
        deals.append(d)
    return deals


def month_list(first: str, last: str) -> list[str]:
    y, m = int(first[:4]), int(first[5:7])
    out = []
    while f"{y:04d}-{m:02d}" <= last:
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def monthly_series(deals: list[dict], months: list[str]) -> dict:
    by_month: dict[str, list[int]] = defaultdict(list)
    for d in deals:
        by_month[d["deal_date"][:7]].append(d["pp"])
    return {
        "count": [len(by_month.get(m, [])) for m in months],
        "median": [round(median(v)) if (v := by_month.get(m)) else None for m in months],
    }


def window_median(deals: list[dict], start: date, end: date) -> int | None:
    pps = [d["pp"] for d in deals if start.isoformat() <= d["deal_date"] < end.isoformat()]
    return round(median(pps)) if pps else None


def scope_block(deals: list[dict], months: list[str], today: date) -> dict:
    """한 범위(전체/구/역)의 월별 시계열 + 최근 90일 vs 1년 전 같은 기간 중위 평당가."""
    block = monthly_series(deals, months)
    block["m3"] = window_median(deals, today - timedelta(days=90), today + timedelta(days=1))
    block["m3_prev"] = window_median(
        deals, today - timedelta(days=455), today - timedelta(days=364)
    )
    return block


def attach_reference(deals: list[dict]) -> None:
    """각 거래에 '동일 단지·면적형 직전 1년 중위 거래가' 대비 비율(pct)을 붙인다."""
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for d in deals:
        groups[(d["apt_seq"], round(d["area"]))].append(d)  # deal_date 순 유지
    for group in groups.values():
        for i, d in enumerate(group):
            cutoff = (date.fromisoformat(d["deal_date"]) - timedelta(days=REF_DAYS)).isoformat()
            prior = [g["amount"] for g in group[:i] if g["deal_date"] >= cutoff]
            if len(prior) >= REF_MIN_DEALS:
                ref = median(prior)
                d["ref"] = round(ref)
                d["pct"] = round((d["amount"] / ref - 1) * 100, 1)
            else:
                d["ref"] = d["pct"] = None


def build() -> None:
    today = date.today()
    with db.connect() as con:
        deals = load_deals(con)
    if not deals:
        raise SystemExit("거래 데이터가 없습니다. 먼저 rebot.collect 를 실행하세요.")

    months = month_list(deals[0]["deal_date"][:7], deals[-1]["deal_date"][:7])
    attach_reference(deals)

    # ── monthly.json: 전체 / 구 / 역 시계열 ─────────────────────────────
    by_region: dict[str, list[dict]] = defaultdict(list)
    by_station: dict[str, list[dict]] = defaultdict(list)
    for d in deals:
        by_region[d["sgg_cd"]].append(d)
        for s in d["st"]:
            by_station[s].append(d)
    monthly = {
        "months": months,
        "all": scope_block(deals, months, today),
        "regions": {
            code: {"name": REGIONS[code].name, **scope_block(by_region[code], months, today)}
            for code in REGIONS
        },
        "stations": {
            s.name: {"region": s.region_code, **scope_block(by_station[s.name], months, today)}
            for s in STATIONS
        },
    }

    # ── recent.json: 최근 90일 거래 (저가 판정 포함) ─────────────────────
    cutoff = (today - timedelta(days=RECENT_DAYS)).isoformat()
    recent = [
        {
            "d": d["deal_date"],
            "sgg": d["sgg_cd"],
            "umd": d["umd_nm"],
            "st": d["st"],
            "seq": d["apt_seq"],
            "apt": d["apt_nm"],
            "area": d["area"],
            "fl": d["floor"],
            "amt": d["amount"],
            "pp": d["pp"],
            "ref": d["ref"],
            "pct": d["pct"],
        }
        for d in reversed(deals)
        if d["deal_date"] >= cutoff
    ]

    # ── complexes.json + apt/<seq>.json: 역세권 단지 검색·상세 ─────────────
    by_apt: dict[str, list[dict]] = defaultdict(list)
    for d in deals:
        if d["st"]:
            by_apt[d["apt_seq"]].append(d)
    apt_dir = OUT / "apt"
    shutil.rmtree(apt_dir, ignore_errors=True)
    apt_dir.mkdir(parents=True)
    complexes = []
    for seq, ds in by_apt.items():
        last = ds[-1]
        complexes.append(
            {
                "seq": seq,
                "name": last["apt_nm"],
                "sgg": last["sgg_cd"],
                "umd": last["umd_nm"],
                "st": last["st"],
                "by": last["build_year"],
                "n": len(ds),
                "last": last["deal_date"],
            }
        )
        (apt_dir / f"{seq}.json").write_text(
            json.dumps(
                {
                    "name": last["apt_nm"],
                    "umd": last["umd_nm"],
                    "deals": [
                        [d["deal_date"], d["area"], d["floor"], d["amount"], d["pp"], d["pct"]]
                        for d in ds
                    ],
                },
                ensure_ascii=False,
                separators=(",", ":"),
            ),
            encoding="utf-8",
        )
    complexes.sort(key=lambda c: -c["n"])

    meta = {
        "generated_at": datetime.now().isoformat(timespec="minutes"),
        "today": today.isoformat(),
        "first_month": months[0],
        "last_month": months[-1],
        "deals": len(deals),
        "regions": [{"code": c, "name": r.name, "sido": r.sido} for c, r in REGIONS.items()],
        "stations": [{"name": s.name, "region": s.region_code} for s in STATIONS],
        "recent_days": RECENT_DAYS,
    }

    OUT.mkdir(parents=True, exist_ok=True)
    for name, obj in [
        ("meta", meta),
        ("monthly", monthly),
        ("recent", recent),
        ("complexes", complexes),
    ]:
        (OUT / f"{name}.json").write_text(
            json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
    print(
        f"생성 완료: 거래 {len(deals):,}건, {months[0]}~{months[-1]}, "
        f"최근 {RECENT_DAYS}일 {len(recent):,}건, 역세권 단지 {len(complexes):,}개"
    )


if __name__ == "__main__":
    build()
