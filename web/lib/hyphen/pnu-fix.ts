/**
 * Hyphen 매물 한글주소 → 행안부 표준 PNU 19자리 변환.
 *
 * Hyphen 응답에는 PNU 직접 필드가 없으므로, 응답의 `리스트지번주소` 또는 `대표소재지`
 * 텍스트를 파싱해서 우리 PNU 를 조립한다 (캠코의 pnuFromOnbidItem 미러).
 *
 * 입력 예시 (실호출 검증):
 *   - "경기도 김포시 대곶면 율생리 197-1"                                         (정상)
 *   - "경기도 김포시 대곶면 대명리 산53-8"                                          (산필지)
 *   - "경기도 김포시 대곶면 대명리 375-12 1동호 \t\r\n[도로명주소] 대명항로 588-5"   (호수+도로명)
 *   - "경기도 김포시 구래동 6871-12 디원시티 시그니처 지식산업센터 8층 805호"         (건물명+층호수)
 *
 * 알고리즘:
 *   1. `[도로명주소]` 이후 부분 절단 (도로명 토큰이 지번 파싱 방해)
 *   2. 첫 번째 "지번 패턴" (산X-Y / X-Y / X) 만 추출 — 뒤의 동/호 토큰 무시
 *   3. parseKoreanAddress 로 sep_1~5 + jibun 분리 (KEPCO 모듈 재활용)
 *   4. bjd_master 캐시 (외부에서 주입) 에서 sep_1~5 → bjd_code 매칭
 *   5. buildPnuFromBjdAndJibun 으로 PNU 조립
 */

import { buildPnuFromBjdAndJibun } from "@/lib/geo/pnu";
import { parseKoreanAddress } from "@/lib/kepco-live/parse-address";

import type { AuctionRawListItem } from "./types";

/** 응답 텍스트의 첫 번째 지번 패턴 추출 (산X-Y / X-Y / X). */
const JIBUN_RE = /(산\s*)?(\d+)(?:-(\d+))?/;

/**
 * Hyphen 응답 텍스트에서 "행정주소 + 지번 한 개" 만 추출.
 * 도로명/건물명/호수 등은 절단.
 *
 * 예: "경기도 김포시 대곶면 대명리 375-12 1동호 [도로명주소] 대명항로 588-5"
 *  → "경기도 김포시 대곶면 대명리 375-12"
 */
export function cleanAuctionAddress(raw: string | null | undefined): string {
  if (!raw) return "";
  // 1) 도로명주소 부분 절단
  let s = raw.split("[도로명주소]")[0];
  // 2) 줄바꿈/탭 정리
  s = s.replace(/[\r\n\t]+/g, " ").trim();
  return s;
}

/**
 * 한글주소 텍스트 → 첫 번째 지번 토큰 ("347", "산53-8" 등).
 * 못 찾으면 null.
 */
export function extractFirstJibun(addr: string): string | null {
  const cleaned = cleanAuctionAddress(addr);
  // KEPCO parser 가 뒤에서부터 지번을 잡지만, Hyphen 은 지번 뒤에 호수/번지명이 붙을 수 있음.
  // 정규식으로 첫 지번 패턴만 직접 추출.
  const m = cleaned.match(JIBUN_RE);
  if (!m) return null;
  const isSan = !!m[1];
  const bon = m[2];
  const bu = m[3];
  if (!bon) return null;
  const text = bu ? `${bon}-${bu}` : bon;
  return isSan ? `산${text}` : text;
}

/**
 * Hyphen 매물 1건 → 행안부 표준 PNU 19자리.
 * bjd_code 가 외부에서 주입돼야 함 (route.ts 가 입력 PNU 의 bjd_code 를 알고 있음).
 *
 * ⚠️ 주의: dong 필터가 면 단위라 응답에 입력 PNU 와 다른 리(里)도 섞일 수 있음.
 *   → 각 매물의 한글주소에서 sep_5(리) 를 추출해서 bjd_master 역조회로 진짜 bjd_code 알아내야 함.
 *   → bjd_master 역조회는 enrich 단계에서 일괄 수행 (createAdminClient).
 *   → 여기서는 (bjd_code, jibun) 를 받아 단순 조립만.
 */
export function pnuFromAuctionItem(
  item: Pick<AuctionRawListItem, "리스트지번주소" | "대표소재지">,
  bjdCode: string,
): string | null {
  const addr = item.리스트지번주소 || item.대표소재지 || "";
  const jibun = extractFirstJibun(addr);
  if (!jibun) return null;
  return buildPnuFromBjdAndJibun(bjdCode, jibun);
}

/**
 * 매물 응답에서 (sep_4, sep_5) = (면/동, 리) 추출.
 * bjd_master 역조회 키로 사용.
 *
 * 캠코식 정확 파서 활용: parseKoreanAddress.
 */
export function extractSep45(addr: string | null | undefined): {
  sep_4: string | null;
  sep_5: string | null;
} {
  const cleaned = cleanAuctionAddress(addr);
  if (!cleaned) return { sep_4: null, sep_5: null };
  const parsed = parseKoreanAddress(cleaned);
  return { sep_4: parsed.sep_4, sep_5: parsed.sep_5 };
}
