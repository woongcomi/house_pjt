"""신분당선 역세권 판정.

단지에 좌표가 있으면 역에서 반경 STATION_RADIUS_M 안인지로, 없으면(지오코딩 전)
역이 걸치는 법정동으로 판정한다. 결과는 역 이름 목록 (없으면 빈 리스트).
"""
from __future__ import annotations

import math
from dataclasses import dataclass

STATION_RADIUS_M = 700


@dataclass(frozen=True)
class Station:
    name: str
    sgg_cd: str
    umd: tuple[str, ...]   # 역이 걸치는 법정동 (좌표 없을 때 폴백)
    lat: float
    lng: float


# 북→남 순서. 좌표는 역사 출입구 기준 대략값.
SINBUNDANG: list[Station] = [
    Station("신사", "11680", ("신사동",), 37.5164, 127.0203),
    Station("논현", "11680", ("논현동",), 37.5111, 127.0215),
    Station("신논현", "11680", ("논현동", "역삼동"), 37.5045, 127.0250),
    Station("강남", "11680", ("역삼동",), 37.4979, 127.0276),
    Station("양재", "11650", ("양재동",), 37.4841, 127.0343),
    Station("양재시민의숲", "11650", ("양재동",), 37.4702, 127.0383),
    Station("청계산입구", "11650", ("원지동", "신원동"), 37.4476, 127.0556),
    Station("판교", "41135", ("백현동", "삼평동", "판교동"), 37.3948, 127.1112),
    Station("정자", "41135", ("정자동",), 37.3670, 127.1081),
    Station("미금", "41135", ("금곡동", "구미동"), 37.3500, 127.1086),
    Station("동천", "41465", ("동천동",), 37.3376, 127.1050),
    Station("수지구청", "41465", ("풍덕천동",), 37.3228, 127.0954),
    Station("성복", "41465", ("성복동",), 37.3133, 127.0804),
    Station("상현", "41465", ("상현동",), 37.2983, 127.0696),
    Station("광교중앙", "41117", ("이의동",), 37.2890, 127.0514),
    Station("광교", "41117", ("이의동", "하동"), 37.3023, 127.0453),
]


def distance_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """하버사인 거리 (m)."""
    r = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def stations_of(sgg_cd: str, umd_nm: str, lat: float | None, lng: float | None) -> list[str]:
    if lat and lng:
        return [
            s.name for s in SINBUNDANG
            if distance_m(lat, lng, s.lat, s.lng) <= STATION_RADIUS_M
        ]
    return [s.name for s in SINBUNDANG if s.sgg_cd == sgg_cd and umd_nm in s.umd]
