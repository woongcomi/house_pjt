-- 서울 아파트 실거래가 분석 서비스 스키마
-- 원칙: raw는 API 응답 1:1 보존, 정제/집계는 파생 테이블로 재생성 가능하게

-- ─────────────────────────────────────────────────────────
-- 수집 상태 (페이지 단위)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fetch_log (
  lawd_cd     TEXT NOT NULL,
  deal_ymd    TEXT NOT NULL,          -- 'YYYYMM'
  page_no     INTEGER NOT NULL,
  status      TEXT NOT NULL,          -- ok | empty | error | quota
  http_status INTEGER,
  result_code TEXT,
  total_count INTEGER,
  row_count   INTEGER,
  fetched_at  TEXT,
  PRIMARY KEY (lawd_cd, deal_ymd, page_no)
);

-- ─────────────────────────────────────────────────────────
-- 원시 거래 (API 필드 1:1)
-- dedup_key = sha1(apt_seq|deal_date|deal_amount|excl_ar|floor|apt_dong)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trade_raw (
  dedup_key   TEXT PRIMARY KEY,
  apt_seq     TEXT,
  sgg_cd      TEXT,
  umd_cd      TEXT,
  umd_nm      TEXT,
  bonbun      TEXT,
  bubun       TEXT,
  jibun       TEXT,
  apt_nm      TEXT,
  apt_dong    TEXT,
  build_year  INTEGER,
  excl_ar     REAL,                   -- 전용면적 ㎡
  floor       INTEGER,
  deal_ym     TEXT,                   -- 'YYYY-MM'
  deal_date   TEXT,                   -- 'YYYY-MM-DD'
  deal_amount INTEGER,                -- 만원
  dealing_gbn TEXT,                   -- 중개거래 | 직거래 | ''
  sler_gbn    TEXT,
  buyer_gbn   TEXT,
  cdeal_type  TEXT,                   -- 'O' = 해제
  cdeal_day   TEXT,
  rgst_date   TEXT,
  land_leasehold_gbn TEXT,
  estate_agent_sgg_nm TEXT,
  road_nm     TEXT,
  src_lawd    TEXT NOT NULL,          -- 어느 (구,월) 응답에서 왔는지
  src_ymd     TEXT NOT NULL,
  seen_at     TEXT,
  stale       INTEGER DEFAULT 0       -- 재수집 시 사라진 건 탐지용
);
CREATE INDEX IF NOT EXISTS ix_raw_apt_ym ON trade_raw(apt_seq, deal_ym);
CREATE INDEX IF NOT EXISTS ix_raw_src    ON trade_raw(src_lawd, src_ymd);
CREATE INDEX IF NOT EXISTS ix_raw_sgg_ym ON trade_raw(sgg_cd, deal_ym);

-- ─────────────────────────────────────────────────────────
-- 단지 마스터
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS complex (
  canonical_id TEXT PRIMARY KEY,      -- 기본은 apt_seq
  sgg_cd       TEXT,
  umd_cd       TEXT,
  umd_nm       TEXT,
  apt_nm       TEXT,
  apt_nm_norm  TEXT,
  build_year   INTEGER,
  bonbun       TEXT,
  bubun        TEXT,
  first_ym     TEXT,
  last_ym      TEXT,
  n_trades     INTEGER,
  n_months     INTEGER,
  -- 지오코딩 결과 (pipeline/geocode.py). 실거래가 API 는 좌표를 주지 않아
  -- 지번주소를 카카오 로컬 API 로 변환해 채운다.
  lat          REAL,
  lng          REAL,
  geo_src      TEXT,      -- address | keyword | manual
  geo_at       TEXT
);
CREATE INDEX IF NOT EXISTS ix_complex_sgg ON complex(sgg_cd);

-- apt_seq -> canonical_id 매핑 (재건축/명칭변경 병합 검토 결과)
CREATE TABLE IF NOT EXISTS complex_alias (
  apt_seq      TEXT PRIMARY KEY,
  canonical_id TEXT NOT NULL,
  reviewed     INTEGER DEFAULT 0,
  note         TEXT
);

-- ─────────────────────────────────────────────────────────
-- 면적 타입 버킷 (단지 내 전용면적 클러스터)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS area_bucket (
  canonical_id TEXT NOT NULL,
  bucket_id    INTEGER NOT NULL,
  ar_min       REAL,
  ar_max       REAL,
  ar_rep       REAL,                  -- 대표 전용면적 ㎡
  pyeong_rep   REAL,                  -- 대표 전용 평
  label        TEXT,                  -- '84㎡'
  coarse       TEXT,                  -- S60 | M85 | L135 | XL
  n_trades     INTEGER,
  weight       REAL,                  -- 고정 가중치 w_b (시간 불변)
  delta        REAL,                  -- 타입 고정효과 δ_b (log)
  PRIMARY KEY (canonical_id, bucket_id)
);

-- ─────────────────────────────────────────────────────────
-- 정제 거래 (분석용)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trade (
  dedup_key    TEXT PRIMARY KEY,
  canonical_id TEXT NOT NULL,
  bucket_id    INTEGER NOT NULL,
  deal_ym      TEXT NOT NULL,
  deal_date    TEXT,
  deal_amount  INTEGER,
  excl_ar      REAL,
  floor        INTEGER,
  floor_grp    INTEGER,               -- 0 저층(1~3) 1 중층 2 최상층
  ppa          REAL,                  -- 만원/평 (전용면적 기준)
  ln_ppa       REAL,
  dealing_gbn  TEXT
);
CREATE INDEX IF NOT EXISTS ix_trade_cbym ON trade(canonical_id, bucket_id, deal_ym);
CREATE INDEX IF NOT EXISTS ix_trade_ym   ON trade(deal_ym);

-- ─────────────────────────────────────────────────────────
-- 집계
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agg_type_month (
  canonical_id TEXT, bucket_id INTEGER, ym TEXT,
  n        INTEGER,                   -- 3개월 풀링 건수
  n_raw    INTEGER,                   -- 해당 월 단독 건수
  ln_med   REAL,
  ppa_med  REAL,
  amount_med INTEGER,
  PRIMARY KEY (canonical_id, bucket_id, ym)
);

CREATE TABLE IF NOT EXISTS agg_complex_month (
  canonical_id TEXT, ym TEXT,
  n          INTEGER,                 -- 3개월 풀링 총 건수
  n_raw      INTEGER,
  n_buckets  INTEGER,
  idx_ppa    REAL,                    -- 믹스보정 지수 (만원/평, 전용)
  amount_ref INTEGER,                 -- 대표타입 환산 실금액 (만원)
  PRIMARY KEY (canonical_id, ym)
);

CREATE TABLE IF NOT EXISTS agg_region_month (
  region_kind TEXT, region_cd TEXT, ym TEXT,   -- sgg | umd | seoul
  n       INTEGER,
  ppa_med REAL,
  idx_ppa REAL,
  PRIMARY KEY (region_kind, region_cd, ym)
);

-- 파이프라인 실행 메타
CREATE TABLE IF NOT EXISTS pipeline_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
