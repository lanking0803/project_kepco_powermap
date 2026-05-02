/**
 * VWorld WFS 자연취락지구 폴리곤 조회 — 시군구 단위 응답.
 *
 * 레이어: lt_c_uq128 (용도지구 — 자연취락지구)
 * 단위:   API 자체가 시군구(std_sggcd 5자리) 까지만 필터 가능. 읍면동/리 단위는 응답에 없음.
 *
 * 입력 인터페이스:
 *   - 호출 측은 bjd_code 10자리 그대로 전달 (다른 atomic endpoint 와 통일)
 *   - 내부에서 앞 5자리 자르고 std_sggcd 로 호출
 *   - 후처리(클릭한 마을 폴리곤과 교차 비교)는 호출 측 책임 — 응답 그대로 시군구 통째 반환
 *
 * 필터 함정 (검증 2026-05-02):
 *   - CQL_FILTER 무시당함 (응답에 필터 안 먹힘)
 *   - attrFilter 무시당함
 *   - FILTER (XML, FES 2.0) 만 작동 ✅
 *   → admin-polygon.ts 와 동일 패턴 사용
 */
import area from "@turf/area";
import centroid from "@turf/centroid";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";

import { VWORLD_DOMAIN } from "./parcel";

const VWORLD_KEY = process.env.VWORLD_KEY || "";
const WFS_URL = "https://api.vworld.kr/req/wfs";
const TIMEOUT_MS = 8000;

/** 시군구 1개당 자연취락지구 폴리곤 상한 (전국 최대 시 ~수백 개 추정, 여유). */
const MAX_FEATURES = 1000;

export interface UqVillage {
  /** VWorld 고유키 — UI 키 */
  mnum: string;
  /** "자연취락지구" (uname). 다른 용도지구는 lt_c_uq128 typename 분기로 들어오지 않음. */
  uname: string;
  /** "전북특별자치도" */
  sido_name: string;
  /** "전주시" */
  sigg_name: string;
  /** 고시년도 (VWorld dyear, 예: "2019"). 명세상 4자리 문자열. 누락 가능. */
  dyear: string | null;
  /** 외곽링들 (MultiPolygon 풀어서). [[[lng,lat], ...], ...] */
  polygon: Position[][];
  /** 가장 큰 폴리곤의 centroid (라벨 위치 안정성 — admin-polygon 패턴) */
  center: { lat: number; lng: number };
  /** ㎡ — Turf 계산값 (우선순위 표시 등에 활용 가능) */
  area_m2: number;
}

interface UqFeature {
  geometry: Polygon | MultiPolygon;
  properties: {
    mnum?: string;
    uname?: string;
    sido_name?: string;
    sigg_name?: string;
    std_sggcd?: string;
    dyear?: string;
    dnum?: string;
  };
}

interface WfsResponse {
  features?: UqFeature[];
}

/**
 * bjd_code 10자리 → 그 시군구의 자연취락지구 폴리곤 전체.
 * 호출 측은 결과 중 클릭한 마을과 교차하는 것만 추려서 사용.
 */
export async function getUqVillagesByBjd(
  bjdCode: string
): Promise<UqVillage[]> {
  if (!VWORLD_KEY) {
    console.error("[VWorld UQ] VWORLD_KEY 미설정");
    return [];
  }
  const cleaned = (bjdCode || "").trim();
  if (!/^\d{10}$/.test(cleaned)) return [];

  const sggCd = cleaned.slice(0, 5);

  const filter =
    `<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0">` +
    `<fes:PropertyIsEqualTo>` +
    `<fes:ValueReference>std_sggcd</fes:ValueReference>` +
    `<fes:Literal>${sggCd}</fes:Literal>` +
    `</fes:PropertyIsEqualTo>` +
    `</fes:Filter>`;

  const params = new URLSearchParams({
    key: VWORLD_KEY,
    domain: VWORLD_DOMAIN,
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typename: "lt_c_uq128",
    output: "application/json",
    srsName: "EPSG:4326",
    maxFeatures: String(MAX_FEATURES),
    FILTER: filter,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${WFS_URL}?${params.toString()}`, {
      signal: controller.signal,
      headers: { Referer: `https://${VWORLD_DOMAIN}` },
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.error(`[VWorld UQ] HTTP ${res.status} (sgg=${sggCd})`);
      return [];
    }
    const data = (await res.json()) as WfsResponse;
    const features = data.features ?? [];
    if (features.length === 0) return [];

    const result: UqVillage[] = [];
    for (const f of features) {
      const props = f.properties || {};
      // 외곽링 풀기 (Polygon → 1개, MultiPolygon → N개)
      const rings: Position[][] = [];
      if (f.geometry.type === "Polygon") {
        rings.push(f.geometry.coordinates[0]);
      } else {
        for (const poly of f.geometry.coordinates) rings.push(poly[0]);
      }
      if (rings.length === 0) continue;

      const feat = f as unknown as Feature<Polygon | MultiPolygon>;
      const a = area(feat);
      const c = centroid(feat);
      const [lng, lat] = c.geometry.coordinates;

      result.push({
        mnum: props.mnum ?? "",
        uname: props.uname ?? "자연취락지구",
        sido_name: props.sido_name ?? "",
        sigg_name: props.sigg_name ?? "",
        dyear: props.dyear ?? null,
        polygon: rings,
        center: { lat, lng },
        area_m2: a,
      });
    }
    return result;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      console.error(`[VWorld UQ] 타임아웃 ${TIMEOUT_MS}ms (sgg=${sggCd})`);
    } else {
      console.error(`[VWorld UQ] 호출 실패 (sgg=${sggCd}):`, err);
    }
    return [];
  } finally {
    clearTimeout(timer);
  }
}
