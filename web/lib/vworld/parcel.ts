/**
 * VWorld WFS 필지 정보 조회 래퍼.
 *
 * 좌표 → 해당 필지의 폴리곤 + 지번/지목/주소/면적 반환.
 *
 * 엔드포인트: https://api.vworld.kr/req/wfs
 * 레이어: lt_c_landinfobasemap (LX 한국국토정보공사 편집지적도)
 *
 * 2026-04-25: lp_pa_cbnd_bubun(VWorld 자체 연속지적도) → lt_c_landinfobasemap(LX)
 * 으로 교체. 시골에서 lp_pa_cbnd_bubun 이 토지이음/일사편리 위치와 67m 일관 어긋남
 * 확인됨. LX 는 정부 공식 지적측량 기관 데이터로 토지이음과 동일.
 *
 * 설계 원칙:
 *  - "지번" 이 모든 정보의 출발점. 진입이 좌표든 직접 지번이든 동일 구조로 수렴.
 *  - LX 응답의 `jibun`("179장"), `gbn_cd`("1"=일반/"2"=산), `jimok`(풀명칭) 직접 사용.
 *    본번/부번은 `mnnm`/`slno` (zero-pad 4자리, PNU 와 같은 형식).
 *  - 면적은 LX 가 `parea` 제공하지만 일관성 위해 Turf.js 계산값 사용.
 *  - 주소는 sido_nm + sgg_nm + emd_nm + ri_nm + jibun 조합 (LX 가 통합 addr 필드 미제공).
 */

import area from "@turf/area";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import centroid from "@turf/centroid";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";

const VWORLD_KEY = process.env.VWORLD_KEY || "";
const WFS_URL = "https://api.vworld.kr/req/wfs";
const SEARCH_URL = "https://api.vworld.kr/req/search";
const LAYER = "lt_c_landinfobasemap";

/** VWorld 등록 도메인. 서버 호출 시 Referer + URL `domain` 둘 다 필수. */
export const VWORLD_DOMAIN = "sunlap.kr";

/** BBOX 반경 (도 단위). 5m ≈ 0.00005° @ 한국 위도 */
const BBOX_DELTA = 0.00005;

/** WFS fetch timeout (ms) */
const TIMEOUT_MS = 3000;

// ───────────────────────────────────────────
// 타입 — 정보 단위로 분리
// ───────────────────────────────────────────

/**
 * 지번 정보 (DB 쿼리에 필요한 키 세트).
 * 좌표 진입 / 지번 직접 진입 모두 같은 구조로 수렴.
 */
export interface JibunInfo {
  /** 필지 고유번호 (19자리) */
  pnu: string;
  /** 지번 번호 (예: "148-11", "159-2", "산 23-4") */
  jibun: string;
  /** 산 지번 여부 */
  isSan: boolean;
  /** 시도 (예: "서울특별시") */
  ctp_nm: string;
  /** 시군구 (예: "강남구") */
  sig_nm: string;
  /** 읍면동 (예: "삼성동") */
  emd_nm: string;
  /** 리 (없을 수 있음) */
  li_nm: string;
  /** 전체 주소 문자열 */
  addr: string;
}

/**
 * 필지 형상/속성 정보 (VWorld 에서만 얻을 수 있는 부가 데이터).
 * DB(KEPCO) 여유용량과는 별개.
 */
export interface ParcelGeometry {
  /** 지목 (예: "대", "전", "답", "임야") */
  jimok: string;
  /** 면적 (㎡) — Turf.js 계산값 */
  area_m2: number;
  /** 공시지가 (원/㎡) — 보너스 */
  jiga: number | null;
  /** 필지 폴리곤 좌표 (MultiPolygon 지원, [[[lng,lat],...],...]) */
  polygon: Position[][];
  /** 폴리곤 중심 좌표 (핀 위치용, Turf.js centroid) */
  center: { lat: number; lng: number };
}

/** 통합 응답 (좌표 진입 시 한 번에 다 받음) */
export interface ParcelResult {
  jibun: JibunInfo;
  geometry: ParcelGeometry;
}

