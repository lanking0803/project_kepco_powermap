/**
 * MapSummaryRow 위도순 정렬 인덱스 — 모듈 scope 캐시.
 *
 * 목적:
 *   취락지구 ↔ 가장 가까운 마을 매칭 시 130만 행 전부 거리 계산하지 않도록
 *   "위도 BBox 안 행" 만 binary search 로 빠르게 추출.
 *
 * 핵심 원리:
 *   1. totalRows 를 위도 오름차순으로 1회 정렬 (앱 라이프타임 1회, ~1.6초)
 *   2. 검색 시 lower/upperBound 이진 탐색으로 위도 범위 슬라이스 (~0.001ms)
 *   3. 그 슬라이스만 경도/거리 검사 (~5,000건 → 1ms)
 *
 * 거리 계산 로직 자체는 변하지 않음. **계산 횟수**만 줄임 (130만 → ~5,000).
 *
 * 캐시 무효화:
 *   totalRows 가 바뀌면 (refresh) 인덱스 재구축 필요.
 *   buildLatIndex(rows) 가 매번 새 객체 반환 — 호출 측이 useMemo(rows) 로 관리.
 */
import type { MapSummaryRow } from "@/lib/types";

export interface LatIndex {
  /** 위도 오름차순 정렬된 행 (참조 보유) */
  rows: MapSummaryRow[];
  /** rows 와 같은 길이의 위도 배열 (binary search 가속) */
  lats: number[];
}

/**
 * 위도순 정렬 인덱스 생성. 1.6초 정도 (130만 행 기준).
 * 앱 마운트 직후 1회만 호출.
 */
export function buildLatIndex(rows: MapSummaryRow[]): LatIndex {
  const sorted = [...rows].sort((a, b) => a.lat - b.lat);
  return {
    rows: sorted,
    lats: sorted.map((r) => r.lat),
  };
}

/** 정렬된 위도 배열에서 target 이상 첫 인덱스 반환 (lower bound). */
function lowerBound(arr: number[], target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * 중심점 ± radius (m) BBox 안 마을만 거리 계산해서 가까운 Top N 반환.
 * 추가로 maxDistanceM 절대 상한.
 *
 * @param index 위도순 정렬 인덱스
 * @param center 취락지구 중심점
 * @param radiusM BBox 반경 (m). 보통 maxDistanceM 와 동일.
 * @param maxDistanceM 결과 거리 절대 상한
 * @param topN 최대 결과 수
 */
export function findNearestRowsByLatIndex(
  index: LatIndex,
  center: { lat: number; lng: number },
  radiusM: number,
  maxDistanceM: number,
  topN: number,
): Array<{ row: MapSummaryRow; distanceM: number }> {
  // 한국 위도 ~37도: 위도 1도 ≈ 111km, 경도 1도 ≈ 88km
  const dLat = radiusM / 111_000;
  const dLng = radiusM / 88_000;
  const minLat = center.lat - dLat;
  const maxLat = center.lat + dLat;
  const minLng = center.lng - dLng;
  const maxLng = center.lng + dLng;

  const startIdx = lowerBound(index.lats, minLat);
  const endIdx = lowerBound(index.lats, maxLat);

  const inRange: Array<{ row: MapSummaryRow; distanceM: number }> = [];
  for (let i = startIdx; i < endIdx; i++) {
    const row = index.rows[i];
    if (row.lng < minLng || row.lng > maxLng) continue;
    const dy = (row.lat - center.lat) * 111_000;
    const dx = (row.lng - center.lng) * 88_000;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > maxDistanceM) continue;
    inRange.push({ row, distanceM: d });
  }

  inRange.sort((a, b) => a.distanceM - b.distanceM);
  return inRange.slice(0, topN);
}
