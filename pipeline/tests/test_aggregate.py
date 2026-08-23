"""믹스 보정 검증.

가격이 전혀 변하지 않는데 거래된 면적타입만 달마다 바뀌는 상황에서
지수가 평평하게 유지되는지 확인한다. 이게 무너지면 변동폭 랭킹 전체가
노이즈가 되므로 이 프로젝트에서 가장 중요한 테스트다.
"""
from __future__ import annotations

import math
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config as C
import aggregate
from metrics import ym_to_idx

SCHEMA = (Path(__file__).resolve().parent.parent / "schema.sql").read_text(encoding="utf-8")

# 실제 서울 아파트의 전형적 패턴: 소형이 평당가가 높다
PPA = {0: 5200.0, 1: 4600.0}          # bucket 0 = 59㎡, bucket 1 = 84㎡
PYEONG = {0: 17.9, 1: 25.7}


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def _seed(conn, trades, weights=(0.5, 0.5)):
    """trades: [(bucket_id, 'YYYY-MM', ppa, n_trades)]"""
    for bid, w in enumerate(weights):
        conn.execute(
            "INSERT INTO area_bucket (canonical_id,bucket_id,ar_min,ar_max,ar_rep,"
            "pyeong_rep,label,coarse,n_trades,weight,delta) "
            "VALUES ('X',?,?,?,?,?,?,?,?,?,0)",
            (bid, 50 + bid * 25, 60 + bid * 25, 59 + bid * 25,
             PYEONG[bid], f"{59 + bid*25}㎡", "M85", 100, w),
        )
    k = 0
    for bid, ym, ppa, n in trades:
        for i in range(n):
            k += 1
            amount = ppa * PYEONG[bid]
            conn.execute(
                "INSERT INTO trade (dedup_key,canonical_id,bucket_id,deal_ym,"
                "deal_date,deal_amount,excl_ar,floor,floor_grp,ppa,ln_ppa,dealing_gbn)"
                " VALUES (?,'X',?,?,?,?,?,?,1,?,?,'중개거래')",
                (f"k{k}", bid, ym, f"{ym}-15", int(amount), 59 + bid * 25,
                 5 + i, ppa, math.log(ppa)),
            )
    conn.commit()


def _index(conn):
    return {
        r["ym"]: r["idx_ppa"]
        for r in conn.execute(
            "SELECT ym, idx_ppa FROM agg_complex_month ORDER BY ym"
        )
    }


def test_alternating_area_mix_does_not_move_index():
    """가격 고정, 거래 타입만 교대 → 지수는 평평해야 한다."""
    conn = _db()
    months = [f"2023-{m:02d}" for m in range(1, 13)]
    trades = []
    for i, ym in enumerate(months):
        bid = i % 2                       # 59㎡ / 84㎡ 번갈아
        trades.append((bid, ym, PPA[bid], 3))
    _seed(conn, trades)

    aggregate.build(conn)
    idx = _index(conn)
    assert len(idx) >= 10

    vals = list(idx.values())
    spread = max(vals) / min(vals) - 1
    assert spread < 0.02, (
        f"믹스 보정 실패: 가격이 안 변했는데 지수가 {spread:.1%} 흔들림. "
        f"보정이 없으면 약 13% 가 나온다"
    )


def test_naive_median_would_have_been_wrong():
    """대조군: 보정 없는 단순 중위값이면 실제로 크게 흔들린다는 걸 보인다."""
    naive_high = PPA[0]
    naive_low = PPA[1]
    assert naive_high / naive_low - 1 > 0.12, (
        "이 픽스처는 보정 없이는 13% 흔들리는 상황을 재현해야 한다"
    )


def test_real_price_move_is_preserved():
    """믹스는 고정하고 가격만 +20% → 지수도 +20% 여야 한다 (과잉 보정 방지)."""
    conn = _db()
    trades = []
    for m in range(1, 7):
        trades.append((0, f"2023-{m:02d}", PPA[0], 3))
        trades.append((1, f"2023-{m:02d}", PPA[1], 3))
    for m in range(7, 13):
        trades.append((0, f"2023-{m:02d}", PPA[0] * 1.2, 3))
        trades.append((1, f"2023-{m:02d}", PPA[1] * 1.2, 3))
    _seed(conn, trades)

    aggregate.build(conn)
    idx = _index(conn)
    ratio = idx["2023-12"] / idx["2023-01"]
    assert ratio == pytest.approx(1.2, rel=0.02), f"실제 가격 변동이 소실됨: {ratio:.3f}"


def test_index_level_is_weighted_average_of_types():
    """지수 수준은 단지의 '평균 타입' 가격이어야 한다 (한쪽 타입 값이 아님)."""
    conn = _db()
    trades = []
    for m in range(1, 13):
        trades.append((0, f"2023-{m:02d}", PPA[0], 3))
        trades.append((1, f"2023-{m:02d}", PPA[1], 3))
    _seed(conn, trades, weights=(0.5, 0.5))

    aggregate.build(conn)
    v = list(_index(conn).values())[6]
    geo_mean = math.sqrt(PPA[0] * PPA[1])
    assert v == pytest.approx(geo_mean, rel=0.02), (
        f"지수 {v:.0f} 가 두 타입의 가중 기하평균 {geo_mean:.0f} 과 다름"
    )


def test_weighting_follows_bucket_weight():
    """84㎡ 비중이 90% 인 단지는 지수가 84㎡ 가격에 가까워야 한다."""
    conn = _db()
    trades = []
    for m in range(1, 13):
        trades.append((0, f"2023-{m:02d}", PPA[0], 1))
        trades.append((1, f"2023-{m:02d}", PPA[1], 9))
    _seed(conn, trades, weights=(0.1, 0.9))

    aggregate.build(conn)
    v = list(_index(conn).values())[6]
    assert abs(v - PPA[1]) < abs(v - PPA[0]), (
        f"지수 {v:.0f} 가 비중 90% 인 84㎡({PPA[1]}) 쪽으로 기울지 않음"
    )


def test_amount_ref_uses_dominant_type():
    """실금액 환산은 거래 비중이 가장 큰 대표 타입 기준."""
    conn = _db()
    trades = []
    for m in range(1, 13):
        trades.append((0, f"2023-{m:02d}", PPA[0], 1))
        trades.append((1, f"2023-{m:02d}", PPA[1], 9))
    _seed(conn, trades, weights=(0.1, 0.9))

    aggregate.build(conn)
    row = conn.execute(
        "SELECT amount_ref FROM agg_complex_month WHERE ym='2023-06'"
    ).fetchone()
    expected = PPA[1] * PYEONG[1]
    assert row["amount_ref"] == pytest.approx(expected, rel=0.03)


def test_last_month_uses_trailing_window():
    """마지막 월은 미래가 없으므로 후행 창을 쓴다 (관측 손실 방지)."""
    conn = _db()
    trades = [(0, f"2023-{m:02d}", PPA[0], 3) for m in range(1, 7)]
    _seed(conn, trades)

    aggregate.build(conn)
    idx = _index(conn)
    assert "2023-06" in idx, "마지막 월이 집계에서 빠지면 최신 시세를 못 보여준다"
