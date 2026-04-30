/**
 * 검색 입력 파싱 — 한글 정규화 + 지번 분리 (042 재설계 기준).
 *
 * 사용자 UI 가 "한글칸" 과 "지번칸" 을 따로 받아 호출한다.
 *   addr  : 자유 텍스트 행정구역 — 시/도 ~ 리까지
 *   jibun : "29", "29-4" 같은 본번-부번 패턴
 *
 * 한글 처리:
 *   1) 공백 단위 토큰화
 *   2) 시/도 약어를 정식명으로 치환 ("충남" → "충청남도" 등)
 *   3) 토큰 합쳐서 공백/특수문자 제거 → 단일 정규화 문자열
 *   4) DB 쪽도 sep 합본+공백제거에 이 문자열을 LIKE 매칭
 *
 * 예:
 *   parseSearchInput("충남 부여군 장암면 지토리", "29-4")
 *     → { addrNormalized: "충청남도부여군장암면지토리", lotMain: 29, lotSub: 4 }
 *
 *   parseSearchInput("지토리", "")
 *     → { addrNormalized: "지토리", lotMain: null, lotSub: null }
 *
 *   parseSearchInput("", "29")
 *     → { addrNormalized: "", lotMain: 29, lotSub: null }
 *       (호출 측에서 "주소도 입력" 안내)
 */

export interface ParsedSearchInput {
  /** 정규화된 한글 — sep 합본+공백제거에 LIKE 매칭할 문자열. 빈 문자열 가능 */
  addrNormalized: string;
  /** 본번. "29-4" → 29, "29" → 29. 없으면 null */
  lotMain: number | null;
  /** 부번. "29-4" → 4. 없으면 null */
  lotSub: number | null;
  /** 지번칸이 비어있지 않은데 정규식 매칭 실패 → 사용자 안내용 */
  jibunInvalid: boolean;
}

// 시/도 약어 → 정식명 매핑 (bjd_master 의 sep_1 distinct 값 17개 기준).
// 사용자 약어 입력은 정규화 단계에서 정식명으로 치환되어
// DB 의 sep_1 (예: "충청남도") 과 LIKE 매칭 가능하게 됨.
const SIDO_ALIAS: Record<string, string> = {
  서울: "서울특별시",
  부산: "부산광역시",
  대구: "대구광역시",
  인천: "인천광역시",
  광주: "광주광역시",
  대전: "대전광역시",
  울산: "울산광역시",
  세종: "세종특별자치시",
  경기: "경기도",
  강원: "강원특별자치도",
  충북: "충청북도",
  충남: "충청남도",
  전북: "전북특별자치도",
  전남: "전라남도",
  경북: "경상북도",
  경남: "경상남도",
  제주: "제주특별자치도",
};

// 지번칸 정규식: "29" 또는 "29-4" 만 허용. 부번은 선택.
const JIBUN_RE = /^(\d+)(?:-(\d+))?$/;

/**
 * 한글 입력을 정규화 단일 문자열로 변환.
 *   "충남 부여군 장암면 지토리" → "충청남도부여군장암면지토리"
 *   "지토리"                    → "지토리"
 *   ""                          → ""
 */
export function normalizeAddr(input: string): string {
  const tokens = (input ?? "").trim().split(/[\s,.\-]+/);
  const expanded: string[] = [];
  for (const raw of tokens) {
    const t = raw.trim();
    if (!t) continue;
    expanded.push(SIDO_ALIAS[t] ?? t);
  }
  // 합치고 모든 공백/특수문자 제거 (남아있을 가능성 있는 것 마저 청소)
  return expanded.join("").replace(/[\s,.\-]/g, "");
}

export function parseSearchInput(
  addr: string,
  jibun: string
): ParsedSearchInput {
  const addrNormalized = normalizeAddr(addr);

  const jibunStr = (jibun ?? "").trim();
  let lotMain: number | null = null;
  let lotSub: number | null = null;
  let jibunInvalid = false;

  if (jibunStr) {
    const m = jibunStr.match(JIBUN_RE);
    if (m) {
      lotMain = parseInt(m[1], 10);
      lotSub = m[2] != null ? parseInt(m[2], 10) : null;
    } else {
      jibunInvalid = true;
    }
  }

  return { addrNormalized, lotMain, lotSub, jibunInvalid };
}
