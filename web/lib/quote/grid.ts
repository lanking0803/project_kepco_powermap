/**
 * 견적 모드 — 패널 격자 자동 배치 알고리즘.
 *
 * 입력: 영역 폴리곤 + 모듈 사양 + 시설별 배치 spec + 회전각
 * 출력: 영역 안에 들어가는 패널 N개의 4꼭지점 폴리곤 배열
 *
 * 알고리즘 (Turf.js 표준 기법):
 *   1. 영역 폴리곤을 -회전각 만큼 역회전 (축정렬 처리)
 *   2. 가장자리 inset 적용 (bbox 수축으로 단순화)
 *   3. 역회전된 폴리곤의 bbox 안에 격자점 생성
 *      (가로 = 모듈너비 + 열간, 세로 = 모듈높이 + 행간)
 *   4. 각 격자점에서 패널 직사각형 4꼭지점 생성
 *   5. 4꼭지점 모두 폴리곤 안인지 검사
 *   6. 통과 패널을 +회전각 재회전 → 원 좌표계
 *
 * Step 3-1 단순화: rotation = 0 고정 (Step 3-2 에서 시설별 자동 계산으로 대체)
 */

import { transformRotate } from "@turf/transform-rotate";
import { bbox } from "@turf/bbox";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { polygon as turfPolygon, point as turfPoint } from "@turf/helpers";
import type { Position } from "geojson";
import {
  calcPanelCellSize,
  type PanelModule,
  type PlacementSpec,
  type RotationRule,
} from "./panel";

export interface PanelLayout {
  /** 각 패널의 4꼭지점 폴리곤 (closed ring, [lng, lat] 순) */
  panels: Position[][];
  /** 패널 개수 */
  count: number;
  /** 적용된 회전각 (degrees, 시계 방향) */
  rotation: number;
}

/**
 * 폴리곤 안에 패널을 격자로 자동 배치.
 *
 * @param areaPolygon  영역 외곽 ring (Position[][] = ring 배열, 0번이 외곽)
 * @param module       패널 모듈 사양
 * @param spec         시설별 배치 spec (이격/inset/회전 규칙)
 * @param rotation     회전각 (degrees) — Step 3-1 = 0 고정
 */
export function fillPanelGrid(
  areaPolygon: Position[][],
  module: PanelModule,
  spec: PlacementSpec,
  rotation: number,
): PanelLayout {
  const outerRing = areaPolygon[0];
  if (!outerRing || outerRing.length < 4) {
    return { panels: [], count: 0, rotation };
  }

  const ring = ensureClosedRing(outerRing);
  const areaFeat = turfPolygon([ring]);

  // ── 1. 영역 폴리곤 -rotation 역회전
  const pivot = ringCentroid(ring);
  const rotatedFeat =
    rotation === 0
      ? areaFeat
      : transformRotate(areaFeat, -rotation, { pivot });

  const rotatedRing = (rotatedFeat.geometry.coordinates as Position[][])[0];
  if (!rotatedRing || rotatedRing.length < 4) {
    return { panels: [], count: 0, rotation };
  }

  // ── 2. bbox 계산
  const [minLng, minLat, maxLng, maxLat] = bbox(rotatedFeat);
  const refLat = (minLat + maxLat) / 2;

  // 위경도 ↔ m 변환 (평면 근사, 한국 위도 36° 기준 오차 무시 수준)
  const degPerMLat = mToDegLat(1);
  const degPerMLng = mToDegLng(1, refLat);

  // ── 3. 가장자리 inset 적용 (bbox 수축)
  const insetLat = spec.edgeInsetM * degPerMLat;
  const insetLng = spec.edgeInsetM * degPerMLng;
  const ix0 = minLng + insetLng;
  const iy0 = minLat + insetLat;
  const ix1 = maxLng - insetLng;
  const iy1 = maxLat - insetLat;

  if (ix1 <= ix0 || iy1 <= iy0) {
    return { panels: [], count: 0, rotation };
  }

  // ── 4. 격자 셀 크기 (m → 도)
  const moduleWdeg = (module.widthMm / 1000) * degPerMLng;
  const moduleHdeg = (module.heightMm / 1000) * degPerMLat;
  const cell = calcPanelCellSize(module, spec);
  const cellWdeg = cell.widthM * degPerMLng;
  const cellHdeg = cell.heightM * degPerMLat;

  if (moduleWdeg <= 0 || moduleHdeg <= 0 || cellWdeg <= 0 || cellHdeg <= 0) {
    return { panels: [], count: 0, rotation };
  }

  // ── 5. 격자 점 + 패널 4꼭지점 → 폴리곤 안 검사
  const panelsRotated: Position[][] = [];

  let cy = iy0;
  while (cy + moduleHdeg <= iy1 + 1e-9) {
    let cx = ix0;
    while (cx + moduleWdeg <= ix1 + 1e-9) {
      // 패널 4꼭지점 (좌하 / 우하 / 우상 / 좌상) + closed
      const panel: Position[] = [
        [cx, cy],
        [cx + moduleWdeg, cy],
        [cx + moduleWdeg, cy + moduleHdeg],
        [cx, cy + moduleHdeg],
        [cx, cy],
      ];
      const allInside = panel
        .slice(0, 4)
        .every((p) => booleanPointInPolygon(turfPoint(p), rotatedFeat));
      if (allInside) panelsRotated.push(panel);
      cx += cellWdeg;
    }
    cy += cellHdeg;
  }

  // ── 6. 통과 패널 +rotation 재회전 (원 좌표계로)
  if (rotation === 0) {
    return {
      panels: panelsRotated,
      count: panelsRotated.length,
      rotation,
    };
  }

  const panelsOriginal = panelsRotated.map((p) => {
    const f = transformRotate(turfPolygon([p]), rotation, { pivot });
    return (f.geometry.coordinates as Position[][])[0];
  });
  return {
    panels: panelsOriginal,
    count: panelsOriginal.length,
    rotation,
  };
}

