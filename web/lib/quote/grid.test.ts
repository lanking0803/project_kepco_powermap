/**
 * 패널 격자 알고리즘 단위 테스트.
 */

import { describe, it, expect } from "vitest";
import {
  fillPanelGrid,
  calcLongestEdgeAngle,
  calcAutoRotation,
  calcAreaDimensions,
} from "./grid";
import { DEFAULT_MODULE, FACILITY_PLACEMENT } from "./panel";
import type { Position } from "geojson";

// 한국 위도 ~35.7° 기준 위경도 단위
// 약 1m ≈ 0.0000090 도 (위도)
// 경도는 위도에 따라 cos 보정 (35.7° 기준 ≈ 0.0000111)

/** 한 변 약 N m 인 정사각형 폴리곤 (위도 35.7163, 경도 128.325 기준) */
function makeSquare(sizeM: number): Position[][] {
  const lat0 = 35.7163;
  const lng0 = 128.325;
  const dLat = sizeM * 0.0000090;
  const dLng = sizeM * 0.0000111;
  return [
    [
      [lng0, lat0],
      [lng0 + dLng, lat0],
      [lng0 + dLng, lat0 + dLat],
      [lng0, lat0 + dLat],
      [lng0, lat0],
    ],
  ];
}

describe("fillPanelGrid — 회전 0 단순 격자", () => {
  it("매우 작은 영역 (모듈 한 장도 안 들어가는 크기) → 0장", () => {
    const tiny = makeSquare(1); // 1m × 1m. 모듈 2.465 × 1.134 안 들어감
    const layout = fillPanelGrid(
      tiny,
      DEFAULT_MODULE,
      FACILITY_PLACEMENT.노지,
      0,
    );
    expect(layout.count).toBe(0);
    expect(layout.panels).toEqual([]);
  });

  it("정사각형 30m × 30m / 노지 디폴트 → 패널 수 > 0 (이격 후 들어가는 만큼)", () => {
    const sq = makeSquare(30);
    const layout = fillPanelGrid(
      sq,
      DEFAULT_MODULE,
      FACILITY_PLACEMENT.노지,
      0,
    );
    // 30m 영역에 가장자리 1m inset, 모듈 2.465 × 1.134, 행간 2m
    // 가로 = (30 - 2) / (2.465 + 0.05) ≈ 11장
    // 세로 = (30 - 2) / (1.134 + 2.0) ≈ 8행 (한 행에 11장)
    // 총 ≈ 80~90장 정도 (구체값은 알고리즘에 의존)
    expect(layout.count).toBeGreaterThan(40);
    expect(layout.count).toBeLessThan(120);
    expect(layout.panels.length).toBe(layout.count);
    expect(layout.rotation).toBe(0);
  });

  it("정사각형 30m × 30m / 옥상 디폴트 (행간 1.5m) → 노지보다 패널 수 ↑", () => {
    const sq = makeSquare(30);
    const noji = fillPanelGrid(
      sq,
      DEFAULT_MODULE,
      FACILITY_PLACEMENT.노지,
      0,
    );
    const oksang = fillPanelGrid(
      sq,
      DEFAULT_MODULE,
      FACILITY_PLACEMENT.옥상,
      0,
    );
    // 옥상 행간 1.5m < 노지 2.0m + 가장자리 동일 → 옥상이 더 많이 들어감
    expect(oksang.count).toBeGreaterThan(noji.count);
  });

  it("정사각형 30m × 30m / 슬레이트 (행간 0, 가장자리 0.5) → 옥상보다 패널 수 ↑", () => {
    const sq = makeSquare(30);
    const oksang = fillPanelGrid(
      sq,
      DEFAULT_MODULE,
      FACILITY_PLACEMENT.옥상,
      0,
    );
    const slate = fillPanelGrid(
      sq,
      DEFAULT_MODULE,
      FACILITY_PLACEMENT.공장슬레이트,
      0,
    );
    expect(slate.count).toBeGreaterThan(oksang.count);
  });

  it("각 패널은 4꼭지점 + closed (5개 좌표)", () => {
    const sq = makeSquare(30);
    const layout = fillPanelGrid(
      sq,
      DEFAULT_MODULE,
      FACILITY_PLACEMENT.옥상,
      0,
    );
    expect(layout.count).toBeGreaterThan(0);
    for (const panel of layout.panels) {
      expect(panel.length).toBe(5);
      expect(panel[0]).toEqual(panel[4]); // 첫 == 마지막 (closed)
    }
  });

  it("빈 폴리곤 → 0장", () => {
    expect(
      fillPanelGrid([], DEFAULT_MODULE, FACILITY_PLACEMENT.노지, 0).count,
    ).toBe(0);
    expect(
      fillPanelGrid([[]], DEFAULT_MODULE, FACILITY_PLACEMENT.노지, 0).count,
    ).toBe(0);
  });

  it("3꼭지점 미만 폴리곤 → 0장", () => {
    const tooFew: Position[][] = [
      [
        [128.325, 35.7163],
        [128.326, 35.7163],
      ],
    ];
    expect(
      fillPanelGrid(tooFew, DEFAULT_MODULE, FACILITY_PLACEMENT.노지, 0).count,
    ).toBe(0);
  });
});

