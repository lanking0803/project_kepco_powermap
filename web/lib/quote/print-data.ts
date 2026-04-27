/**
 * 견적 모드 ↔ 인쇄 페이지 데이터 전달.
 *
 * 폴리곤 좌표가 큼 → URL 쿼리 X. sessionStorage 직렬화로 전달.
 * 키 = `quote-print-blueprint:{pnu}` (도면) / `quote-print-finance:{pnu}` (수익 분석).
 */

import type { Position } from "geojson";
import type { PanelModule } from "./panel";

/** 인쇄 페이지에 그릴 한 동의 데이터 — 영역 폴리곤 + 패널 격자 */
export interface PrintBuilding {
  id: string;
  name: string;          // "1동" / "사용자추가1" 등
  polygon: Position[][]; // 외곽 ring 0번
  panels: Position[][];  // 격자 알고리즘 결과 패널 N개
  panelCount: number;
  kwActual: number;
  /** 영역 회전 각도 (degrees) — 라벨 위치 계산용 */
  rotation: number;
  widthM: number;
  heightM: number;
  area_m2: number;
}

/** 변전소 여유선로 — 봉남리 양식의 우하단 박스 */
export interface PrintKepcoCapa {
  substationName: string;   // "구례 변전소"
  substationFreeMW: number; // 47.8
  mtrFreeMW: number;        // 14.1 (주변압기)
  dlName: string;           // "냉천 DL"
  dlFreeMW: number;         // 12.1
  checkedAt: string;        // "4월 16일 인터넷 조회기준"
}

/** 도면 출력 (3단계) 인쇄 데이터 */
export interface BlueprintPrintData {
  pnu: string;
  address: string;       // "전라남도 구례군 구례읍 봉남리 6-2"
  jimok: string;         // "공장용지" 등
  parcelM2: number;
  module: PanelModule;
  buildings: PrintBuilding[];
  kepco: PrintKepcoCapa | null;
  /** 태양 고도각 (봉남리 = 23도 고정) */
  solarAltitudeDeg: number;
  /** 인쇄 생성 시각 */
  generatedAt: string;
}

const BLUEPRINT_KEY = (pnu: string) => `quote-print-blueprint:${pnu}`;

export function saveBlueprintData(data: BlueprintPrintData): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(BLUEPRINT_KEY(data.pnu), JSON.stringify(data));
}

export function loadBlueprintData(pnu: string): BlueprintPrintData | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(BLUEPRINT_KEY(pnu));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BlueprintPrintData;
  } catch {
    return null;
  }
}
