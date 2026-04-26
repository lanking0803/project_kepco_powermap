/**
 * VWorld WFS 도로명주소건물(`lt_c_spbd`) 조회 래퍼.
 *
 * PNU 19자리 → 그 필지 위 건물 N동의 폴리곤 + 동별 면적/층수 반환.
 * 견적 모드에서 옥상 면적 산출 + 동별 패널 시각화의 기반 데이터.
 *
 * 검증 (2026-04-26 / scripts/test-vworld-buildings):
 *   - 등록된 키로 GetCapabilities 통과 (lt_c_spbd 활성)
 *   - PNU 키 1:1 매칭 가능 (response properties 의 pnu 19자리)
 *   - 직리 179 BBOX 11동 / 서울시청 BBOX 33동 정상 응답
 *   - 좌표 EPSG:4326 한국 영역, 면적 27~1648평 합리적 분포
 *   - 한계: 비닐하우스/간이 슬레이트 축사 = 가설건축물 → 미등록
 *           (사용자가 견적 모드 "직접 그리기" 로 처리)
 *
 * 설계 원칙:
 *   - 필지(`lib/vworld/parcel.ts`) 와 동일 패턴 — fes:Filter PropertyIsEqualTo, 1:1 매칭
 *   - 좌표는 JibunInfo 와 분리, BuildingPolygon 단일 타입에 모아둠
 *   - 면적은 Turf.js area 계산값 사용 (KEPCO/건축물대장과 일관)
 */

import area from "@turf/area";
import centroid from "@turf/centroid";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import { getParcelByPnu } from "./parcel";

const VWORLD_KEY = process.env.VWORLD_KEY || "";
const WFS_URL = "https://api.vworld.kr/req/wfs";
const LAYER = "lt_c_spbd";

/** VWorld 등록 도메인 — Referer + URL `domain` 둘 다 필수 */
export const VWORLD_DOMAIN = "sunlap.kr";

/**
 * WFS fetch timeout (ms).
 *
 * 2026-04-26: fes:Filter PNU (7초) → BBOX + 클라이언트 필터 (44ms) 로 전환.
 * VWorld lt_c_spbd 는 PNU 컬럼 인덱스가 풀스캔 수준이지만 spatial(BBOX) 인덱스는 정상.
 * 검증 스크립트 05-bottleneck.ts 결과: BBOX 가 99% 빠름.
 * 짧은 timeout 로 충분.
 */
const TIMEOUT_MS = 5000;

/** 부지 경계 BBOX 에 추가하는 패딩 (도 단위, ≈10m) — 경계에 걸친 건물 누락 방지 */
const BBOX_PADDING_DEG = 0.0001;

// ───────────────────────────────────────────
// 타입
// ───────────────────────────────────────────

/**
 * 건물 1동 정보 (견적 모드에서 옥상 = 1 BuildingPolygon).
 *
 * lt_c_spbd 응답 properties 22개 중 영업가치 있는 것만 발췌:
 *   - 식별: pk, bd_mgt_sn, pnu
 *   - 주소: sido, sigungu, gu, rd_nm, buld_no
 *   - 건물 속성: gro_flo_co(지상층수), und_flo_co(지하층수), buld_nm(건물명)
 *   - 형상: polygon(외곽선), area_m2, center
 */
export interface BuildingPolygon {
  /** VWorld 내부 PK (참고용, 견적 모드에선 array index 로 충분) */
  pk: string;
  /** 건물관리번호 25자리 — 건축물대장 표제부 PK (bd_mgt_sn 으로 join 가능) */
  bd_mgt_sn: string;
  /** 필지 PNU 19자리 — 입력 필터와 동일 (검증용) */
  pnu: string;
  /** 시도 */
  sido: string;
  /** 시군구 */
  sigungu: string;
  /** 읍면동/구 (lt_c_spbd 는 `gu` 필드로 통합) */
  gu: string;
  /** 도로명 */
  rd_nm: string;
  /** 건물 본번 */
  buld_no: string;
  /** 지상 층수 */
  gro_flo_co: number;
  /** 지하 층수 */
  und_flo_co: number;
  /** 건물명 (일반 건물은 null/빈값 많음) */
  buld_nm: string;
  /** 외곽 폴리곤 좌표 (MultiPolygon 지원, [[[lng,lat],...],...]) */
  polygon: Position[][];
  /** 면적 (㎡) — Turf.js 계산값 */
  area_m2: number;
  /** 폴리곤 중심 좌표 (라벨/핀 위치용) */
  center: { lat: number; lng: number };
}

// ───────────────────────────────────────────
// WFS 응답 스키마
// ───────────────────────────────────────────

