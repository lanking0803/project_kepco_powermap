/**
 * polygon-edit 단위 테스트.
 */

import { describe, it, expect } from "vitest";
import {
  updateVertex,
  calcAreaM2,
  polygonCenter,
  toPyeong,
  createDefaultRect,
  addVertex,
  removeVertex,
  closestEdgePoint,
  findLongestEdge,
  findFlattestVertex,
} from "./polygon-edit";
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

describe("addVertex", () => {
  it("변(edge=0) 사이에 새 점 삽입 → ring.length 5→6, closed 유지", () => {
    const r = addVertex(SQUARE, 0, 0, [128.3255, 35.7163]);
    expect(r[0]).toHaveLength(6);
    expect(r[0][1]).toEqual([128.3255, 35.7163]);
    expect(r[0][0]).toEqual(r[0][5]); // closed
  });

  it("마지막 변(edge=3, closing edge) 사이에 삽입", () => {
    const r = addVertex(SQUARE, 0, 3, [128.325, 35.7167]);
    expect(r[0]).toHaveLength(6);
    expect(r[0][4]).toEqual([128.325, 35.7167]);
  });

  it("범위 밖 edgeIdx → 원본 반환", () => {
    expect(addVertex(SQUARE, 0, 99, [0, 0])).toBe(SQUARE);
    expect(addVertex(SQUARE, 0, -1, [0, 0])).toBe(SQUARE);
  });

  it("immutable", () => {
    addVertex(SQUARE, 0, 0, [129, 36]);
    expect(SQUARE[0]).toHaveLength(5);
  });
});

describe("removeVertex", () => {
  // 5점 polygon (closed ring length 6)
  const PENTAGON: Position[][] = [
    [
      [128.325, 35.7163],
      [128.3261, 35.7163],
      [128.3265, 35.7167],
      [128.3261, 35.7172],
      [128.325, 35.7172],
      [128.325, 35.7163],
    ],
  ];

  it("중간 꼭지점 삭제 → ring.length 6→5", () => {
    const r = removeVertex(PENTAGON, 0, 2);
    expect(r[0]).toHaveLength(5);
    expect(r[0][2]).toEqual([128.3261, 35.7172]); // 다음 점이 당겨짐
  });

  it("첫 점 삭제 → 두 번째 점이 새 첫점 + 마지막도 동기화", () => {
    const r = removeVertex(PENTAGON, 0, 0);
    expect(r[0]).toHaveLength(5);
    expect(r[0][0]).toEqual([128.3261, 35.7163]);
    expect(r[0][4]).toEqual([128.3261, 35.7163]);
  });

  it("최소 3점(closed length 4) 미만으로 줄이려 하면 거부", () => {
    // 삼각형 (3점 + closed = length 4)
    const TRIANGLE: Position[][] = [
      [
        [128.325, 35.7163],
        [128.3261, 35.7163],
        [128.3256, 35.7172],
        [128.325, 35.7163],
      ],
    ];
    expect(removeVertex(TRIANGLE, 0, 1)).toBe(TRIANGLE);
  });

  it("마지막(중복) 점 삭제 시도는 무시", () => {
    expect(removeVertex(PENTAGON, 0, 5)).toBe(PENTAGON);
  });

  it("immutable", () => {
    removeVertex(PENTAGON, 0, 2);
    expect(PENTAGON[0]).toHaveLength(6);
  });
});

describe("closestEdgePoint", () => {
  // 변 위에 가까운 마우스 → 그 변 + 수선의 발 + 거리
  it("사각형 남쪽 변 가까이 → edgeIdx=0 + 거리 작음", () => {
    const r = closestEdgePoint(SQUARE, { lat: 35.7162, lng: 128.3256 });
    expect(r).not.toBeNull();
    expect(r!.edgeIdx).toBe(0);
    expect(r!.distanceM).toBeLessThan(15); // ~10m 차이 정도
  });

  it("동쪽 변 가까이 → edgeIdx=1", () => {
    const r = closestEdgePoint(SQUARE, { lat: 35.7167, lng: 128.3262 });
    expect(r).not.toBeNull();
    expect(r!.edgeIdx).toBe(1);
  });

  it("수선의 발이 변 위 좌표로 반환됨", () => {
    const r = closestEdgePoint(SQUARE, { lat: 35.7167, lng: 128.327 });
    expect(r).not.toBeNull();
    // 동쪽 변 (lng=128.3261, lat 35.7163~35.7172)
    expect(r!.projection[0]).toBeCloseTo(128.3261, 4);
  });

  it("빈 polygon → null", () => {
    expect(closestEdgePoint([], { lat: 35.7, lng: 128.3 })).toBeNull();
  });
});