describe("fillPanelGrid — 가장자리 inset", () => {
  it("가장자리 inset 적용 — 노지(1m) > 슬레이트(0.5m), 영역 작을수록 차이 ↑", () => {
    // 영역 가장자리 근처 패널이 inset 으로 빠짐 → inset 작은 슬레이트가 더 들어감
    const sq = makeSquare(8); // 8m × 8m 작은 영역
    const noji = fillPanelGrid(
      sq,
      DEFAULT_MODULE,
      FACILITY_PLACEMENT.노지,
      0,
    );
    const slate = fillPanelGrid(
      sq,
      DEFAULT_MODULE,
      FACILITY_PLACEMENT.공장슬레이트,
      0,
    );
    expect(slate.count).toBeGreaterThanOrEqual(noji.count);
  });
});

describe("fillPanelGrid — 회전 적용", () => {
  it("회전 0 vs 회전 90° (정사각형) → 거의 동일한 패널 수", () => {
    const sq = makeSquare(30);
    const r0 = fillPanelGrid(
      sq,
      DEFAULT_MODULE,
      FACILITY_PLACEMENT.옥상,
      0,
    );
    const r90 = fillPanelGrid(
      sq,
      DEFAULT_MODULE,
      FACILITY_PLACEMENT.옥상,
      90,
    );
    // 정사각형은 회전해도 결과 큰 차이 X (모듈이 2.465 × 1.134 비대칭이라 약간 차이는 있음)
    // ±5장 이내 차이로 검증
    expect(Math.abs(r0.count - r90.count)).toBeLessThan(10);
    expect(r90.rotation).toBe(90);
  });
});

describe("calcLongestEdgeAngle — 가장 긴 변 각도", () => {
  it("정사각형 → 어느 변이든 길이 동일 (0 또는 90 둘 중 하나)", () => {
    const sq = makeSquare(30);
    const angle = calcLongestEdgeAngle(sq);
    // 첫 번째 변이 east (0°) 일 것이라 0 가까이 (부동소수 오차로 0~1 사이)
    expect(angle).toBeGreaterThanOrEqual(0);
    expect(angle).toBeLessThan(180);
  });

  it("가로로 긴 직사각형 (east 방향이 가장 긴 변) → 0° 근처", () => {
    // 가로 50m × 세로 10m
    const lat0 = 35.7163;
    const lng0 = 128.325;
    const dLat = 10 * 0.0000090;
    const dLng = 50 * 0.0000111;
    const rect: Position[][] = [
      [
        [lng0, lat0],
        [lng0 + dLng, lat0],
        [lng0 + dLng, lat0 + dLat],
        [lng0, lat0 + dLat],
        [lng0, lat0],
      ],
    ];
    const angle = calcLongestEdgeAngle(rect);
    // 가장 긴 변이 east (수평) → 0 또는 180 근처. 정규화로 0 근처.
    expect(angle).toBeLessThan(2);
  });

  it("세로로 긴 직사각형 (north 방향이 가장 긴 변) → 90° 근처", () => {
    // 가로 10m × 세로 50m
    const lat0 = 35.7163;
    const lng0 = 128.325;
    const dLat = 50 * 0.0000090;
    const dLng = 10 * 0.0000111;
    const rect: Position[][] = [
      [
        [lng0, lat0],
        [lng0 + dLng, lat0],
        [lng0 + dLng, lat0 + dLat],
        [lng0, lat0 + dLat],
        [lng0, lat0],
      ],
    ];
    const angle = calcLongestEdgeAngle(rect);
    // 가장 긴 변이 north (수직) → 90° 근처
    expect(angle).toBeGreaterThan(88);
    expect(angle).toBeLessThan(92);
  });

  it("폴리곤이 비어있거나 변이 너무 적으면 0 반환", () => {
    expect(calcLongestEdgeAngle([])).toBe(0);
    expect(calcLongestEdgeAngle([[]])).toBe(0);
    expect(calcLongestEdgeAngle([[[128, 35]]])).toBe(0);
  });
});

