/**
 * polygon-edit 단위 테스트.
 */

import { describe, it, expect } from "vitest";
import { updateVertex, calcAreaM2, polygonCenter, toPyeong } from "./polygon-edit";
import type { Position } from "geojson";

// 약 100m × 100m 사각형 (위도 35° 기준)
const SQUARE: Position[][] = [
  [
    [128.325, 35.7163],
    [128.3261, 35.7163],
    [128.3261, 35.7172],
    [128.325, 35.7172],
    [128.325, 35.7163], // closed: 첫 좌표 = 마지막 좌표
  ],
];

describe("updateVertex", () => {
  it("일반 꼭지점 (vertexIdx=1) 변경 — 마지막 좌표는 영향 없음", () => {
    const r = updateVertex(SQUARE, 0, 1, [128.327, 35.7163]);
    expect(r[0][1]).toEqual([128.327, 35.7163]);
    expect(r[0][4]).toEqual(SQUARE[0][4]); // closed 마지막 그대로
  });

  it("첫 꼭지점(vertexIdx=0) 변경 → closed ring 의 마지막도 같이 갱신", () => {
    const r = updateVertex(SQUARE, 0, 0, [128.324, 35.716]);
    expect(r[0][0]).toEqual([128.324, 35.716]);
    expect(r[0][4]).toEqual([128.324, 35.716]); // 마지막도 동기화
  });

  it("마지막 꼭지점 변경 → 첫 좌표도 같이 갱신", () => {
    const r = updateVertex(SQUARE, 0, 4, [128.328, 35.7165]);
    expect(r[0][0]).toEqual([128.328, 35.7165]);
    expect(r[0][4]).toEqual([128.328, 35.7165]);
  });

  it("범위 밖 인덱스 → 원본 반환", () => {
    expect(updateVertex(SQUARE, 1, 0, [0, 0])).toBe(SQUARE);
    expect(updateVertex(SQUARE, 0, 99, [0, 0])).toBe(SQUARE);
  });

  it("immutable — 원본 polygon 변경 X", () => {
    updateVertex(SQUARE, 0, 1, [129, 36]);
    expect(SQUARE[0][1]).toEqual([128.3261, 35.7163]);
  });
});

describe("calcAreaM2", () => {
  it("100m × 100m 사각형 ≈ 10,000㎡ (±20%)", () => {
    const a = calcAreaM2(SQUARE);
    expect(a).toBeGreaterThan(8000);
    expect(a).toBeLessThan(12000);
  });

  it("빈 polygon → 0", () => {
    expect(calcAreaM2([])).toBe(0);
    expect(calcAreaM2([[]])).toBe(0);
    expect(calcAreaM2([[[1, 2]]])).toBe(0); // 4점 미만
  });

  it("꼭지점 변경 후 면적 갱신", () => {
    const original = calcAreaM2(SQUARE);
    // 한 꼭지점을 동쪽으로 100m 더 밀면 면적 약 2배
    const stretched = updateVertex(SQUARE, 0, 1, [128.3272, 35.7163]);
    const stretched2 = updateVertex(stretched, 0, 2, [128.3272, 35.7172]);
    const newArea = calcAreaM2(stretched2);
    expect(newArea).toBeGreaterThan(original * 1.5);
  });
});

describe("polygonCenter", () => {
  it("정사각형 중심 = 대각선 교점", () => {
    const c = polygonCenter(SQUARE);
    expect(c).not.toBeNull();
    expect(c!.lng).toBeCloseTo(128.32555, 4);
    expect(c!.lat).toBeCloseTo(35.71675, 4);
  });

  it("빈 polygon → null", () => {
    expect(polygonCenter([])).toBeNull();
    expect(polygonCenter([[]])).toBeNull();
  });
});

describe("toPyeong", () => {
  it("기본 변환", () => {
    expect(toPyeong(0)).toBe(0);
    expect(toPyeong(3.3058)).toBe(1); // 1평
    expect(toPyeong(330.58)).toBe(100); // 100평
  });
});
