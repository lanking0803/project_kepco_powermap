/**
 * 경매(Hyphen) 매물 리스트 → 마을(BJD 10자리) 단위 그룹화.
 *
 * 사용:
 *   - 경매 모드 지도 마커는 매물 단위가 아니라 마을 단위로 표시.
 *   - 마커 클릭 시 AuctionVillageCard 에 group.items 직접 전달.
 *
 * 키 정책 (공매와 다른 점):
 *   - 공매: lctnSdnm + lctnSggnm + lctnEmdNm (캠코 응답 한글 직접)
 *   - 경매: pnuStandard.slice(0,10) (행안부 BJD 10자리 — enrich 단계에서 박힘)
 *           Hyphen 응답엔 한글 시도/시군구/동 분리 필드가 없어서 PNU 슬라이스 사용.
 *           동 이름은 `대표소재지` 에서 정규식 추출.
 *
 * 좌표: 그룹 내 첫 매물의 lat/lng (bjd_master 결과는 동/리 단위라 모두 동일).
 */

import type { AuctionListItem } from "./types";

export interface AuctionVillageGroup {
  /** 그룹 키 — bjd_code 10자리 (행안부 표준) */
  key: string;
  /** 동/리 한글명 — 마커 라벨/카드 표시용. 추출 실패 시 빈 문자열 */
  emdName: string;
  /** 마커 좌표 (그룹 내 첫 매물) */
  lat: number;
  lng: number;
  /** 그룹 내 매물 (정렬 X — 카드/모달이 정렬 담당) */
  items: AuctionListItem[];
  /** 임박(D-3 이내) 매물이 1건이라도 있으면 true — 마커 펄스 강조용 */
  hasUrgent: boolean;
  /** 신건 매물 수 (영업 매력도 보조 지표) */
  newCount: number;
  /** 평균 할인율 (0~1) — 마을 영업 가치 핵심 지표. 의뢰자 의도 = "저가 매입 발굴" */
  avgDiscountRatio: number;
  /** 가장 임박한 D-day (마감 제외, 그룹 내 최소). 모두 마감이면 null */
  minDaysLeft: number | null;
}

/**
 * `대표소재지` 텍스트에서 동/리 이름 추출.
 *
 * 예시:
 *   "경기도 고양시 일산서구 주엽로 80, ..." (도로명) → 괄호 안 동 명
 *     "경기도 고양시 일산서구 주엽로 80, 1층비146호 (대화동, ...)" → "대화동"
 *   "경기도 김포시 월곶면 고막리 144-11" (지번주소) → 마지막 단어 앞 = "고막리"
 *
 * 규칙: 괄호 안의 동/면/읍/리 우선, 없으면 지번 앞 단어 (면/읍/리/동 키워드 검색).
 */
function extractEmdName(addr: string | null | undefined): string {
  if (!addr) return "";
  // 1) 괄호 안 동 추출 (도로명주소 케이스)
  const parenMatch = addr.match(/\(([^,)]+)/);
  if (parenMatch) {
    const inside = parenMatch[1].trim();
    if (/[동면읍리]$/.test(inside)) return inside;
  }
  // 2) 텍스트 토큰 중 동/면/읍/리 끝나는 단어 검색
  const tokens = addr.split(/\s+/);
  for (const t of tokens) {
    if (/^[가-힣]+[동면읍리]$/.test(t)) return t;
  }
  return "";
}

/** 매물 리스트 → 마을 그룹 리스트. lat/lng 또는 pnuStandard 누락 매물은 제외. */
export function groupAuctionItemsByVillage(
  items: AuctionListItem[],
): AuctionVillageGroup[] {
  const map = new Map<string, AuctionVillageGroup>();
  for (const it of items) {
    if (it.lat == null || it.lng == null) continue;
    // 키 우선순위: PNU 10자리 → bjdCode (지번추출 실패) → 좌표 fallback (모두 실패).
    // 같은 동의 PNU 성공/실패 매물이 같은 그룹에 묶이도록 BJD 10자리 우선.
    const key =
      it.pnuStandard && it.pnuStandard.length >= 10
        ? it.pnuStandard.slice(0, 10)
        : it.bjdCode && it.bjdCode.length >= 10
          ? it.bjdCode
          : `coord:${it.lat.toFixed(5)},${it.lng.toFixed(5)}`;
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        emdName: extractEmdName(it.대표소재지) || extractEmdName(it.리스트지번주소),
        lat: it.lat,
        lng: it.lng,
        items: [],
        hasUrgent: false,
        newCount: 0,
        avgDiscountRatio: 0,
        minDaysLeft: null,
      };
      map.set(key, g);
    }
    g.items.push(it);
    if (it.isUrgent && it.daysLeft >= 0) g.hasUrgent = true;
    if (it.진행상태 === "신건") g.newCount += 1;
    if (it.daysLeft >= 0) {
      g.minDaysLeft =
        g.minDaysLeft == null ? it.daysLeft : Math.min(g.minDaysLeft, it.daysLeft);
    }
  }
  // 통계 마무리 — 평균 할인율
  for (const g of map.values()) {
    const sum = g.items.reduce((s, i) => s + i.discountRatio, 0);
    g.avgDiscountRatio = g.items.length > 0 ? sum / g.items.length : 0;
  }
  return [...map.values()];
}
