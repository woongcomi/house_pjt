/** 서울 25개 자치구 (법정동 시군구코드) — pipeline/config.py 와 동일 */
export const SEOUL_GU: Record<string, string> = {
  "11110": "종로구", "11140": "중구", "11170": "용산구",
  "11200": "성동구", "11215": "광진구", "11230": "동대문구",
  "11260": "중랑구", "11290": "성북구", "11305": "강북구",
  "11320": "도봉구", "11350": "노원구", "11380": "은평구",
  "11410": "서대문구", "11440": "마포구", "11470": "양천구",
  "11500": "강서구", "11530": "구로구", "11545": "금천구",
  "11560": "영등포구", "11590": "동작구", "11620": "관악구",
  "11650": "서초구", "11680": "강남구", "11710": "송파구",
  "11740": "강동구",
};

/** 경기 — 신분당선 역세권 (pipeline/config.py GYEONGGI_GU 와 동일) */
export const GYEONGGI_GU: Record<string, string> = {
  "41135": "분당구", "41465": "수지구", "41117": "영통구",
};

export const ALL_GU: Record<string, string> = { ...SEOUL_GU, ...GYEONGGI_GU };

/** 시군구코드 → 시도·시 이름 (경기 구는 시 이름을 붙여야 어디인지 읽힌다) */
export const SIDO_OF: Record<string, string> = {
  ...Object.fromEntries(Object.keys(SEOUL_GU).map((c) => [c, "서울"])),
  "41135": "성남", "41465": "용인", "41117": "수원",
};

/** '강남구' / '성남 분당구' — 서울은 시도 생략 */
export function guName(code: string): string {
  const name = ALL_GU[code];
  if (!name) return code;
  return code.startsWith("11") ? name : `${SIDO_OF[code]} ${name}`;
}

/** 서울 전체 순위·대시보드용 — 서울 25개 구만 */
export const GU_CODES = Object.keys(SEOUL_GU);
