"""국토교통부 아파트 매매 실거래가 상세 자료 API 클라이언트."""

import hashlib
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass

import httpx

APT_TRADE_URL = (
    "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev"
)
ROWS_PER_PAGE = 1000


class MolitError(Exception):
    def __init__(self, code: str, msg: str):
        super().__init__(f"[{code}] {msg}")
        self.code = code


class QuotaExceeded(MolitError):
    """일일 호출 한도 초과 (resultCode 22)."""


@dataclass
class Deal:
    id: str
    sgg_cd: str
    umd_cd: str
    umd_nm: str
    apt_seq: str
    apt_nm: str
    apt_dong: str
    jibun: str
    road_nm: str
    build_year: int | None
    area: float
    floor: int | None
    deal_date: str  # YYYY-MM-DD
    amount: int  # 만원
    dealing_gbn: str
    canceled: int
    cdeal_day: str
    rgst_date: str


def _text(item: ET.Element, tag: str) -> str:
    return (item.findtext(tag) or "").strip()


def _to_int(s: str) -> int | None:
    s = s.replace(",", "").strip()
    return int(s) if s.lstrip("-").isdigit() else None


def parse_item(item: ET.Element) -> Deal:
    year, month, day = (_to_int(_text(item, t)) or 0 for t in ("dealYear", "dealMonth", "dealDay"))
    fields = {
        "sgg_cd": _text(item, "sggCd"),
        "umd_cd": _text(item, "umdCd"),
        "umd_nm": _text(item, "umdNm"),
        "apt_seq": _text(item, "aptSeq"),
        "apt_nm": _text(item, "aptNm"),
        "apt_dong": _text(item, "aptDong"),
        "jibun": _text(item, "jibun"),
        "road_nm": _text(item, "roadNm"),
        "build_year": _to_int(_text(item, "buildYear")),
        "area": float(_text(item, "excluUseAr") or 0),
        "floor": _to_int(_text(item, "floor")),
        "deal_date": f"{year:04d}-{month:02d}-{day:02d}",
        "amount": _to_int(_text(item, "dealAmount")) or 0,
        "dealing_gbn": _text(item, "dealingGbn"),
        "canceled": 1 if _text(item, "cdealType") == "O" else 0,
        "cdeal_day": _text(item, "cdealDay"),
        "rgst_date": _text(item, "rgstDate"),
    }
    # API 에 거래 고유번호가 없어서 식별 필드 조합으로 ID 를 만든다.
    key = "|".join(
        str(fields[k])
        for k in ("sgg_cd", "apt_seq", "apt_dong", "area", "floor", "deal_date", "amount")
    )
    return Deal(id=hashlib.sha1(key.encode()).hexdigest()[:16], **fields)


def _raise_for_error(root: ET.Element) -> None:
    # 정상 응답: <response><header><resultCode>000 ... 오류 응답: <OpenAPI_ServiceResponse><cmmMsgHeader>
    code = root.findtext(".//resultCode") or root.findtext(".//returnReasonCode") or ""
    msg = root.findtext(".//resultMsg") or root.findtext(".//returnAuthMsg") or ""
    if code in ("000", "00", ""):
        return
    if code == "22":
        raise QuotaExceeded(code, msg)
    raise MolitError(code, msg)


def fetch_month(client: httpx.Client, key: str, sgg_cd: str, ym: str) -> list[Deal]:
    """한 시군구의 한 달(YYYYMM) 거래를 전부 가져온다 (페이지 자동 순회)."""
    deals: list[Deal] = []
    page = 1
    while True:
        params = {
            "serviceKey": key,
            "LAWD_CD": sgg_cd,
            "DEAL_YMD": ym,
            "pageNo": page,
            "numOfRows": ROWS_PER_PAGE,
        }
        for attempt in range(3):
            try:
                res = client.get(APT_TRADE_URL, params=params, timeout=60)
                res.raise_for_status()
                break
            except (httpx.TransportError, httpx.HTTPStatusError):
                if attempt == 2:
                    raise
                time.sleep(2 * (attempt + 1))
        root = ET.fromstring(res.text)
        _raise_for_error(root)
        items = root.findall(".//item")
        deals.extend(parse_item(i) for i in items)
        total = int(root.findtext(".//totalCount") or 0)
        if page * ROWS_PER_PAGE >= total or not items:
            return deals
        page += 1