// ───────────────────────────────────────────
// WFS 응답 스키마
// ───────────────────────────────────────────

/**
 * LX 편집지적도(`lt_c_landinfobasemap`) 응답 properties.
 *
 * 응답 예시 (직리 179):
 *   pnu="4783035035101790000"  jibun="179장"  jimok="공장용지"
 *   mnnm="0179" (본번 4자리)   slno="0000" (부번 4자리, 0=부번없음)
 *   gbn_cd="1" (1=일반, 2=산)  gbn_nm="토지대장"
 *   sido_nm="경상북도"  sgg_nm="고령군"  emd_nm="개진면"  ri_nm="직리"|null
 *   jiga_ilp="110900"  parea="1810"
 */
interface WfsProperties {
  pnu: string;
  /** "179장", "산129-2임", "148-11대" 형태 — 끝 한글 = 지목 약자 */
  jibun: string;
  /** 지목 풀명칭 ("공장용지", "임야", "대", "도로" 등) */
  jimok: string;
  /** 본번 4자리 zero-pad (예: "0179") */
  mnnm: string;
  /** 부번 4자리 zero-pad (예: "0011", "0000"=부번없음) */
  slno: string;
  /** 대장구분: "1"=토지대장(일반), "2"=임야대장(산) */
  gbn_cd: string;
  gbn_nm: string;
  sido_nm: string;
  sgg_nm: string;
  emd_nm: string;
  /** 리 — 도시는 null */
  ri_nm: string | null;
  /** 개별공시지가 (원/㎡, 문자열) */
  jiga_ilp: string;
  /** 공부상 면적 (㎡, 문자열) */
  parea: string;
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
// 순수 함수 — 테스트 대상 (export 해서 단위 테스트)
// ───────────────────────────────────────────

/**
 * 지번 canonical form — DB 매칭 키로 쓰기 위한 정규화.
 *
 * 규칙:
 *   1. 모든 공백 제거 ("산 1-1" → "산1-1")
 *   2. 끝에 붙은 한글(지목/번지 접미사) 제거 ("189-5도" → "189-5", "42번지" → "42")
 *
 * KEPCO 전수 검증 결과 (2026-04-21): 저장 포맷이 `^(산)?\d+(-\d+)?$` 로 단일.
 * 이 정규화를 통과하면 KEPCO 포맷과 항상 일치.
 */
export function normalizeJibun(value: string): string {
  return (value || "")
    .replace(/\s+/g, "") // 모든 공백 제거
    .replace(/[가-힣]+$/, ""); // 끝에 붙은 한글 제거
}

/**
 * jibun 문자열 끝의 지목 약자 추출 (LX `jimok` 필드가 빈값일 때 fallback).
 *
 * "148-11 대"   → "대"
 * "159-2대"    → "대"
 * "100전"      → "전"
 * "159"        → ""  (지목 없음)
 */
export function parseJimok(jibunStr: string): string {
  if (!jibunStr) return "";
  const m = jibunStr.match(/([가-힣]{1,4})\s*$/);
  return m ? m[1] : "";
}

// ───────────────────────────────────────────
// 메인: 좌표 → 필지 정보
// ───────────────────────────────────────────

/**
 * 좌표에 속한 필지 정보 조회. 없으면 null.
 *
 * 처리 흐름:
 *   1. 좌표 주변 작은 BBOX (±5m) 로 WFS 호출
 *   2. 응답 필지들 중 point-in-polygon 으로 실제 포함 필지 선별
 *   3. JibunInfo + ParcelGeometry 로 분리해 반환
 */
export async function getParcelByPoint(
  lat: number,
  lng: number,
): Promise<ParcelResult | null> {
  if (!VWORLD_KEY) {
    console.error("[VWorld Parcel] VWORLD_KEY 미설정");
    return null;
  }

  const bbox = [
    lng - BBOX_DELTA,
    lat - BBOX_DELTA,
    lng + BBOX_DELTA,
    lat + BBOX_DELTA,
  ].join(",");

  const params = new URLSearchParams({
    key: VWORLD_KEY,
    domain: VWORLD_DOMAIN,
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typename: LAYER,
    output: "application/json",
    srsName: "EPSG:4326",
    bbox,
    maxFeatures: "10",
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
      console.error(`[VWorld Parcel] HTTP ${res.status}`);
      return null;
    }

    const data = (await res.json()) as WfsResponse;
    if (!data.features?.length) return null;

    // 해당 좌표가 실제로 포함되는 필지 선별 (BBOX 는 느슨, 정확 매칭은 클라이언트)
    const clickPoint: Feature<Point> = {
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [lng, lat] },
    };
    const match = data.features.find((f) => {
      try {
        return booleanPointInPolygon(
          clickPoint,
          f as unknown as Feature<Polygon | MultiPolygon>,
        );
      } catch {
        return false;
      }
    });

    if (!match) return null;

    return splitParcelFeature(match);
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      console.error(`[VWorld Parcel] 타임아웃 ${TIMEOUT_MS}ms`);
    } else {
      console.error(`[VWorld Parcel] 호출 실패:`, err);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * WFS Feature → JibunInfo + ParcelGeometry 로 분리.
 *
 * LX 매핑:
 *   - jibun: jibun 필드("179장") 끝 한글 제거 → "179"
 *   - isSan: gbn_cd="2" (임야대장)
 *   - jimok: jimok 필드 풀명칭("공장용지") 그대로. 빈 값이면 jibun 끝 한글 fallback.
 *   - jiga: jiga_ilp 정수화
 *   - addr: sido_nm + sgg_nm + emd_nm + ri_nm + jibun 조합 (LX 통합 addr 미제공)
 */
export function splitParcelFeature(feature: WfsFeature): ParcelResult {
  const p = feature.properties;

  const jibunNumber = normalizeJibun(p.jibun);
  const jimok = p.jimok || parseJimok(p.jibun);
  const isSan = p.gbn_cd === "2";

  const jiga = p.jiga_ilp ? parseInt(p.jiga_ilp, 10) : null;
  const area_m2 = Math.round(
    area(feature as unknown as Feature<Polygon | MultiPolygon>),
  );
  const polygon = extractPolygonCoords(feature.geometry);
  const centerFeature = centroid(
    feature as unknown as Feature<Polygon | MultiPolygon>,
  );
  const [cLng, cLat] = centerFeature.geometry.coordinates;

  const li_nm = p.ri_nm ?? "";
  const addr = [p.sido_nm, p.sgg_nm, p.emd_nm, li_nm, jibunNumber]
    .filter(Boolean)
    .join(" ");

  const jibun: JibunInfo = {
    pnu: p.pnu,
    jibun: jibunNumber,
    isSan,
    ctp_nm: p.sido_nm,
    sig_nm: p.sgg_nm,
    emd_nm: p.emd_nm,
    li_nm,
    addr,
  };
  const geometry: ParcelGeometry = {
    jimok,
    area_m2,
    jiga,
    polygon,
    center: { lat: cLat, lng: cLng },
  };
  return { jibun, geometry };
}

/**
 * Polygon/MultiPolygon → 외곽 링 좌표 배열들.
 * MultiPolygon 이면 여러 개 (카카오 Polygon 도 path 배열 지원).
 */
function extractPolygonCoords(geom: Polygon | MultiPolygon): Position[][] {
  if (geom.type === "Polygon") {
    return [geom.coordinates[0]];
  }
  return geom.coordinates.map((poly) => poly[0]);
}

// ───────────────────────────────────────────
// PNU → 필지 정보 (WFS fes:Filter, 1:1 정확 매칭)
// ───────────────────────────────────────────

/**
 * PNU 19자리로 WFS 직접 조회.
 * BBOX+point-in-polygon 대신 fes:Filter PropertyIsEqualTo 사용.
 * 실측 39ms, 1:1 매칭이라 오판 위험 없음.
 */
export async function getParcelByPnu(
  pnu: string,
): Promise<ParcelResult | null> {
  if (!VWORLD_KEY) {
    console.error("[VWorld Parcel] VWORLD_KEY 미설정");
    return null;
  }
  const cleaned = (pnu || "").trim();
  if (!cleaned) return null;

  const filter =
    `<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0">` +
    `<fes:PropertyIsEqualTo>` +
    `<fes:ValueReference>pnu</fes:ValueReference>` +
    `<fes:Literal>${cleaned}</fes:Literal>` +
    `</fes:PropertyIsEqualTo>` +
    `</fes:Filter>`;

  const params = new URLSearchParams({
    key: VWORLD_KEY,
    domain: VWORLD_DOMAIN,
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typename: LAYER,
    output: "application/json",
    srsName: "EPSG:4326",
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
      console.error(`[VWorld Parcel PNU] HTTP ${res.status} (${cleaned})`);
      return null;
    }
    const data = (await res.json()) as WfsResponse;
    const match = data.features?.[0];
    if (!match) return null;
    return splitParcelFeature(match);
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      console.error(`[VWorld Parcel PNU] 타임아웃 ${TIMEOUT_MS}ms (${cleaned})`);
    } else {
      console.error(`[VWorld Parcel PNU] 호출 실패 (${cleaned}):`, err);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ───────────────────────────────────────────
// 주소 → 필지 정보 (VWorld 검색 API + WFS PNU)
// ───────────────────────────────────────────

/** VWorld 검색 API 응답 (address/parcel) */
interface VWorldSearchResponse {
  response?: {
    status?: string;
    result?: {
      items?: Array<{
        id: string; // PNU 19자리
        address?: { parcel?: string };
        point?: { x: string; y: string };
      }>;
    };
  };
}

/**
 * 주소로 필지 정보 조회.
 *
 * 흐름:
 *   1. VWorld 검색 API (주소 → PNU + 좌표)
 *   2. 그 PNU 로 getParcelByPnu (WFS fes:Filter, 1:1 정확 매칭)
 *
 * 2026-04-22: 기존 getParcelByPoint(BBOX) → getParcelByPnu(FILTER) 전환.
 *   - 속도: ~500ms → ~40ms
 *   - 정확도: BBOX 는 여러 필지 반환 후 point-in-polygon 선별, PNU 는 직접 매칭
 */
export async function getParcelByAddress(
  address: string,
): Promise<ParcelResult | null> {
  if (!VWORLD_KEY) {
    console.error("[VWorld Parcel] VWORLD_KEY 미설정");
    return null;
  }
  const cleaned = (address || "").trim();
  if (!cleaned) return null;

  const params = new URLSearchParams({
    service: "search",
    request: "search",
    version: "2.0",
    crs: "EPSG:4326",
    size: "5",
    page: "1",
    query: cleaned,
    type: "address",
    category: "parcel",
    format: "json",
    errorformat: "json",
    key: VWORLD_KEY,
    domain: VWORLD_DOMAIN,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SEARCH_URL}?${params.toString()}`, {
      signal: controller.signal,
      headers: { Referer: `https://${VWORLD_DOMAIN}` },
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.error(`[VWorld Search] HTTP ${res.status} (${cleaned})`);
      return null;
    }
    const data = (await res.json()) as VWorldSearchResponse;
    if (data.response?.status !== "OK") return null;
    const items = data.response.result?.items ?? [];
    if (items.length === 0) return null;

    // 입력 주소와 parcel 문자열이 완전 일치하는 항목 우선, 없으면 첫 항목
    const exact =
      items.find((it) => (it.address?.parcel ?? "") === cleaned) ?? items[0];
    if (!exact.id) return null;

    // PNU 로 WFS 직접 조회 (fes:Filter, 1:1 매칭)
    return await getParcelByPnu(exact.id);
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      console.error(`[VWorld Search] 타임아웃 ${TIMEOUT_MS}ms (${cleaned})`);
    } else {
      console.error(`[VWorld Search] 호출 실패 (${cleaned}):`, err);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// GeoJSON Point 타입 (의존성 최소화 위해 local)
interface Point {
  type: "Point";
  coordinates: Position;
}
