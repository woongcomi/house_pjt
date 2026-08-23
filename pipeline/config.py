"""프로젝트 전역 설정 — 모든 임계값의 단일 출처.

여기 있는 지표 파라미터는 web/lib/metrics.ts 와 반드시 일치해야 한다.
두 구현은 pipeline/tests/fixtures/golden_metrics.json 으로 묶여 있다.
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# ─── 경로 ──────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
SAMPLE_DIR = DATA_DIR / "samples"
FROZEN_DIR = DATA_DIR / "frozen"
DB_PATH = DATA_DIR / "house.db"
EXPORT_DIR = ROOT / "web" / "public" / "data"
SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"

load_dotenv(ROOT / ".env")
SERVICE_KEY = os.getenv("DATA_GO_KR_KEY", "").strip()

# ─── API ───────────────────────────────────────────────
API_URL = (
    "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev"
    "/getRTMSDataSvcAptTradeDev"
)
NUM_OF_ROWS = 1000          # M0에서 실제 상한 검증 후 확정
MAX_RETRY = 5
BACKOFF_BASE = 1.0          # 1 → 2 → 4 → 8 → 16초
TIMEOUT_SEC = 20
REQUEST_INTERVAL_SEC = 0.25
DAILY_CALL_LIMIT = 10_000
CALL_BUDGET_MARGIN = 200    # 재시도 여유분

# 성공/실패 판정용 resultCode
RESULT_OK = {"00", "000"}
RESULT_QUOTA = {"22"}                 # 호출 한도 초과 → 즉시 중단
RESULT_KEY_ERROR = {"30", "31", "32"} # 키 문제 → 즉시 중단, 사람 개입

# ─── 수집 범위 ──────────────────────────────────────────
START_YM = "200601"
RECENT_REFETCH_MONTHS = 4   # 최근 N개월은 항상 재수집 (신고지연 + 해제신고)
FROZEN_LAG_MONTHS = 13      # 이보다 오래된 달은 확정으로 간주

# 서울특별시 25개 자치구 (법정동 시군구코드 5자리)
SEOUL_GU = {
    "11110": "종로구",  "11140": "중구",    "11170": "용산구",
    "11200": "성동구",  "11215": "광진구",  "11230": "동대문구",
    "11260": "중랑구",  "11290": "성북구",  "11305": "강북구",
    "11320": "도봉구",  "11350": "노원구",  "11380": "은평구",
    "11410": "서대문구", "11440": "마포구",  "11470": "양천구",
    "11500": "강서구",  "11530": "구로구",  "11545": "금천구",
    "11560": "영등포구", "11590": "동작구",  "11620": "관악구",
    "11650": "서초구",  "11680": "강남구",  "11710": "송파구",
    "11740": "강동구",
}

# ─── 정제 ──────────────────────────────────────────────
PYEONG_PER_M2 = 1 / 3.305785          # ㎡ → 평
EXCLUDE_CANCELLED = True              # cdealType == 'O'
EXCLUDE_DIRECT_DEAL = True            # dealingGbn == '직거래'
EXCLUDE_LAND_LEASEHOLD = True         # 토지임대부

AR_MIN, AR_MAX = 5.0, 500.0           # 전용면적 하드 레인지 (㎡)
PPA_MIN, PPA_MAX = 200.0, 30_000.0    # 평당가 하드 레인지 (만원/평, 전용)

MAD_Z_THRESHOLD = 3.5                 # 로버스트 이상치 컷
MAD_WINDOW_MONTHS = 12                # ±N개월 롤링 창
MAD_WINDOW_FALLBACK = 24              # 표본 부족 시 확대
MAD_MIN_SAMPLE = 5                    # 이보다 적으면 MAD 미적용
# MAD 하한 (로그 스케일). 같은 단지·같은 평형이라도 층·향·상태에 따라 가격은
# 최소 몇 %씩 벌어지는 게 정상인데, 창 표본이 적으면 MAD 가 0 에 수렴해
# z 가 폭발하고 멀쩡한 저층/대형 거래가 잘려나간다. 0.05 는 σ≈7.4%,
# 3.5σ≈±26% 에 해당해 로얄층 프리미엄은 살리고 자릿수 오기입만 잡는다.
MAD_FLOOR = 0.05

AREA_BUCKET_GAP = 3.0                 # 인접 면적 간격이 이보다 크면 분리 (㎡)
AREA_BUCKET_MIN_TRADES = 3            # 미만이면 인접 버킷에 흡수
COARSE_BOUNDS = [(0, 60, "S60"), (60, 85, "M85"), (85, 135, "L135"), (135, 1e9, "XL")]

FLOOR_LOW_MAX = 3                     # 1~3층 = 저층

# ─── 지표 (web/lib/metrics.ts 와 동기화 필수) ─────────────
SMOOTH_WINDOW = 3          # 중심 3개월 풀링
CARRY_FORWARD_MAX = 6      # 앵커: T 이전 최대 N개월까지 캐리포워드
CARRY_BACKWARD_MAX = 2     # 앵커: T 이후 최대 N개월까지 캐리백워드

RANK_MIN_PERIOD_TRADES = 5   # 기간 내 최소 실거래 건수
RANK_MIN_OBS_MONTHS = 3      # 기간 내 최소 관측 월 수
RANK_MAX_STALENESS = 6       # 앵커 최대 노후도 (개월)
RANK_MIN_LIFE_TRADES = 20    # 생애 최소 거래 건수 (믹스보정 신뢰 하한)

CONF_A_TRADES = 15           # 신뢰도 A 기준
CONF_A_STALENESS = 1