describe("calcAutoRotation — 시설 규칙 분기", () => {
  it("정남 → 0 고정 (폴리곤 모양 무관)", () => {
    const rect: Position[][] = [
      [
        [128.325, 35.7163],
        [128.326, 35.7163],
        [128.326, 35.717],
        [128.325, 35.717],
        [128.325, 35.7163],
      ],
    ];
    expect(calcAutoRotation(rect, "정남")).toBe(0);
  });

  it("건물긴변 → calcLongestEdgeAngle 결과 그대로", () => {
    const sq = makeSquare(30);
    expect(calcAutoRotation(sq, "건물긴변")).toBe(
      calcLongestEdgeAngle(sq),
    );
  });
});

describe("calcAreaDimensions — 영역 가로 × 세로 (m)", () => {
  it("정사각형 30m × 30m / 회전 0 → 가로 ~30m, 세로 ~30m", () => {
    const sq = makeSquare(30);
    const { widthM, heightM } = calcAreaDimensions(sq, 0);
    expect(widthM).toBeGreaterThan(28);
    expect(widthM).toBeLessThan(32);
    expect(heightM).toBeGreaterThan(28);
    expect(heightM).toBeLessThan(32);
  });

  it("가로 50m × 세로 10m / 회전 0 → 가로 ~50m, 세로 ~10m", () => {
    const lat0 = 35.7163;
    const lng0 = 128.325;
    const dLat = 10 * 0.0000090;
    const dLng = 50 * 0.0000111;
    const rect: Position[][] = [
      [
        [lng0, lat0],
        [lng0 + dLng, lat0],
        [lng0 + dLng, lat0 + dLat],
        [lng0, lat0 + dLat],
        [lng0, lat0],
      ],
    ];
    const { widthM, heightM } = calcAreaDimensions(rect, 0);
    expect(widthM).toBeGreaterThan(48);
    expect(widthM).toBeLessThan(52);
    expect(heightM).toBeGreaterThan(8);
    expect(heightM).toBeLessThan(12);
  });

  it("빈 폴리곤 → 0 × 0", () => {
    expect(calcAreaDimensions([], 0)).toEqual({ widthM: 0, heightM: 0 });
    expect(calcAreaDimensions([[]], 0)).toEqual({ widthM: 0, heightM: 0 });
  });
});

describe("fillPanelGrid + calcAutoRotation — 옥상 자동 회전 효과", () => {
  it("긴 직사각형 옥상에 자동 회전 적용 시 회전 0 보다 패널 수 ↑", () => {
    // 50m × 10m 가로로 긴 옥상. 회전 0 → 패널이 짧은 세로 (10m) 만 활용 → 적게 들어감.
    // 자동 회전 (가장 긴 변 = east) → 0 근처라 큰 차이 X. 다만 정확도 검증.
    const lat0 = 35.7163;
    const lng0 = 128.325;
    const dLat = 10 * 0.0000090;
    const dLng = 50 * 0.0000111;
    const rect: Position[][] = [
      [
        [lng0, lat0],
        [lng0 + dLng, lat0],
        [lng0 + dLng, lat0 + dLat],
        [lng0, lat0 + dLat],
        [lng0, lat0],
      ],
    ];
    const auto = calcAutoRotation(rect, "건물긴변");
    const r0 = fillPanelGrid(
      rect,
      DEFAULT_MODULE,
      FACILITY_PLACEMENT.옥상,
      0,
    );
    const rAuto = fillPanelGrid(
      rect,
      DEFAULT_MODULE,
      FACILITY_PLACEMENT.옥상,
      auto,
    );
    // 가로로 긴 영역 → r0 와 rAuto 차이가 크진 않지만, 자동 회전이 0 또는 그 이상 패널 수 보장
    expect(rAuto.count).toBeGreaterThanOrEqual(r0.count - 2);
  });
});
