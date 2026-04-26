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

/**
 * 사용자가 [+ 영역 추가] 누를 때 생성할 기본 사각형 폴리곤.
 *
 * 입력:
 *   center — 사각형 중심 좌표 (보통 부지 폴리곤 centroid 또는 지도 중심)
 *   sizeM  — 한 변의 길이 (m). 기본 15m → 약 225㎡ ≈ 68평
 *
 * 출력: closed ring 1개 (Position[][] = [[SW, SE, NE, NW, SW]])
 *
 * 위경도 환산:
 *   1° lat ≈ 111,000m (위도 무관 거의 일정)
 *   1° lng ≈ 111,000 × cos(lat) m  (위도 35° 기준 약 91km)
 */
export function createDefaultRect(
  center: { lat: number; lng: number },
  sizeM: number = 15,
): Position[][] {
  const halfM = sizeM / 2;
  const dLat = halfM / 111000;
  const dLng = halfM / (111000 * Math.cos((center.lat * Math.PI) / 180));
  const sw: Position = [center.lng - dLng, center.lat - dLat];
  const se: Position = [center.lng + dLng, center.lat - dLat];
  const ne: Position = [center.lng + dLng, center.lat + dLat];
  const nw: Position = [center.lng - dLng, center.lat + dLat];
  return [[sw, se, ne, nw, sw]]; // closed ring
}

// ───────────────────────────────────────────
// 점 추가 / 삭제
// ───────────────────────────────────────────

/**
 * 변(edge) 사이에 새 꼭지점 삽입.
 *
 * edgeIdx = ring 의 i 번째와 (i+1) 번째 좌표 사이의 변.
 * 결과: ring[edgeIdx+1] 위치에 newCoord 삽입 → 기존 ring[edgeIdx+1] 이후 한 칸씩 밀림.
 * closed ring 첫=마지막 관계는 그대로 유지 (변 사이 삽입이라 양 끝점 영향 X).
 */
export function addVertex(
  polygon: Position[][],
  ringIdx: number,
  edgeIdx: number,
  newCoord: Position,
): Position[][] {
  if (ringIdx < 0 || ringIdx >= polygon.length) return polygon;
  const ring = polygon[ringIdx];
  // edgeIdx 0 .. ring.length-2 — 마지막 변(closed) 까지 포함
  if (edgeIdx < 0 || edgeIdx >= ring.length - 1) return polygon;

  const newRing = ring.slice();
  newRing.splice(edgeIdx + 1, 0, newCoord);
  const newPolygon = polygon.slice();
  newPolygon[ringIdx] = newRing;
  return newPolygon;
}

/**
 * 꼭지점 삭제. 삭제 후 최소 3점(closed ring 기준 length>=4) 유지 — 그 미만이면 거부.
 *
 * 첫 점(vertexIdx=0) 삭제 시 closed ring 의 마지막 좌표도 새 첫 점에 맞춰 갱신.
 */
export function removeVertex(
  polygon: Position[][],
  ringIdx: number,
  vertexIdx: number,
): Position[][] {
  if (ringIdx < 0 || ringIdx >= polygon.length) return polygon;
  const ring = polygon[ringIdx];
  // closed ring: length 4(=3점+중복1) 가 최소. 그 이하로 삭제 X.
  if (ring.length <= 4) return polygon;
  const lastIdx = ring.length - 1;
  if (vertexIdx < 0 || vertexIdx > lastIdx) return polygon;

  const newRing = ring.slice();
  if (vertexIdx === 0) {
    // 첫 점 삭제 → 두 번째 점이 새 첫 점이 되고, 마지막도 그 좌표로 동기화
    newRing.splice(0, 1);
    newRing[newRing.length - 1] = newRing[0];
  } else if (vertexIdx === lastIdx) {
    // 마지막(=첫과 중복) 삭제는 의미 없음 — 무시
    return polygon;
  } else {
    newRing.splice(vertexIdx, 1);
  }
  const newPolygon = polygon.slice();
  newPolygon[ringIdx] = newRing;
  return newPolygon;
}

// ───────────────────────────────────────────
// 가장 가까운 변 + 수선의 발 (점 추가용)
// ───────────────────────────────────────────

// ───────────────────────────────────────────
// 각도가 가장 평평한 꼭지점 (자동 점 삭제용)
// ───────────────────────────────────────────

export interface FlattestVertexResult {
  ringIdx: number;
  vertexIdx: number;
  /** 인접 두 변 사이 코사인 — 1 에 가까울수록 직선 (= 평평, 제거해도 모양 영향 적음) */
  cosAngle: number;
}

/**
 * polygon 의 모든 꼭지점 중 인접 두 변 사이가 가장 직선에 가까운 점.
 *
 * 사용처: 우측 카드 [−] 버튼 → 모양 거의 안 바뀌게 점 1개 삭제.
 * 알고리즘: 각 꼭지점에서 (curr-prev) 와 (next-curr) 두 벡터의 cos 계산.
 * cos = 1 (방향 일치) → 거의 직선 → 그 점 제거해도 모양 보존.
 *
 * 최소 3점 유지 — closed ring length 4 (실제 점 3개) 이하면 null 반환.
 */
