/**
 * PNU 단위 공매 매물 조회 — ParcelInfoPanel [공매] 탭 lazy fetch 출처.
 *
 * 호출 시점: 사용자가 공매 탭을 클릭할 때 (모드 무관).
 * 캐시: PNU 단위 모듈 scope — 같은 패널에서 탭 재방문 시 재호출 X.
 *
 * 현재(Phase 1 이전): mock 데이터에서 PNU 직접 매칭.
 * Phase 1 백엔드 완료 시: /api/onbid/by-pnu 호출로 교체 + 모듈 캐시는 그대로.
 */

import type { OnbidListItem } from "./types";
import { MOCK_ITEMS } from "./mock";

const cache = new Map<string, OnbidListItem[]>();

/** 같은 PNU 의 매물 조회. 매물이 없으면 빈 배열. */
export async function fetchOnbidByPnu(pnu: string): Promise<OnbidListItem[]> {
  if (!/^\d{19}$/.test(pnu)) return [];

  const cached = cache.get(pnu);
  if (cached) return cached;

  // mock 검색 — 실제 환경은 캠코 API 호출로 교체.
  const items = MOCK_ITEMS.filter((m) => m.ltnoPnu === pnu);
  cache.set(pnu, items);
  return items;
}

/** 모든 캐시 비우기 (테스트/refresh 용). */
export function clearOnbidByPnuCache(): void {
  cache.clear();
}
