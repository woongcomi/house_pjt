"""국토부 실거래가 API HTTP 레이어.

- 지수 백오프 재시도 (네트워크/5xx/XML 파싱 실패)
- resultCode 분류: 정상 / 쿼터 초과(즉시 중단) / 키 오류(즉시 중단)
- 원시 XML을 gz로 보존 → 파싱 로직 변경 시 API 재호출 불필요
"""
from __future__ import annotations

import gzip
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import unquote

import requests

import config as C
from parse import ApiError, parse_header, parse_items


class QuotaExceeded(RuntimeError):
    """일일 호출 한도 초과 — 수집을 즉시 중단하고 다음 날 재개."""


class ServiceKeyError(RuntimeError):
    """인증키 미등록/만료 — 사람 개입 필요."""


@dataclass
class PageResult:
    items: list[dict]
    total_count: int
    result_code: str
    http_status: int
    from_cache: bool


class Fetcher:
    def __init__(self, service_key: str | None = None, save_raw: bool = True):
        raw = (service_key or C.SERVICE_KEY).strip()
        # 포털은 Encoding/Decoding 두 형태의 키를 준다. Encoding 키(%2B, %3D 포함)를
        # 그대로 requests 에 넘기면 '%' 가 다시 %25 로 인코딩되어 인증이 실패한다.
        # 원본으로 되돌려 넘기면 requests 가 알아서 한 번만 인코딩한다.
        self.key = unquote(raw) if "%" in raw else raw
        if not self.key:
            raise ServiceKeyError(
                "DATA_GO_KR_KEY 가 비어 있습니다. .env 파일에 인증키를 넣어주세요.\n"
                "발급: https://www.data.go.kr/data/15126468/openapi.do"
            )
        self.save_raw = save_raw
        self.calls = 0
        self.session = requests.Session()
        self.session.headers["User-Agent"] = "house-pjt/1.0 (+data.go.kr open api)"

    # ── 원시 XML 캐시 ────────────────────────────────
    def _raw_path(self, lawd: str, ymd: str, page: int):
        d = C.RAW_DIR / lawd
        d.mkdir(parents=True, exist_ok=True)
        return d / f"{ymd}.p{page}.xml.gz"

    def _read_cache(self, lawd: str, ymd: str, page: int) -> str | None:
        p = self._raw_path(lawd, ymd, page)
        if p.exists():
            try:
                return gzip.decompress(p.read_bytes()).decode("utf-8")
            except OSError:
                return None
        return None

    def _write_cache(self, lawd: str, ymd: str, page: int, text: str) -> None:
        if self.save_raw:
            self._raw_path(lawd, ymd, page).write_bytes(
                gzip.compress(text.encode("utf-8"), 6)
            )

    # ── 호출 ─────────────────────────────────────────
    def fetch_page(
        self, lawd_cd: str, deal_ymd: str, page_no: int = 1, use_cache: bool = False
    ) -> PageResult:
        if use_cache:
            cached = self._read_cache(lawd_cd, deal_ymd, page_no)
            if cached is not None:
                code, _msg, total = parse_header(cached)
                items = parse_items(cached, lawd_cd, deal_ymd) if code in C.RESULT_OK else []
                return PageResult(items, total, code, 200, True)

        if self.calls >= C.DAILY_CALL_LIMIT - C.CALL_BUDGET_MARGIN:
            raise QuotaExceeded(f"세션 호출 한도 도달 ({self.calls}건)")

        params = {
            "serviceKey": self.key,
            "LAWD_CD": lawd_cd,
            "DEAL_YMD": deal_ymd,
            "pageNo": page_no,
            "numOfRows": C.NUM_OF_ROWS,
        }

        last_err: Exception | None = None
        for attempt in range(C.MAX_RETRY):
            if attempt:
                time.sleep(C.BACKOFF_BASE * (2 ** (attempt - 1)))
            try:
                r = self.session.get(C.API_URL, params=params, timeout=C.TIMEOUT_SEC)
                self.calls += 1
                time.sleep(C.REQUEST_INTERVAL_SEC)

                if r.status_code >= 500:
                    last_err = RuntimeError(f"HTTP {r.status_code}")
                    continue

                text = r.text
                code, msg, total = parse_header(text)   # XML 파싱 실패 시 예외 → 재시도

                if code in C.RESULT_QUOTA:
                    raise QuotaExceeded(f"[{code}] {msg}")
                if code in C.RESULT_KEY_ERROR:
                    raise ServiceKeyError(f"[{code}] {msg}")
                if code not in C.RESULT_OK:
                    raise ApiError(code, msg)

                self._write_cache(lawd_cd, deal_ymd, page_no, text)
                items = parse_items(text, lawd_cd, deal_ymd)
                return PageResult(items, total, code, r.status_code, False)

            except (QuotaExceeded, ServiceKeyError):
                raise
            except Exception as e:      # 네트워크·파싱·ApiError → 재시도
                last_err = e

        raise RuntimeError(
            f"{lawd_cd}/{deal_ymd} p{page_no} — {C.MAX_RETRY}회 재시도 실패: {last_err}"
        )

    def fetch_month(
        self, lawd_cd: str, deal_ymd: str, use_cache: bool = False
    ) -> tuple[list[dict], int, str]:
        """한 달치 전 페이지를 모아서 반환. (items, total_count, status)"""
        first = self.fetch_page(lawd_cd, deal_ymd, 1, use_cache)
        if first.total_count == 0:
            return [], 0, "empty"

        items = list(first.items)
        pages = -(-first.total_count // C.NUM_OF_ROWS)
        for p in range(2, pages + 1):
            items.extend(self.fetch_page(lawd_cd, deal_ymd, p, use_cache).items)

        return items, first.total_count, "ok"


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
