/**
 * VWorld lt_c_spbd 응답 파싱 단위 테스트.
 *
 * 검증 스크립트(scripts/test-vworld-buildings/02-fetch-buildings.ts) 실측
 * 응답을 mock 으로 사용 → splitBuildingFeature 가 BuildingPolygon 으로
 * 정확히 변환하는지 확인.
 */

import { describe, it, expect } from "vitest";
import { splitBuildingFeature } from "./buildings";
import type { Polygon } from "geojson";

interface MockProps {
  pk?: string;
  bd_mgt_sn?: string;
  pnu?: string;
  sido?: string;
  sigungu?: string;
  gu?: string;
  rd_nm?: string;
  buld_no?: string;
  gro_flo_co?: number | null;
  und_flo_co?: number | null;
  buld_nm?: string | null;
}

function mockFeature(props: MockProps, coords?: number[][]) {
  const ring = coords ?? [
    [128.325, 35.7163],
    [128.3255, 35.7163],
    [128.3255, 35.7165],
    [128.325, 35.7165],
    [128.325, 35.7163],
  ];
  return {
    type: "Feature" as const,
    geometry: {
      type: "Polygon" as const,
      coordinates: [ring],
    } as Polygon,
    properties: {
      pk: props.pk ?? "478300029180",
      bd_mgt_sn: props.bd_mgt_sn ?? "4783035035101830000020745",
      sido: props.sido ?? "경상북도",
      sigungu: props.sigungu ?? "고령군",
      gu: props.gu ?? "개진면",
      rd_nm: props.rd_nm ?? "송천길",
      buld_no: props.buld_no ?? "31",
      // null 을 명시적으로 넘긴 케이스 방어 — `?? default` 는 null 도 default 로 덮음
      gro_flo_co: "gro_flo_co" in props ? props.gro_flo_co : 1,
      und_flo_co: "und_flo_co" in props ? props.und_flo_co : 0,
      buld_nm: "buld_nm" in props ? props.buld_nm : null,
      pnu: props.pnu ?? "4783035035101830000",
    },
  } as Parameters<typeof splitBuildingFeature>[0];
}

describe("splitBuildingFeature (lt_c_spbd)", () => {
  it("일반 농촌 건물 — 검증 스크립트 직리 179 첫 응답 그대로", () => {
    const r = splitBuildingFeature(mockFeature({}));
    expect(r.pk).toBe("478300029180");
    expect(r.bd_mgt_sn).toBe("4783035035101830000020745");
    expect(r.pnu).toBe("4783035035101830000");
    expect(r.sido).toBe("경상북도");
    expect(r.gu).toBe("개진면");
    expect(r.rd_nm).toBe("송천길");
    expect(r.buld_no).toBe("31");
    expect(r.gro_flo_co).toBe(1);
    expect(r.und_flo_co).toBe(0);
    expect(r.buld_nm).toBe(""); // null → 빈 문자열로 정규화
  });

  it("건물명 있는 도시 건물", () => {
    const r = splitBuildingFeature(
      mockFeature({
        sido: "서울특별시",
        sigungu: "중구",
        gu: "무교동",
        buld_nm: "서울시청",
        gro_flo_co: 13,
        und_flo_co: 5,
      }),
    );
    expect(r.buld_nm).toBe("서울시청");
    expect(r.gro_flo_co).toBe(13);
    expect(r.und_flo_co).toBe(5);
  });

  it("폴리곤 좌표 추출 + 면적 계산", () => {
    // 약 100m × 100m ≈ 10,000㎡ 사각형 (위도 35° 기준)
    const ring = [
      [128.325, 35.7163],
      [128.3261, 35.7163], // 약 100m 동
      [128.3261, 35.7172], // 약 100m 북
      [128.325, 35.7172],
      [128.325, 35.7163],
    ];
    const r = splitBuildingFeature(mockFeature({}, ring));
    expect(r.polygon).toHaveLength(1); // 외곽 링 1개
    expect(r.polygon[0]).toHaveLength(5); // 좌표 5개
    expect(r.area_m2).toBeGreaterThan(8000);
    expect(r.area_m2).toBeLessThan(12000);
  });

  it("center 가 폴리곤 내부 좌표로 계산됨 (한국 영역)", () => {
    const r = splitBuildingFeature(mockFeature({}));
    expect(r.center.lng).toBeGreaterThan(124);
    expect(r.center.lng).toBeLessThan(132);
    expect(r.center.lat).toBeGreaterThan(33);
    expect(r.center.lat).toBeLessThan(39);
  });

  it("층수 null → 0 으로 정규화 (가설건축물 미등록 케이스 방어)", () => {
    const r = splitBuildingFeature(
      mockFeature({ gro_flo_co: null, und_flo_co: null }),
    );
    expect(r.gro_flo_co).toBe(0);
    expect(r.und_flo_co).toBe(0);
  });
});