describe("findFlattestVertex", () => {
  it("정사각형 — 모든 꼭지점 90° → cos≈0", () => {
    const r = findFlattestVertex(SQUARE);
    expect(r).not.toBeNull();
    expect(Math.abs(r!.cosAngle)).toBeLessThan(0.1);
  });

  it("거의 직선상 점이 있는 polygon → 그 점 반환 (cos≈1)", () => {
    // 사각형의 한 변 위에 거의 직선상 추가된 점 (남쪽 변 중간)
    const POLY: Position[][] = [
      [
        [128.325, 35.7163],
        [128.32555, 35.71631], // 거의 남쪽 변 위 — flat 후보
        [128.3261, 35.7163],
        [128.3261, 35.7172],
        [128.325, 35.7172],
        [128.325, 35.7163],
      ],
    ];
    const r = findFlattestVertex(POLY);
    expect(r).not.toBeNull();
    expect(r!.vertexIdx).toBe(1); // 거의 직선 점
    expect(r!.cosAngle).toBeGreaterThan(0.9);
  });

  it("3점(closed length 4) polygon → null (삭제 시 3점 미만 됨)", () => {
    const TRIANGLE: Position[][] = [
      [
        [128.325, 35.7163],
        [128.3261, 35.7163],
        [128.3256, 35.7172],
        [128.325, 35.7163],
      ],
    ];
    expect(findFlattestVertex(TRIANGLE)).toBeNull();
  });

  it("빈 polygon → null", () => {
    expect(findFlattestVertex([])).toBeNull();
  });
});

describe("findLongestEdge", () => {
  it("정사각형 — 4변 중 하나 반환 (위경도 환산 미세 오차로 어느 변이든 가능)", () => {
    const r = findLongestEdge(SQUARE);
    expect(r).not.toBeNull();
    expect([0, 1, 2, 3]).toContain(r!.edgeIdx);
    expect(r!.lengthM).toBeGreaterThan(80);
    expect(r!.lengthM).toBeLessThan(120);
  });

  it("직사각형 — 긴 변 반환", () => {
    // 가로 200m × 세로 100m
    const RECT: Position[][] = [
      [
        [128.325, 35.7163],
        [128.3272, 35.7163], // 약 200m 동
        [128.3272, 35.7172], // 약 100m 북
        [128.325, 35.7172],
        [128.325, 35.7163],
      ],
    ];
    const r = findLongestEdge(RECT);
    expect(r).not.toBeNull();
    // 변 0 (남) 또는 변 2 (북) — 둘 다 긴 변. 첫 발견인 변 0 반환.
    expect([0, 2]).toContain(r!.edgeIdx);
    expect(r!.lengthM).toBeGreaterThan(150);
  });

  it("midpoint 가 변 양 끝의 중간", () => {
    const r = findLongestEdge(SQUARE);
    const a = SQUARE[0][r!.edgeIdx];
    const b = SQUARE[0][r!.edgeIdx + 1];
    expect(r!.midpoint[0]).toBeCloseTo((a[0] + b[0]) / 2, 6);
    expect(r!.midpoint[1]).toBeCloseTo((a[1] + b[1]) / 2, 6);
  });

  it("빈 polygon → null", () => {
    expect(findLongestEdge([])).toBeNull();
  });
});

describe("createDefaultRect", () => {
  it("15m × 15m ≈ 225㎡ 사각형 (기본)", () => {
    const center = { lat: 35.7163, lng: 128.325 };
    const r = createDefaultRect(center);
    expect(r).toHaveLength(1); // ring 1개
    expect(r[0]).toHaveLength(5); // 4점 + 첫=마지막 closed
    const a = calcAreaM2(r);
    expect(a).toBeGreaterThan(200);
    expect(a).toBeLessThan(260);
  });

  it("크기 지정 — 30m → 약 900㎡", () => {
    const r = createDefaultRect({ lat: 35.7163, lng: 128.325 }, 30);
    const a = calcAreaM2(r);
    expect(a).toBeGreaterThan(800);
    expect(a).toBeLessThan(1000);
  });

  it("닫힌 ring (첫 점 = 마지막 점)", () => {
    const r = createDefaultRect({ lat: 35.7163, lng: 128.325 });
    expect(r[0][0]).toEqual(r[0][4]);
  });

  it("centroid 가 입력 center 와 거의 일치", () => {
    const center = { lat: 35.7163, lng: 128.325 };
    const r = createDefaultRect(center);
    const c = polygonCenter(r);
    expect(c).not.toBeNull();
    expect(c!.lat).toBeCloseTo(center.lat, 5);
    expect(c!.lng).toBeCloseTo(center.lng, 5);
  });
});
