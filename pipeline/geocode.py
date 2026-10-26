"""단지 좌표 확보 — 카카오 로컬 API.

국토부 실거래가 API 는 위경도를 주지 않는다. 대신 법정동과 지번이 100%
채워져 있으므로 '서울 강남구 대치동 316' 형태의 지번주소를 만들어 변환한다.

2단계로 시도한다.
  1) 주소 검색  /v2/local/search/address.json   — 지번이 정확하면 대부분 여기서 끝
  2) 키워드 검색 /v2/local/search/keyword.json  — 지번이 바뀌었거나 신축이라
                                                  주소로 안 잡히는 단지 폴백

결과는 complex 테이블에 캐시되므로 재실행해도 이미 채워진 단지는 건너뛴다.
"""
from __future__ import annotations

import os
import sys
import time
from dataclasses import dataclass

import requests

import config as C
from db import connect, init_schema
from fetch import utcnow

ADDRESS_URL = "https://dapi.kakao.com/v2/local/search/address.json"
KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"

# 서울 + 분당·수지·영통 위경도 대략 범위 — 엉뚱한 곳이 잡히면 버린다
SEOUL_BOUNDS = (126.73, 127.30, 37.20, 37.72)   # lng_min, lng_max, lat_min, lat_max

REQUEST_INTERVAL = 0.06     # 초당 ~16건. 카카오 권장 한도 내
MAX_RETRY = 3


@dataclass
class GeoResult:
    lat: float
    lng: float
    src: str


class Geocoder:
    def __init__(self, key: str | None = None):
        self.key = (key or os.getenv("KAKAO_REST_KEY", "")).strip()
        if not self.key:
            raise SystemExit(
                "KAKAO_REST_KEY 가 비어 있습니다. .env 에 카카오 REST 키를 넣어주세요.\n"
                "발급: https://developers.kakao.com > 내 애플리케이션 > 앱 키"
            )
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"KakaoAK {self.key}"
        self.calls = 0

    def _get(self, url: str, params: dict) -> dict | None:
        for attempt in range(MAX_RETRY):
            if attempt:
                time.sleep(1.5 * attempt)
            try:
                r = self.session.get(url, params=params, timeout=10)
                self.calls += 1
                time.sleep(REQUEST_INTERVAL)
                if r.status_code == 401:
                    raise SystemExit(
                        "카카오 인증 실패(401). .env 의 KAKAO_REST_KEY 가 "
                        "'REST API 키' 가 맞는지 확인해 주세요 (JavaScript 키 아님)."
                    )
                if r.status_code == 403:
                    # 키는 맞는데 앱에서 카카오맵 서비스가 꺼져 있는 경우가 대부분이다.
                    # 재시도해봐야 소용없으므로 안내하고 즉시 멈춘다.
                    raise SystemExit(
                        "카카오 권한 오류(403): " + r.text[:200] + "\n\n"
                        "developers.kakao.com > 내 애플리케이션 > 해당 앱 >\n"
                        "좌측 [카카오맵] 메뉴 > '활성화 설정' 을 ON 으로 바꿔주세요.\n"
                        "지도 표시와 주소→좌표 변환이 모두 이 설정에 묶여 있습니다."
                    )
                if r.status_code == 429:
                    print("  쿼터 초과(429) — 60초 대기")
                    time.sleep(60)
                    continue
                if r.status_code != 200:
                    continue
                return r.json()
            except SystemExit:
                raise
            except Exception:
                continue
        return None

    @staticmethod
    def _pick(docs: list[dict]) -> GeoResult | None:
        for d in docs:
            try:
                lng, lat = float(d["x"]), float(d["y"])
            except (KeyError, TypeError, ValueError):
                continue
            lo_lng, hi_lng, lo_lat, hi_lat = SEOUL_BOUNDS
            if lo_lng <= lng <= hi_lng and lo_lat <= lat <= hi_lat:
                return GeoResult(lat, lng, "")
        return None

    def by_address(self, addr: str) -> GeoResult | None:
        j = self._get(ADDRESS_URL, {"query": addr, "size": 5})
        if not j:
            return None
        g = self._pick(j.get("documents", []))
        if g:
            g.src = "address"
        return g

    def by_keyword(self, keyword: str, gu: str) -> GeoResult | None:
        j = self._get(KEYWORD_URL, {"query": keyword, "size": 10})
        if not j:
            return None
        # 같은 구 안에 있는 결과만 신뢰한다 (동명 단지가 전국에 널려 있다)
        docs = [
            d for d in j.get("documents", [])
            if gu in (d.get("address_name") or "") or gu in (d.get("road_address_name") or "")
        ]
        g = self._pick(docs)
        if g:
            g.src = "keyword"
        return g


