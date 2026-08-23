/**
 * 지표 파라미터 — pipeline/config.py 와 반드시 일치해야 한다.
 * 두 구현은 pipeline/tests/fixtures/golden_metrics.json 으로 묶여 있다.
 */
export const CARRY_FORWARD_MAX = 6;
export const CARRY_BACKWARD_MAX = 2;

export const RANK_MIN_PERIOD_TRADES = 5;
export const RANK_MIN_OBS_MONTHS = 3;
export const RANK_MAX_STALENESS = 6;
export const RANK_MIN_LIFE_TRADES = 20;

export const CONF_A_TRADES = 15;
export const CONF_A_STALENESS = 1;

/** ㎡ → 평 */
export const PYEONG_PER_M2 = 1 / 3.305785;
