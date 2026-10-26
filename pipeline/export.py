"""프론트용 정적 JSON 생성.

임의 기간을 사용자가 자유롭게 고르므로 모든 조합을 미리 계산할 수 없다.
시계열 원본을 그대로 내려주고 브라우저가 계산한다.

포맷은 CSR(compressed sparse row) 컬럼형이다. 객체 배열로 내리면 키가
셀마다 반복되어 gzip 후에도 3~4배 커진다.

  off[i] .. off[i+1]  구간이 i번째 단지의 셀
  dt[]  는 이전 셀로부터의 월 델타 (첫 셀은 base 로부터)
  p[]   는 만원/평 정수, n[] 은 3개월 풀링 거래건수
"""
from __future__ import annotations

import gzip
import json
import shutil
import sys
from pathlib import Path

import config as C
from db import connect, get_meta
from metrics import ym_to_idx

BASE_IDX = ym_to_idx(C.START_YM)      # 2006-01


def _write(path: Path, obj) -> tuple[int, int]:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    data = text.encode("utf-8")
    path.write_bytes(data)
    return len(data), len(gzip.compress(data, 9))


def _series_block(rows: list[tuple]) -> dict:
    """rows: [(key, ym, p, n, amt)] — key 오름차순, key 내 ym 오름차순"""
    ids: list[str] = []
    off: list[int] = [0]
    dt: list[int] = []
    p: list[int] = []
    n: list[int] = []
    amt: list[int] = []

    cur = None
    prev_t = BASE_IDX
    for key, ym, ppa, cnt, amount in rows:
        if key != cur:
            if cur is not None:
                off.append(len(dt))
            ids.append(key)
            cur = key
            prev_t = BASE_IDX
        t = ym_to_idx(ym)
        dt.append(t - prev_t)
        prev_t = t
        p.append(int(round(ppa)))
        n.append(int(cnt))
        amt.append(int(amount) if amount is not None else 0)
    if cur is not None:
        off.append(len(dt))

    return {"ids": ids, "off": off, "dt": dt, "p": p, "n": n, "amt": amt}