/**
 * lt_c_spbd properties (검증 스크립트 02-fetch-buildings.ts 응답 기준).
 *
 * 응답 예시:
 *   pk="478300029180"  bd_mgt_sn="4783035035101830000020745"
 *   sido="경상북도"  sigungu="고령군"  gu="개진면"  rd_nm="송천길"  buld_no="31"
 *   gro_flo_co=1  und_flo_co=0  buld_nm=null
 *   pnu="4783035035101830000"  buld_se_cd="0"
 *
 * 사용 안 하는 필드 (무시): bld_s, bld_e, sig_cd, rn_cd, emd_cd, zip_cd,
 *   xpos, ypos, poi_chk, bul_eng_nm, buld_nm_dc
 */
interface WfsProperties {
  pk: string;
  bd_mgt_sn: string;
  sido: string;
  sigungu: string;
  gu: string;
  rd_nm: string;
  buld_no: string;
  gro_flo_co: number | null;
  und_flo_co: number | null;
  buld_nm: string | null;
  pnu: string;
  [key: string]: unknown;
}

interface WfsFeature {
  type: "Feature";
  geometry: Polygon | MultiPolygon;
  properties: WfsProperties;
}

interface WfsResponse {
  type: "FeatureCollection";
  features: WfsFeature[];
}

// ───────────────────────────────────────────
// 메인: PNU → 건물 N동
// ───────────────────────────────────────────

/**
 * PNU 19자리로 그 필지 위 건물 폴리곤 N개 조회.
 *
 * fes:Filter PropertyIsEqualTo 로 1:1 매칭 — 인접 필지 건물 섞임 X.
 * 0건도 정상 응답 (빈 땅 / 가설건축물만 있는 부지).
 */
export async function getBuildingsByPnu(
  pnu: string,
): Promise<BuildingPolygon[]> {
  const result = await getBuildingsByPnuWithDebug(pnu);
  return result.rows;
}

/**
 * 디버그 정보 포함 변형 — atomic endpoint 가 _debug 응답에 포함하기 위해.
 * 운영 시에는 endpoint 가 _debug 를 노출하지 않음 (NODE_ENV=development 한정).
 */
export interface BuildingsDebugInfo {
  vworld_key_set: boolean;
  vworld_key_prefix: string;
  parcel_ms: number | null;
  bbox_ms: number | null;
  total_ms: number;
  http_status: number | null;
  bbox_features_count: number;
  pnu_filtered_count: number;
  body_preview: string | null;
  error_message: string | null;
}

/**
 * PNU → 그 필지 위 건물 폴리곤들.
 *
 * 흐름 (2026-04-26 BBOX 전환):
 *   1. getParcelByPnu(PNU) — 필지 폴리곤 받아 BBOX 추출 (~40ms)
 *   2. lt_c_spbd 를 BBOX 로 호출 (~44ms, spatial index)
 *   3. 응답 features 중 properties.pnu === 입력 PNU 만 필터
 *   4. 총 ~84ms (vs fes:Filter PNU 의 ~7000ms = 80배 빠름)
 */
