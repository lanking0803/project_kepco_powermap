/**
 * 자치법규(조례) 검색용 행정구역 분류.
 *
 * 입력 = JibunInfo (`ctp_nm`, `sig_nm`).
 * 시·군·구 명칭 끝 한 글자로 분기 ('군' / '구' / '시'), 단층 광역(세종/제주) 별도.
 *
 * 분기 결과:
 *   - widePart: 광역 검색 키워드 ("충청남도 도시계획")
 *   - localPart: 기초 검색 키워드 ("부여군 군계획" / "강남구 도시계획" / "수원시 도시계획")
 *   - 기초 없음(단층) = localPart null
 *
 * 자치권 없는 일반구(수원 영통구 / 성남 분당구) 는 sig_nm 자체에 안 옴 — JibunInfo 가
 * VWorld LX 응답이라 sig_nm 이 시 단위 ("수원시") 로 옴. 일반구 분기 불필요.
 */

/** 광역만 단독으로 끝나는 자치단체 — 자치구/시/군 X */
const SINGLE_TIER_WIDES = new Set([
  "세종특별자치시",
  "제주특별자치도",
]);

export type SigKind = "군" | "구" | "시" | "단층광역";

export interface RegionForRegulation {
  /** 광역명 — 예: "충청남도", "서울특별시" */
  ctp_nm: string;
  /** 기초명 — 예: "부여군", "강남구". 단층 광역은 빈 문자열 */
  sig_nm: string;
  /** 기초 분류 */
  sig_kind: SigKind;
  /** 광역 검색 query — "{ctp_nm} 도시계획" */
  wideQuery: string;
  /** 기초 검색 query — "{sig_nm} 도시계획" 또는 "{sig_nm} 군계획". 단층 광역은 null */
  localQuery: string | null;
  /** 응답 필터용 광역 지자체기관명 prefix — 예: "충청남도" */
  wideOrganMatch: string;
  /** 응답 필터용 기초 지자체기관명 — 예: "충청남도 부여군". 단층 광역은 null */
  localOrganMatch: string | null;
}

export function classifyRegionForRegulation(
  ctp_nm: string,
  sig_nm: string,
): RegionForRegulation {
  const ctp = (ctp_nm || "").trim();
  const sig = (sig_nm || "").trim();

  // 단층 광역 (세종/제주): 기초 자치단체 없음
  if (SINGLE_TIER_WIDES.has(ctp)) {
    return {
      ctp_nm: ctp,
      sig_nm: "",
      sig_kind: "단층광역",
      wideQuery: `${ctp} 도시계획`,
      localQuery: null,
      wideOrganMatch: ctp,
      localOrganMatch: null,
    };
  }

  // 기초 끝 한 글자로 분류
  const lastChar = sig.slice(-1);
  let kind: SigKind;
  let localKeyword: string;
  if (lastChar === "군") {
    kind = "군";
    localKeyword = "군계획";
  } else if (lastChar === "구") {
    kind = "구";
    localKeyword = "도시계획";
  } else {
    // "시" 또는 그 외 (일반시 default)
    kind = "시";
    localKeyword = "도시계획";
  }

  return {
    ctp_nm: ctp,
    sig_nm: sig,
    sig_kind: kind,
    wideQuery: `${ctp} 도시계획`,
    localQuery: sig ? `${sig} ${localKeyword}` : null,
    wideOrganMatch: ctp,
    localOrganMatch: sig ? `${ctp} ${sig}` : null,
  };
}
