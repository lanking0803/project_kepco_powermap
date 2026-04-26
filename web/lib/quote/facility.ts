/**
 * 견적 모드 — 시설 4종 단가표 + 자동 추천 로직.
 *
 * 의뢰자 명시 디폴트 (docs/견적_1차2차.md §"시설 유형 4종 단가"):
 *   노지/평지     4.0 평/kW · 130만/kW
 *   건물 옥상     2.5 평/kW · 130만/kW
 *   공장 슬레이트  1.8 평/kW · 140만/kW
 *   지붕 일체형   1.8 평/kW · 150만/kW
 *
 * 영업이 견적 모드 안에서 동별로 일시 변경 가능. 1차에선 DB 저장 X
 * (URL 공유로만 재방문 — 변경값은 휘발). 견적서 관리 = 3차로 미룸.
 */

import type { BuildingTitleInfo } from "@/lib/api/buildings";

export type FacilityKind = "노지" | "옥상" | "공장슬레이트" | "지붕일체형";

export interface FacilitySpec {
  /** 1kW 설치에 필요한 평수 */
  pyeongPerKw: number;
  /** kW당 시공비 (원) */
  costPerKw: number;
}

export const FACILITY_KINDS: FacilityKind[] = [
  "노지",
  "옥상",
  "공장슬레이트",
  "지붕일체형",
];

export const FACILITY_LABEL: Record<FacilityKind, string> = {
  노지: "🌾 노지/평지",
  옥상: "🏢 건물 옥상",
  공장슬레이트: "🏭 공장 슬레이트",
  지붕일체형: "🍄 지붕 일체형",
};

export const FACILITY_SPEC: Record<FacilityKind, FacilitySpec> = {
  노지: { pyeongPerKw: 4.0, costPerKw: 1_300_000 },
  옥상: { pyeongPerKw: 2.5, costPerKw: 1_300_000 },
  공장슬레이트: { pyeongPerKw: 1.8, costPerKw: 1_400_000 },
  지붕일체형: { pyeongPerKw: 1.8, costPerKw: 1_500_000 },
};

/**
 * 시설 종류 자동 추천.
 * 우선순위 (의뢰자 명시):
 *   1. 사용자 추가 영역 + 노지 계열 지목(전/답/임야/잡종지) → 노지
 *   2. VWorld 자동 폴리곤 + 건축물대장에 "공장"           → 공장슬레이트
 *   3. 건축물대장에 "버섯"/"온실"/"축사"                   → 지붕일체형
 *   default → 옥상
 */
export function recommendFacility(
  source: "vworld" | "user_added",
  jimok: string,
  bldgRegister: BuildingTitleInfo[],
): FacilityKind {
  // 1순위: 빈 땅에 직접 그린 영역
  if (source === "user_added") {
    if (
      jimok.startsWith("전") ||
      jimok.startsWith("답") ||
      jimok.startsWith("임") || // 임야
      jimok.startsWith("잡")     // 잡종지
    ) {
      return "노지";
    }
  }

  const purposes = bldgRegister.map((r) => r.mainPurpsCdNm).join("|");

  // 2순위: 공장
  if (source === "vworld" && purposes.includes("공장")) {
    return "공장슬레이트";
  }

  // 3순위: 동·식물관련시설 (버섯재배사 / 온실 / 축사)
  if (
    purposes.includes("버섯") ||
    purposes.includes("온실") ||
    purposes.includes("축사")
  ) {
    return "지붕일체형";
  }

  return "옥상";
}

/**
 * kW 산출 (1kW 미만은 첫째자리까지).
 *   필요한 kW = 평수 ÷ (1kW당 평수)
 */
export function calcKw(pyeong: number, spec: FacilitySpec): number {
  if (spec.pyeongPerKw <= 0) return 0;
  return pyeong / spec.pyeongPerKw;
}

/**
 * 시공비(원) 산출.
 *   시공비 = kW × kW당 시공비
 */
export function calcCost(kw: number, spec: FacilitySpec): number {
  return kw * spec.costPerKw;
}

/**
 * 화면 표시용 — kW 한 자리 소수 + "kW".
 *   12.34 → "12.3 kW"
 */
export function formatKw(kw: number): string {
  return `${kw.toFixed(1)} kW`;
}

/**
 * 화면 표시용 — 시공비 만원 단위 한국 표기.
 *   523_456_789 → "5억 2,345만"
 *   78_900_000  → "7,890만"
 *   500_000     → "50만"
 */
export function formatCost(won: number): string {
  const man = Math.round(won / 10_000); // 만원 단위 반올림
  if (man >= 10_000) {
    const eok = Math.floor(man / 10_000);
    const rest = man % 10_000;
    return rest > 0
      ? `${eok}억 ${rest.toLocaleString()}만`
      : `${eok}억`;
  }
  return `${man.toLocaleString()}만`;
}
