/**
 * 견적 모드 — 패널 모듈 사양 + 시설별 자동 배치 디폴트.
 *
 * 의뢰자 컨펌 2026-04-27 (카톡 양식 4문항):
 *   · 모듈 = AIKO 670W (2,465 × 1,134 × 33mm)
 *   · 노지 = 행간 2.0m / 가장자리 1.0m / 정남 고정
 *   · 옥상 = 행간 1.5m / 가장자리 1.0m / 가장 긴 변 평행
 *   · 공장슬레이트·지붕일체형 = 행간 0m / 가장자리 0.5m / 가장 긴 변 평행
 *   · 열간(모듈 사이) = 0.05m 공통
 *
 * 단가/시설 추천 = ./facility.ts. 패널/배치 = 이 파일.
 */

import type { FacilityKind } from "./facility";

/** 태양광 패널 모듈 사양 */
export interface PanelModule {
  /** 영업 표시명 (예: "AIKO 670W") */
  name: string;
  /** 모듈 너비 mm (긴 변) */
  widthMm: number;
  /** 모듈 높이 mm (짧은 변) */
  heightMm: number;
  /** 모듈 두께 mm */
  thicknessMm: number;
  /** 정격출력 W */
  watt: number;
}

/** 의뢰자 영업 기본 모델 (2026-04-27 컨펌) */
export const DEFAULT_MODULE: PanelModule = {
  name: "AIKO 670W",
  widthMm: 2_465,
  heightMm: 1_134,
  thicknessMm: 33,
  watt: 670,
};

/** 자동 배치 회전 규칙 */
export type RotationRule = "정남" | "건물긴변";

/** 시설별 자동 배치 디폴트 */
export interface PlacementSpec {
  /** 행간 이격 (그림자 회피) m */
  rowGapM: number;
  /** 열간 이격 (모듈 사이) m — 공통 0.05 */
  colGapM: number;
  /** 영역 가장자리 안쪽 이격 m */
  edgeInsetM: number;
  /** 회전 규칙 */
  rotation: RotationRule;
}

export const FACILITY_PLACEMENT: Record<FacilityKind, PlacementSpec> = {
  노지:        { rowGapM: 2.0, colGapM: 0.05, edgeInsetM: 1.0, rotation: "정남" },
  옥상:        { rowGapM: 1.5, colGapM: 0.05, edgeInsetM: 1.0, rotation: "건물긴변" },
  공장슬레이트: { rowGapM: 0,   colGapM: 0.05, edgeInsetM: 0.5, rotation: "건물긴변" },
  지붕일체형:  { rowGapM: 0,   colGapM: 0.05, edgeInsetM: 0.5, rotation: "건물긴변" },
};

/**
 * 패널 1장이 차지하는 격자 셀 크기 (이격 포함, m).
 *   가로(긴 변 평행 방향) = widthM + colGap
 *   세로(긴 변 수직 방향) = heightM + rowGap
 */
export function calcPanelCellSize(
  module: PanelModule,
  spec: PlacementSpec,
): { widthM: number; heightM: number } {
  return {
    widthM: module.widthMm / 1000 + spec.colGapM,
    heightM: module.heightMm / 1000 + spec.rowGapM,
  };
}

/**
 * 정격 kW 산출 — 실측 (패널 N장 기반).
 *   88장 × 670W = 58.96 kW
 *
 * 2단계 추정 kW (평수 / 평수당kW) 와 다를 수 있음.
 * 2단계 = 빠른 견적, 3단계 = 패널 격자 후 실측.
 */
export function calcInstalledKw(
  panelCount: number,
  module: PanelModule,
): number {
  return (panelCount * module.watt) / 1000;
}