// ── 헬퍼 ──────────────────────────────────────────

function ensureClosedRing(ring: Position[]): Position[] {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

/** 단순 산술평균 중심 — 회전 pivot 용 (정확한 centroid 불필요) */
function ringCentroid(ring: Position[]): Position {
  let sx = 0;
  let sy = 0;
  let n = 0;
  // closed ring 의 마지막 중복은 제외
  const last = ring.length - 1;
  const isClosed =
    ring[0] && ring[last] && ring[0][0] === ring[last][0] && ring[0][1] === ring[last][1];
  const upper = isClosed ? last : ring.length;
  for (let i = 0; i < upper; i++) {
    sx += ring[i][0];
    sy += ring[i][1];
    n++;
  }
  return n > 0 ? [sx / n, sy / n] : [0, 0];
}

/** 1m 가 위도로 몇 도인지 (위도 무관 상수) */
const EARTH_RADIUS_M = 6_378_137;
function mToDegLat(m: number): number {
  return (m / EARTH_RADIUS_M) * (180 / Math.PI);
}

/** 1m 가 경도로 몇 도인지 (위도에 따라 cos 보정) */
function mToDegLng(m: number, lat: number): number {
  const rad = (lat * Math.PI) / 180;
  return (m / (EARTH_RADIUS_M * Math.cos(rad))) * (180 / Math.PI);
}

// ── Step 3-2: 시설별 자동 회전 ──────────────────────

/**
 * 폴리곤 외곽 ring 에서 가장 긴 변의 각도 (degrees).
 *
 * 위경도 좌표 → 위도 보정 cos 으로 미터 단위 비교 → atan2.
 * 결과는 0~180 으로 정규화 (직사각형 방향이라 +180 시 동일).
 *
 * 폴리곤이 비어있거나 변이 없으면 0 반환.
 */
export function calcLongestEdgeAngle(areaPolygon: Position[][]): number {
  const ring = areaPolygon[0];
  if (!ring || ring.length < 2) return 0;

  // closed ring 마지막 중복 제외
  const last = ring.length - 1;
  const isClosed =
    ring[0] && ring[last] && ring[0][0] === ring[last][0] && ring[0][1] === ring[last][1];
  const upper = isClosed ? last : ring.length;
  if (upper < 2) return 0;

  // 위도 평균 (위도 보정용)
  let latSum = 0;
  for (let i = 0; i < upper; i++) latSum += ring[i][1];
  const refLat = latSum / upper;
  const cos = Math.cos((refLat * Math.PI) / 180);

  let maxLenSq = -1;
  let bestAngleDeg = 0;
  for (let i = 0; i < upper; i++) {
    const j = (i + 1) % upper;
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[j];
    const dx = (lng2 - lng1) * cos; // 위도 보정
    const dy = lat2 - lat1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq > maxLenSq) {
      maxLenSq = lenSq;
      bestAngleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    }
  }

  // 0~180 정규화
  let normalized = bestAngleDeg % 180;
  if (normalized < 0) normalized += 180;
  return normalized;
}

/**
 * 시설 회전 규칙에 따라 자동 회전각 산출.
 *   "정남"     → 0 (북쪽 위 / 패널이 정남향)
 *   "건물긴변" → 폴리곤 가장 긴 변 각도
 */
export function calcAutoRotation(
  areaPolygon: Position[][],
  rotation: RotationRule,
): number {
  if (rotation === "정남") return 0;
  return calcLongestEdgeAngle(areaPolygon);
}

/**
 * 영역의 회전된 bbox 가로/세로 (m 단위).
 *
 * 회전 0 일 때는 axis-aligned bbox.
 * 회전 적용 시 폴리곤을 -회전 역회전 후의 bbox 폭/높이.
 * 즉 "건물 긴 변 평행" 회전을 거치면 자연스러운 직사각형 가로/세로.
 */
export function calcAreaDimensions(
  areaPolygon: Position[][],
  rotation: number,
): { widthM: number; heightM: number } {
  const ring = areaPolygon[0];
  if (!ring || ring.length < 3) return { widthM: 0, heightM: 0 };

  const closed = ensureClosedRing(ring);
  const feat = turfPolygon([closed]);
  const pivot = ringCentroid(closed);

  const target = rotation === 0 ? feat : transformRotate(feat, -rotation, { pivot });
  const [minLng, minLat, maxLng, maxLat] = bbox(target);
  const refLat = (minLat + maxLat) / 2;

  // 도 → m 변환
  const mPerDegLat = 1 / mToDegLat(1);
  const mPerDegLng = 1 / mToDegLng(1, refLat);
  const widthM = (maxLng - minLng) * mPerDegLng;
  const heightM = (maxLat - minLat) * mPerDegLat;

  return { widthM, heightM };
}
