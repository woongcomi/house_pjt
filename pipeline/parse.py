"""국토부 실거래가 XML 응답 파싱.

응답 item 필드(확인됨):
  aptDong aptNm aptSeq bonbun bubun buildYear buyerGbn cdealDay cdealType
  dealAmount dealDay dealMonth dealYear dealingGbn estateAgentSggNm
  excluUseAr floor jibun landCd landLeaseholdGbn rgstDate roadNm
  roadNmBonbun roadNmBubun roadNmCd roadNmSeq roadNmSggCd roadNmbCd
  sggCd slerGbn umdCd umdNm
"""
from __future__ import annotations

import hashlib
import xml.etree.ElementTree as ET
from typing import Any

# XML 태그 -> DB 컬럼
FIELD_MAP = {
    "aptSeq": "apt_seq",
    "sggCd": "sgg_cd",
    "umdCd": "umd_cd",
    "umdNm": "umd_nm",
    "bonbun": "bonbun",
    "bubun": "bubun",
    "jibun": "jibun",
    "aptNm": "apt_nm",
    "aptDong": "apt_dong",
    "buildYear": "build_year",
    "excluUseAr": "excl_ar",
    "floor": "floor",
    "dealAmount": "deal_amount",
    "dealingGbn": "dealing_gbn",
    "slerGbn": "sler_gbn",
    "buyerGbn": "buyer_gbn",
    "cdealType": "cdeal_type",
    "cdealDay": "cdeal_day",
    "rgstDate": "rgst_date",
    "landLeaseholdGbn": "land_leasehold_gbn",
    "estateAgentSggNm": "estate_agent_sgg_nm",
    "roadNm": "road_nm",
}


class ApiError(Exception):
    """resultCode 가 성공이 아닐 때."""

    def __init__(self, code: str, msg: str):
        super().__init__(f"[{code}] {msg}")
        self.code = code
        self.msg = msg


def _text(el, tag: str) -> str:
    node = el.find(tag)
    return (node.text or "").strip() if node is not None and node.text else ""


def _int(s: str) -> int | None:
    s = s.replace(",", "").strip()
    if not s:
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


def _float(s: str) -> float | None:
    s = s.replace(",", "").strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse_header(xml_text: str) -> tuple[str, str, int]:
    """(resultCode, resultMsg, totalCount) 반환. XML 파싱 실패 시 예외."""
    root = ET.fromstring(xml_text)
    code = _text(root, ".//resultCode") or _text(root, ".//returnReasonCode")
    msg = _text(root, ".//resultMsg") or _text(root, ".//returnAuthMsg")
    total = _int(_text(root, ".//totalCount")) or 0
    return code, msg, total


def parse_items(xml_text: str, src_lawd: str, src_ymd: str) -> list[dict[str, Any]]:
    root = ET.fromstring(xml_text)
    out: list[dict[str, Any]] = []

    for item in root.iterfind(".//item"):
        rec: dict[str, Any] = {col: _text(item, tag) for tag, col in FIELD_MAP.items()}

        rec["build_year"] = _int(rec["build_year"])
        rec["floor"] = _int(rec["floor"])
        rec["deal_amount"] = _int(rec["deal_amount"])
        rec["excl_ar"] = _float(rec["excl_ar"])

        y, m, d = _text(item, "dealYear"), _text(item, "dealMonth"), _text(item, "dealDay")
        if not (y and m):
            continue
        rec["deal_ym"] = f"{int(y):04d}-{int(m):02d}"
        rec["deal_date"] = f"{int(y):04d}-{int(m):02d}-{int(d):02d}" if d else None

        rec["src_lawd"] = src_lawd
        rec["src_ymd"] = src_ymd
        rec["dedup_key"] = make_dedup_key(rec)
        out.append(rec)

    # 같은 단지·같은 날·같은 면적·같은 층·같은 금액인 별개 거래가 실제로 존재한다
    # (동일 평면 두 세대 동시 거래). 서울 표본에서 약 0.45%.
    # 그대로 두면 한 건이 소실되므로 응답 내 순번을 접미사로 붙인다.
    # load_month() 가 (구,월) 단위로 전체 교체하므로 순번이 흔들려도 안전하다.
    seen: dict[str, int] = {}
    for rec in out:
        k = rec["dedup_key"]
        idx = seen.get(k, 0)
        seen[k] = idx + 1
        if idx:
            rec["dedup_key"] = f"{k}#{idx}"

    return out


def make_dedup_key(rec: dict[str, Any]) -> str:
    """같은 거래를 재수집해도 동일한 키가 나오도록."""
    parts = [
        rec.get("apt_seq") or "",
        rec.get("deal_date") or rec.get("deal_ym") or "",
        str(rec.get("deal_amount") or ""),
        f"{rec.get('excl_ar') or 0:.4f}",
        str(rec.get("floor") if rec.get("floor") is not None else ""),
        rec.get("apt_dong") or "",
    ]
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()
