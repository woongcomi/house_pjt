"""단지 마스터 구축 + 별칭 후보 탐지.

aptSeq('11680-1234' 형태)를 canonical_id 로 쓴다. 국토부 내부 단지 마스터에서
내려오는 값이라 LAWD_CD 접두어 덕에 전역 유일하다.

재건축이면 aptSeq 가 갈리는 게 정상이지만(물리적으로 다른 건물),
단순 명칭 변경으로 갈리면 시계열이 끊긴다. 후자를 자동 병합하지 않고
후보만 리포트한다 — 둘을 자동으로 구분할 방법이 없기 때문이다.
"""
from __future__ import annotations

import re
import sqlite3
import unicodedata

_SUFFIX = re.compile(r"(아파트|APT)$", re.IGNORECASE)
_PAREN = re.compile(r"[()（）\[\]]")
_SPACE = re.compile(r"\s+")


def normalize_name(name: str | None) -> str:
    if not name:
        return ""
    s = unicodedata.normalize("NFKC", name).strip()
    s = _PAREN.sub("", s)
    s = _SPACE.sub("", s)
    s = s.replace("제1차", "1차").replace("제2차", "2차").replace("제3차", "3차")
    s = _SUFFIX.sub("", s)
    return s


def build(conn: sqlite3.Connection) -> dict:
    conn.execute("DELETE FROM complex")
    conn.execute(
        """
        INSERT INTO complex
          (canonical_id, sgg_cd, umd_cd, umd_nm, apt_nm, apt_nm_norm,
           build_year, bonbun, bubun, first_ym, last_ym, n_trades, n_months)
        SELECT
          apt_seq,
          MAX(sgg_cd), MAX(umd_cd), MAX(umd_nm),
          -- 표기가 흔들리는 경우 가장 많이 쓰인 이름을 대표로
          (SELECT t2.apt_nm FROM trade_raw t2
            WHERE t2.apt_seq = t1.apt_seq AND t2.apt_nm IS NOT NULL AND t2.apt_nm <> ''
            GROUP BY t2.apt_nm ORDER BY COUNT(*) DESC, t2.apt_nm LIMIT 1),
          '',
          -- 건축년도도 신고마다 다를 수 있어 최빈값 사용
          (SELECT t3.build_year FROM trade_raw t3
            WHERE t3.apt_seq = t1.apt_seq AND t3.build_year IS NOT NULL
            GROUP BY t3.build_year ORDER BY COUNT(*) DESC LIMIT 1),
          MAX(bonbun), MAX(bubun),
          MIN(deal_ym), MAX(deal_ym),
          COUNT(*), COUNT(DISTINCT deal_ym)
        FROM trade_raw t1
        WHERE apt_seq IS NOT NULL AND apt_seq <> ''
        GROUP BY apt_seq
        """
    )

    for row in conn.execute("SELECT canonical_id, apt_nm FROM complex").fetchall():
        conn.execute(
            "UPDATE complex SET apt_nm_norm=? WHERE canonical_id=?",
            (normalize_name(row["apt_nm"]), row["canonical_id"]),
        )

    # aptSeq 가 없는 거래가 있으면 별도 처리가 필요하므로 규모를 보고
    orphan = conn.execute(
        "SELECT COUNT(*) c FROM trade_raw WHERE apt_seq IS NULL OR apt_seq=''"
    ).fetchone()["c"]

    conn.commit()

    n = conn.execute("SELECT COUNT(*) c FROM complex").fetchone()["c"]
    return {"complexes": n, "orphan_trades": orphan}


def find_alias_candidates(conn: sqlite3.Connection) -> list[dict]:
    """같은 지번·비슷한 건축년도인데 aptSeq 가 다르고 기간이 겹치지 않는 쌍.

    기간이 겹치지 않는다는 건 '하나가 끝나고 다른 하나가 시작'이라는 뜻이라
    명칭 변경일 가능성이 있다. 겹치면 별개 단지다.
    """
    rows = conn.execute(
        """
        SELECT a.canonical_id AS id_a, b.canonical_id AS id_b,
               a.apt_nm AS nm_a, b.apt_nm AS nm_b,
               a.umd_nm, a.bonbun, a.bubun,
               a.build_year AS by_a, b.build_year AS by_b,
               a.first_ym AS fa, a.last_ym AS la,
               b.first_ym AS fb, b.last_ym AS lb,
               a.n_trades AS na, b.n_trades AS nb
        FROM complex a
        JOIN complex b
          ON a.umd_cd = b.umd_cd
         AND a.bonbun = b.bonbun AND a.bubun = b.bubun
         AND a.canonical_id < b.canonical_id
        WHERE a.bonbun <> '' AND a.bonbun IS NOT NULL
          AND ABS(COALESCE(a.build_year,0) - COALESCE(b.build_year,0)) <= 1
          AND (a.last_ym < b.first_ym OR b.last_ym < a.first_ym)
        ORDER BY (a.n_trades + b.n_trades) DESC
        """
    ).fetchall()
    return [dict(r) for r in rows]