export async function getBuildingsByPnuWithDebug(
  pnu: string,
): Promise<{ rows: BuildingPolygon[]; debug: BuildingsDebugInfo }> {
  const debug: BuildingsDebugInfo = {
    vworld_key_set: !!VWORLD_KEY,
    vworld_key_prefix: VWORLD_KEY.slice(0, 6),
    parcel_ms: null,
    bbox_ms: null,
    total_ms: 0,
    http_status: null,
    bbox_features_count: 0,
    pnu_filtered_count: 0,
    body_preview: null,
    error_message: null,
  };
  const t0 = Date.now();

  if (!VWORLD_KEY) {
    console.error("[VWorld Buildings] VWORLD_KEY 미설정");
    debug.error_message = "VWORLD_KEY 미설정";
    return { rows: [], debug };
  }
  const cleaned = (pnu || "").trim();
  if (!/^\d{19}$/.test(cleaned)) {
    debug.error_message = "PNU 형식 불일치";
    return { rows: [], debug };
  }

  // Step 1: 필지 폴리곤 → BBOX
  const tParcel = Date.now();
  const parcel = await getParcelByPnu(cleaned);
  debug.parcel_ms = Date.now() - tParcel;
  if (!parcel) {
    debug.error_message = "필지 폴리곤 없음 — BBOX 추출 불가";
    debug.total_ms = Date.now() - t0;
    return { rows: [], debug };
  }
  const bbox = computeBboxFromPolygon(parcel.geometry.polygon);
  if (!bbox) {
    debug.error_message = "필지 폴리곤에서 BBOX 추출 실패";
    debug.total_ms = Date.now() - t0;
    return { rows: [], debug };
  }

  // Step 2: BBOX 로 lt_c_spbd 호출 (spatial index, 빠름)
  const params = new URLSearchParams({
    key: VWORLD_KEY,
    domain: VWORLD_DOMAIN,
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typename: LAYER,
    output: "application/json",
    srsName: "EPSG:4326",
    bbox: [
      bbox.minLng - BBOX_PADDING_DEG,
      bbox.minLat - BBOX_PADDING_DEG,
      bbox.maxLng + BBOX_PADDING_DEG,
      bbox.maxLat + BBOX_PADDING_DEG,
    ].join(","),
    maxFeatures: "200",
  });
  const url = `${WFS_URL}?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const tBbox = Date.now();
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Referer: `https://${VWORLD_DOMAIN}` },
      cache: "no-store",
    });
    debug.bbox_ms = Date.now() - tBbox;
    debug.http_status = res.status;
    if (!res.ok) {
      const body = await res.text();
      debug.body_preview = body.slice(0, 300);
      debug.total_ms = Date.now() - t0;
      console.error(
        `[VWorld Buildings] HTTP ${res.status} (${cleaned}) body=${body.slice(0, 300)}`,
      );
      return { rows: [], debug };
    }
    const data = (await res.json()) as WfsResponse;
    debug.bbox_features_count = data.features?.length ?? 0;

    // Step 3: PNU 필터
    const matched = (data.features ?? []).filter(
      (f) => (f.properties?.pnu ?? "") === cleaned,
    );
    debug.pnu_filtered_count = matched.length;
    debug.total_ms = Date.now() - t0;
    console.log(
      `[VWorld Buildings] pnu=${cleaned} parcel=${debug.parcel_ms}ms bbox=${debug.bbox_ms}ms total=${debug.total_ms}ms bbox_features=${debug.bbox_features_count} matched=${debug.pnu_filtered_count}`,
    );
    return { rows: matched.map(splitBuildingFeature), debug };
  } catch (err) {
    debug.bbox_ms = Date.now() - tBbox;
    debug.total_ms = Date.now() - t0;
    const e = err as Error;
    debug.error_message = e.name === "AbortError" ? `타임아웃 ${TIMEOUT_MS}ms` : e.message;
    if (e.name === "AbortError") {
      console.error(`[VWorld Buildings] BBOX 타임아웃 ${TIMEOUT_MS}ms (${cleaned})`);
    } else {
      console.error(`[VWorld Buildings] BBOX 호출 실패 (${cleaned}):`, err);
    }
    return { rows: [], debug };
  } finally {
    clearTimeout(timer);
  }
}

/** Polygon[][] → BBOX (외곽 ring 좌표만 사용, MultiPolygon 도 지원) */
function computeBboxFromPolygon(
  polygon: Position[][],
): { minLng: number; minLat: number; maxLng: number; maxLat: number } | null {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let hasAny = false;
  for (const ring of polygon) {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      hasAny = true;
    }
  }
  if (!hasAny) return null;
  return { minLng, maxLng, minLat, maxLat };
}

// ───────────────────────────────────────────
// 순수 함수 (테스트 대상)
// ───────────────────────────────────────────

/**
 * WFS Feature → BuildingPolygon.
 *
 * 영업가치 필드만 발췌, 나머지 무시. 좌표는 Polygon/MultiPolygon 둘 다 처리.
 */
export function splitBuildingFeature(feature: WfsFeature): BuildingPolygon {
  const p = feature.properties;
  const polygon = extractPolygonCoords(feature.geometry);
  const area_m2 = Math.round(
    area(feature as unknown as Feature<Polygon | MultiPolygon>),
  );
  const centerFeature = centroid(
    feature as unknown as Feature<Polygon | MultiPolygon>,
  );
  const [cLng, cLat] = centerFeature.geometry.coordinates;

  return {
    pk: p.pk ?? "",
    bd_mgt_sn: p.bd_mgt_sn ?? "",
    pnu: p.pnu ?? "",
    sido: p.sido ?? "",
    sigungu: p.sigungu ?? "",
    gu: p.gu ?? "",
    rd_nm: p.rd_nm ?? "",
    buld_no: p.buld_no ?? "",
    gro_flo_co: p.gro_flo_co ?? 0,
    und_flo_co: p.und_flo_co ?? 0,
    buld_nm: p.buld_nm ?? "",
    polygon,
    area_m2,
    center: { lat: cLat, lng: cLng },
  };
}

/**
 * Polygon/MultiPolygon → 외곽 링 좌표 배열들.
 * MultiPolygon 이면 여러 개 (카카오 Polygon 도 path 배열 지원).
 *
 * lib/vworld/parcel.ts 의 동일 함수와 일치 (의도적 — 둘 다 단순 외곽링만 필요).
 */
function extractPolygonCoords(geom: Polygon | MultiPolygon): Position[][] {
  if (geom.type === "Polygon") {
    return [geom.coordinates[0]];
  }
  return geom.coordinates.map((poly) => poly[0]);
}