def export_all(conn) -> dict:
    out = C.EXPORT_DIR
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)

    sizes: list[tuple[str, int, int]] = []

    # ── 단지 메타 ─────────────────────────────────────
    complexes = {
        r["canonical_id"]: dict(r)
        for r in conn.execute(
            "SELECT canonical_id, sgg_cd, umd_nm, apt_nm, build_year, n_trades, "
            "lat, lng FROM complex"
        )
    }

    search: list[list] = []
    gu_stats: dict[str, dict] = {}

    for sgg, name in C.ALL_GU.items():
        rows = conn.execute(
            """
            SELECT a.canonical_id, a.ym, a.idx_ppa, a.n, a.amount_ref
            FROM agg_complex_month a JOIN complex c USING (canonical_id)
            WHERE c.sgg_cd = ?
            ORDER BY a.canonical_id, a.ym
            """,
            (sgg,),
        ).fetchall()
        if not rows:
            continue

        block = _series_block([tuple(r) for r in rows])
        # 좌표는 소수점 6자리면 약 0.1m 정밀도. 그 이상은 용량만 먹는다.
        meta = []
        for cid in block["ids"]:
            c = complexes[cid]
            meta.append([
                c["apt_nm"], c["umd_nm"], c["build_year"] or 0, c["n_trades"],
                round(c["lat"], 6) if c["lat"] else 0,
                round(c["lng"], 6) if c["lng"] else 0,
            ])
            search.append([cid, c["apt_nm"], c["umd_nm"], sgg])

        raw, gz = _write(out / "gu" / f"{sgg}.json", {
            "v": 1, "sgg": sgg, "name": name, "base": BASE_IDX,
            "meta": meta, **block,
        })
        sizes.append((f"gu/{sgg}.json", raw, gz))
        gu_stats[sgg] = {"name": name, "complexes": len(block["ids"]),
                         "cells": len(block["dt"])}

        # 면적타입별 (단지 상세에서 지연 로드)
        arows = conn.execute(
            """
            SELECT a.canonical_id || '/' || a.bucket_id AS k, a.ym,
                   a.ppa_med, a.n, a.amount_med
            FROM agg_type_month a JOIN complex c USING (canonical_id)
            WHERE c.sgg_cd = ?
            ORDER BY a.canonical_id, a.bucket_id, a.ym
            """,
            (sgg,),
        ).fetchall()
        if arows:
            ablock = _series_block([tuple(r) for r in arows])
            labels = {
                f"{b['canonical_id']}/{b['bucket_id']}":
                    [b["label"], round(b["ar_rep"], 1), b["n_trades"]]
                for b in conn.execute(
                    "SELECT b.* FROM area_bucket b JOIN complex c USING (canonical_id) "
                    "WHERE c.sgg_cd = ?", (sgg,))
            }
            raw, gz = _write(out / "gu" / f"{sgg}.areas.json", {
                "v": 1, "sgg": sgg, "base": BASE_IDX,
                "labels": [labels.get(k, ["", 0, 0]) for k in ablock["ids"]],
                **ablock,
            })
            sizes.append((f"gu/{sgg}.areas.json", raw, gz))

    # ── 검색 인덱스 ───────────────────────────────────
    raw, gz = _write(out / "search.json", {"v": 1, "items": search})
    sizes.append(("search.json", raw, gz))

    # ── 구 단위 시장 시세 (대시보드용) ──────────────────
    region = {}
    for r in conn.execute(
        "SELECT region_kind, region_cd, ym, n, idx_ppa FROM agg_region_month "
        "ORDER BY region_kind, region_cd, ym"
    ):
        key = f"{r['region_kind']}:{r['region_cd']}"
        region.setdefault(key, {"t": [], "p": [], "n": []})
        region[key]["t"].append(ym_to_idx(r["ym"]))
        region[key]["p"].append(int(round(r["idx_ppa"])))
        region[key]["n"].append(r["n"])
    raw, gz = _write(out / "region.json", {"v": 1, "base": BASE_IDX, "region": region})
    sizes.append(("region.json", raw, gz))

    # ── 메타 ──────────────────────────────────────────
    last_ym = conn.execute("SELECT MAX(ym) m FROM agg_complex_month").fetchone()["m"]
    n_complex = conn.execute("SELECT COUNT(*) c FROM complex").fetchone()["c"]
    n_trade = conn.execute("SELECT COUNT(*) c FROM trade").fetchone()["c"]
    raw, gz = _write(out / "meta.json", {
        "v": 1,
        "base": BASE_IDX,
        "startYm": C.START_YM,
        "lastYm": last_ym,
        "complexes": n_complex,
        "trades": n_trade,
        "geocoded": conn.execute(
            "SELECT COUNT(*) c FROM complex WHERE lat IS NOT NULL"
        ).fetchone()["c"],
        "gu": gu_stats,
        "builtAt": get_meta(conn, "last_build_at"),
        "collectedAt": get_meta(conn, "last_collect_at"),
        "note": "국토교통부 실거래가 · 전용면적 기준 평당가",
    })
    sizes.append(("meta.json", raw, gz))

    return {"files": sizes, "total_raw": sum(s[1] for s in sizes),
            "total_gz": sum(s[2] for s in sizes)}


def main() -> int:
    conn = connect()
    if conn.execute("SELECT COUNT(*) c FROM agg_complex_month").fetchone()["c"] == 0:
        print("집계가 비어 있습니다. build.py 를 먼저 실행하세요.")
        return 1

    r = export_all(conn)
    print(f"{'파일':32s} {'원본':>10s} {'gzip':>10s}")
    print("-" * 54)
    big = sorted(r["files"], key=lambda x: -x[2])[:8]
    for name, raw, gz in big:
        print(f"{name:32s} {raw/1024:9.0f}K {gz/1024:9.0f}K")
    if len(r["files"]) > 8:
        print(f"... 외 {len(r['files']) - 8}개")
    print("-" * 54)
    print(f"{'합계 (' + str(len(r['files'])) + '개 파일)':32s} "
          f"{r['total_raw']/1024/1024:8.1f}M {r['total_gz']/1024/1024:8.1f}M")
    print(f"\n→ {C.EXPORT_DIR}")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
