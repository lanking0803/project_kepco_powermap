/**
 * 폴리곤 편집 헬퍼 — 견적 모드 영역 수정에 사용.
 *
 * 데이터 모델:
 *   - polygon: Position[][] = ring 배열. 첫 ring = 외곽선, 나머지는 hole (현재는 외곽만).
 *   - 각 ring 의 첫 좌표 = 마지막 좌표 (closed). 마커는 N-1 개만 표시 + 마지막 좌표 동기화.
 *
 * 편집 식별자:
 *   - (buildingIdx, ringIdx, vertexIdx) 3차원 좌표
 *   - vertexIdx 는 0..(ring.length-2). 마지막 좌표는 자동으로 첫 좌표와 동일하게 유지
 */

import area from "@turf/area";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";

/** Polygon 의 한 ring 의 한 꼭지점 좌표를 새 좌표로 교체. closed ring 자동 유지. */
export function updateVertex(
  polygon: Position[][],
  ringIdx: number,
  vertexIdx: number,
  newCoord: Position,
): Position[][] {
  if (ringIdx < 0 || ringIdx >= polygon.length) return polygon;
  const ring = polygon[ringIdx];
  if (vertexIdx < 0 || vertexIdx >= ring.length) return polygon;

  const newRing = ring.slice();
  newRing[vertexIdx] = newCoord;

  // closed ring: 첫 좌표 변경 시 마지막 좌표도 함께 갱신 (역도 마찬가지)
  const lastIdx = newRing.length - 1;
  if (vertexIdx === 0) {
    newRing[lastIdx] = newCoord;
  } else if (vertexIdx === lastIdx) {
    newRing[0] = newCoord;
  }

  const newPolygon = polygon.slice();
  newPolygon[ringIdx] = newRing;
  return newPolygon;
}

/**
 * Polygon 좌표 → 면적 (㎡, 정수).
 *
 * Turf.js 는 GeoJSON Feature<Polygon|MultiPolygon> 입력. 우리는 Position[][] 만 보유 →
 * 단일 Polygon (ring 1개 또는 ring 1개+holes) 으로 wrap.
 *
 * 주의: ring 이 여러 개면 hole 로 해석. 현재 견적 모드는 외곽 1개만 사용 → ring[0] 만.
 */
export function calcAreaM2(polygon: Position[][]): number {
  if (polygon.length === 0 || polygon[0].length < 4) return 0;
  const feature: Feature<Polygon | MultiPolygon> = {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: polygon,
    },
  };
  return Math.round(area(feature));
}

/**
 * Polygon centroid 좌표 (라벨 위치용).
 *
 * 단순 산술 평균 — Turf.js centroid 는 GeoJSON 입력 필요해서 의존성 가벼움 우선.
 * 큰 폴리곤도 시각적 중심 근처라 라벨 위치로 충분.
 */
export function polygonCenter(polygon: Position[][]): { lat: number; lng: number } | null {
  if (polygon.length === 0 || polygon[0].length === 0) return null;
  const ring = polygon[0];
  let sumLat = 0;
  let sumLng = 0;
  // closed ring 의 마지막 좌표는 중복 → 제외
  const n = ring.length - 1;
  for (let i = 0; i < n; i += 1) {
    sumLng += ring[i][0];
    sumLat += ring[i][1];
  }
  return { lat: sumLat / n, lng: sumLng / n };
}

/** ㎡ → 평 (1평 = 3.305785㎡) */
export function toPyeong(m2: number): number {
  return Math.round(m2 * 0.3025);
}