def jibun_of(bonbun: str | None, bubun: str | None) -> str:
    """'0316','0000' -> '316' / '0316','0001' -> '316-1'"""
    try:
        b = int(bonbun or 0)
    except ValueError:
        b = 0
    try:
        s = int(bubun or 0)
    except ValueError:
        s = 0
    if b == 0:
        return ""
    return f"{b}-{s}" if s else str(b)


def main() -> int:
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 0

    conn = connect()
    init_schema(conn)

    rows = conn.execute(
        """
        SELECT canonical_id, sgg_cd, umd_nm, apt_nm, bonbun, bubun, n_trades
        FROM complex
        WHERE lat IS NULL
        ORDER BY n_trades DESC
        """
    ).fetchall()
    if limit:
        rows = rows[:limit]

    done = conn.execute(
        "SELECT COUNT(*) c FROM complex WHERE lat IS NOT NULL"
    ).fetchone()["c"]
    total = conn.execute("SELECT COUNT(*) c FROM complex").fetchone()["c"]

    if not rows:
        print(f"모든 단지에 좌표가 있습니다 ({done:,}/{total:,})")
        return 0

    print(f"좌표 없는 단지 {len(rows):,}곳 (이미 완료 {done:,}/{total:,})")

    geo = Geocoder()
    ok_addr = ok_kw = failed = 0

    try:
        for i, r in enumerate(rows, 1):
            gu = C.ALL_GU.get(r["sgg_cd"], "")
            sido = C.SIDO_OF.get(r["sgg_cd"], "")
            jibun = jibun_of(r["bonbun"], r["bubun"])

            g = None
            if jibun:
                g = geo.by_address(f"{sido} {gu} {r['umd_nm']} {jibun}")
            if g is None:
                g = geo.by_keyword(f"{sido} {gu} {r['umd_nm']} {r['apt_nm']}", gu)

            if g:
                conn.execute(
                    "UPDATE complex SET lat=?, lng=?, geo_src=?, geo_at=? "
                    "WHERE canonical_id=?",
                    (g.lat, g.lng, g.src, utcnow(), r["canonical_id"]),
                )
                if g.src == "address":
                    ok_addr += 1
                else:
                    ok_kw += 1
            else:
                failed += 1

            if i % 200 == 0:
                conn.commit()
                pct = i * 100 // len(rows)
                print(f"  [{pct:3d}%] {i:,}/{len(rows):,}  "
                      f"주소 {ok_addr:,} · 이름 {ok_kw:,} · 실패 {failed:,}", flush=True)

    except KeyboardInterrupt:
        print("\n중단 — 지금까지 결과를 저장합니다")
    finally:
        conn.commit()

    print(f"\n완료: 주소검색 {ok_addr:,} · 키워드검색 {ok_kw:,} · 실패 {failed:,}")
    print(f"API 호출 {geo.calls:,}회")

    now = conn.execute("SELECT COUNT(*) c FROM complex WHERE lat IS NOT NULL").fetchone()["c"]
    print(f"좌표 확보 {now:,}/{total:,} ({now * 100 // max(1, total)}%)")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