export function findFlattestVertex(
  polygon: Position[][],
): FlattestVertexResult | null {
  let best: FlattestVertexResult | null = null;
  for (let ri = 0; ri < polygon.length; ri += 1) {
    const ring = polygon[ri];
    const n = ring.length - 1; // closed 마지막 중복 제외 = 실제 점 갯수
    if (n < 4) continue; // 4점 이상이어야 1개 줄여서 3점 유지
    const cosLat = Math.cos((ring[0][1] * Math.PI) / 180);
    const lngScale = 111000 * cosLat;
    const latScale = 111000;
    for (let i = 0; i < n; i += 1) {
      const prev = ring[(i - 1 + n) % n];
      const curr = ring[i];
      const next = ring[(i + 1) % n];
      const v1x = (curr[0] - prev[0]) * lngScale;
      const v1y = (curr[1] - prev[1]) * latScale;
      const v2x = (next[0] - curr[0]) * lngScale;
      const v2y = (next[1] - curr[1]) * latScale;
      const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
      const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
      if (len1 === 0 || len2 === 0) continue;
      const cos = (v1x * v2x + v1y * v2y) / (len1 * len2);
      if (best === null || cos > best.cosAngle) {
        best = { ringIdx: ri, vertexIdx: i, cosAngle: cos };
      }
    }
  }
  return best;
}

// ───────────────────────────────────────────
// 가장 긴 변 + 중점 (자동 점 추가용)
// ───────────────────────────────────────────

export interface LongestEdgeResult {
  ringIdx: number;
  /** 변의 시작 꼭지점 인덱스. 새 꼭지점은 ring[edgeIdx+1] 자리에 삽입됨. */
  edgeIdx: number;
  /** 변의 중점 좌표 (lng, lat) */
  midpoint: Position;
  /** 변의 길이 (m) */
  lengthM: number;
}

/**
 * polygon 의 모든 변 중 가장 긴 변 + 그 변의 중점.
 *
 * 사용처: 우측 카드 [+ 점] 버튼 → 자동으로 가장 긴 변 가운데에 새 꼭지점 추가.
 * 변 길이가 큰 곳일수록 사용자가 점 추가하고 싶을 가능성 ↑.
 */
export function findLongestEdge(
  polygon: Position[][],
): LongestEdgeResult | null {
  let best: LongestEdgeResult | null = null;
  for (let ri = 0; ri < polygon.length; ri += 1) {
    const ring = polygon[ri];
    if (ring.length < 2) continue;
    // 평면 근사 — 첫 점의 위도 기준 lng 스케일
    const cosLat = Math.cos((ring[0][1] * Math.PI) / 180);
    const lngScale = 111000 * cosLat;
    const latScale = 111000;
    for (let ei = 0; ei < ring.length - 1; ei += 1) {
      const [aLng, aLat] = ring[ei];
      const [bLng, bLat] = ring[ei + 1];
      const dx = (bLng - aLng) * lngScale;
      const dy = (bLat - aLat) * latScale;
      const lengthM = Math.sqrt(dx * dx + dy * dy);
      if (best === null || lengthM > best.lengthM) {
        best = {
          ringIdx: ri,
          edgeIdx: ei,
          midpoint: [(aLng + bLng) / 2, (aLat + bLat) / 2],
          lengthM,
        };
      }
    }
  }
  return best;
}

export interface ClosestEdgeResult {
  ringIdx: number;
  /** 변의 시작 꼭지점 인덱스. 새 꼭지점은 ring[edgeIdx+1] 자리에 삽입됨. */
  edgeIdx: number;
  /** 마우스 점에서 변 위로의 수선의 발 (lng, lat) */
  projection: Position;
  /** 수선의 발 까지의 거리 (m) */
  distanceM: number;
}

/**
 * 마우스 좌표에서 polygon 의 모든 변 중 가장 가까운 변 + 수선의 발 좌표.
 *
 * 알고리즘: 평면 근사 — 위도 1° ≈ 111km, 경도 1° ≈ 111km × cos(lat).
 * 변 길이가 짧아 (<100m) 평면 근사 오차 1m 이내. 견적 영업 정밀도 충분.
 *
 * point-to-segment projection:
 *   t = clamp((p - a) · (b - a) / |b - a|², 0, 1)
 *   projection = a + t × (b - a)
 */
export function closestEdgePoint(
  polygon: Position[][],
  mouse: { lat: number; lng: number },
): ClosestEdgeResult | null {
  let best: ClosestEdgeResult | null = null;
  const cosLat = Math.cos((mouse.lat * Math.PI) / 180);
  const lngScale = 111000 * cosLat;
  const latScale = 111000;
  const px = mouse.lng * lngScale;
  const py = mouse.lat * latScale;

  for (let ri = 0; ri < polygon.length; ri += 1) {
    const ring = polygon[ri];
    for (let ei = 0; ei < ring.length - 1; ei += 1) {
      const [aLng, aLat] = ring[ei];
      const [bLng, bLat] = ring[ei + 1];
      const ax = aLng * lngScale;
      const ay = aLat * latScale;
      const bx = bLng * lngScale;
      const by = bLat * latScale;
      const dx = bx - ax;
      const dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      if (lenSq === 0) continue;
      let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const projX = ax + t * dx;
      const projY = ay + t * dy;
      const ddx = px - projX;
      const ddy = py - projY;
      const distM = Math.sqrt(ddx * ddx + ddy * ddy);
      if (best === null || distM < best.distanceM) {
        best = {
          ringIdx: ri,
          edgeIdx: ei,
          projection: [projX / lngScale, projY / latScale],
          distanceM: distM,
        };
      }
    }
  }
  return best;
}
