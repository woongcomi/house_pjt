"""지표 엔진 골든 테스트.

web/tests/metrics.test.ts 가 동일한 golden_metrics.json 을 로드한다.
두 구현이 갈라지면 여기서 먼저 잡힌다.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config as C
from metrics import Series, compute, rank, ym_to_idx, idx_to_ym

FIXTURE = Path(__file__).parent / "fixtures" / "golden_metrics.json"
GOLDEN = json.loads(FIXTURE.read_text(encoding="utf-8"))
TOL = GOLDEN["tolerance"]


@pytest.mark.parametrize("case", GOLDEN["cases"], ids=lambda c: c["name"])
def test_golden_case(case):
    result = compute(Series(**case["series"]), case["t0"], case["t1"]).to_dict()
    for key, expected in case["expect"].items():
        actual = result[key]
        if isinstance(expected, float):
            assert actual == pytest.approx(expected, abs=TOL), (
                f"{case['name']}.{key}: {actual} != {expected}"
            )
        else:
            assert actual == expected, f"{case['name']}.{key}: {actual!r} != {expected!r}"


def test_fixture_config_matches_source():
    """픽스처가 가정한 임계값이 config.py 와 어긋나면 골든 테스트가 무의미해진다."""
    for key, expected in GOLDEN["config"].items():
        assert getattr(C, key) == expected, (
            f"config.{key}={getattr(C, key)} 인데 픽스처는 {expected} 를 가정함"
        )


def test_ym_roundtrip():
    for ym in ("2006-01", "2021-10", "2026-12"):
        assert idx_to_ym(ym_to_idx(ym)) == ym
    assert ym_to_idx("202103") == ym_to_idx("2021-03")
    assert ym_to_idx("2021-02") - ym_to_idx("2021-01") == 1
    assert ym_to_idx("2022-01") - ym_to_idx("2021-12") == 1


def test_reversed_period_is_normalized():
    s = Series(t=[0, 12], p=[1000, 1200], n=[5, 5], n_life=50)
    assert compute(s, 12, 0).ret == pytest.approx(compute(s, 0, 12).ret)


def test_rank_ties_share_position_and_skip():
    """동률은 같은 순위, 다음은 건너뛴다 (1,2,2,4)."""
    def mk(ret):
        s = Series(t=[0, 12, 24], p=[1000, 1000 * (1 + ret / 2), 1000 * (1 + ret)],
                   n=[5, 5, 5], n_life=50)
        return compute(s, 0, 24)

    rows = rank([("a", mk(0.30)), ("b", mk(0.20)), ("c", mk(0.20)), ("d", mk(0.10))])
    assert [r["rank"] for r in rows] == [1, 2, 2, 4]
    assert [r["id"] for r in rows] == ["a", "b", "c", "d"]


def test_rank_excludes_ineligible():
    thin = Series(t=[0, 12, 24], p=[1000, 1200, 1500], n=[1, 1, 1], n_life=50)
    thick = Series(t=[0, 12, 24], p=[1000, 1050, 1100], n=[8, 8, 8], n_life=50)
    rows = rank([("thin", compute(thin, 0, 24)), ("thick", compute(thick, 0, 24))])
    assert [r["id"] for r in rows] == ["thick"], "표본 부족 단지가 상위권을 차지하면 안 됨"


def test_volatility_ignores_time_order_but_mdd_does_not():
    """사용자 요구인 V(고점/저점 비율)는 순서를 무시한다. MDD 를 함께 봐야 하는 근거."""
    rise = compute(Series(t=[0, 12, 24], p=[1000, 1400, 1500], n=[6, 6, 6], n_life=50), 0, 24)
    fall = compute(Series(t=[0, 12, 24], p=[1500, 1400, 1000], n=[6, 6, 6], n_life=50), 0, 24)
    assert rise.volatility == pytest.approx(fall.volatility)   # 둘 다 +50%
    assert rise.mdd == pytest.approx(0.0)                       # 상승장은 낙폭 없음
    assert fall.mdd == pytest.approx(-1 / 3)                    # 하락장은 -33%


def test_carry_forward_limit_boundary():
    s = Series(t=[0], p=[1000], n=[5], n_life=50)
    assert compute(s, 0, C.CARRY_FORWARD_MAX).ok is True
    assert compute(s, 0, C.CARRY_FORWARD_MAX + 1).ok is False


def test_carry_backward_limit_boundary():
    s = Series(t=[10], p=[1000], n=[5], n_life=50)
    assert compute(s, 10 - C.CARRY_BACKWARD_MAX, 10).ok is True
    assert compute(s, 10 - C.CARRY_BACKWARD_MAX - 1, 10).ok is False
