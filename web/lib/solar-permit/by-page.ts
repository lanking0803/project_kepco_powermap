/**
 * 전국 태양광 발전소 전기사업 허가 정보 — 페이지네이션 단위 조회.
 *
 * 외부 API: tn_pubr_public_solar_gen_flct_api (한국지능정보사회진흥원 NIA)
 *   - 명세 PDF: docs/api_specs/태양광허가정보/
 *   - 데이터 ID: 15107742 (data.go.kr)
 *   - 인증: serviceKey = DATA_GO_KR_KEY (다른 data.go.kr 4종과 공유)
 *
 * ⚠️ 검증 결과 (2026-04-26 직접 호출 검증):
 *   - 검색 필터 미지원: LCTN_LOTNO_ADDR / LCTN_ROAD_NM_ADDR / SOLAR_GEN_FCLT_NM
 *     → 응답에 있는 정확한 값을 입력해도 NODATA. 명세 표기와 달리 검색 색인 미적용.
 *   - LATITUDE / LONGITUDE: 응답 값과 byte 단위 정확 일치 시에만 매칭 → 실용성 0.
 *   - 한글 파라미터명 (소재지지번주소 등) → INVALID_REQUEST_PARAMETER_ERROR.
 *   - **유일하게 작동하는 입력 = pageNo + numOfRows + type.**
 *
 * 따라서 본 wrapper 의 역할:
 *   1. 페이지네이션 단위 다운로드 (1 페이지씩) — API 검증 + Phase 3 수집기 기반
 *   2. 응답 17 필드를 SolarPermit 으로 정규화
 *   3. 사용자 클릭 시점 검색은 불가 — Phase 3 정식 작업에서 DB 적재 후 별도 endpoint
 *
 * 한계:
 *   - 3 kW 이하 자가발전 누락 (허가 대상 아님 — 축사/온실은 30kW↑ 라 영향 적음)
 *   - 응답 = JSON (type=json) 또는 XML (기본)
 *   - numOfRows 최대 1,000
 *   - 전국 12만 행 (122 페이지) 규모
 */

const ENDPOINT =
  "https://api.data.go.kr/openapi/tn_pubr_public_solar_gen_flct_api";
const KEY = process.env.DATA_GO_KR_KEY || "";

/** WAF 우회 — 다른 data.go.kr 서비스와 동일 정책 */
const USER_AGENT = "Mozilla/5.0 (compatible; SUNLAP/1.0; +https://sunlap.kr)";

export interface SolarPermit {
  /** 시설명 (응답 필드: solarGenFcltNm) */
  facilityName: string;
  /** 지번주소 (lctnLotnoAddr) */
  lotnoAddr: string;
  /** 도로명주소 (lctnRoadNmAddr) — 일부 빈 값 */
  roadAddr: string | null;
  /** 위도 (latitude, EPSG:4326) */
  lat: number | null;
  /** 경도 (longitude) */
  lng: number | null;
  /** 발전 용량 kW (capa) */
  capacityKw: number;
  /** 설치위치구분 ("지상", "옥상", "기타" — instlDtlPstnSeNm) */
  installLocation: string | null;
  /** 가동상태 ("정상가동", "가동중단" 등 — oprtngSttsSeNm) */
  operatingStatus: string | null;
  /** 공급전압 (splyVolt) — 보통 "380" 같은 숫자 문자열 */
  supplyVoltage: string | null;
  /** 주파수 Hz (freq) */
  frequency: number | null;
  /** 설치년도 YYYY (instlYr) — 1900 같은 sentinel 가능 */
  installYear: number | null;
  /** 설치면적 ㎡ (instlArea) */
  installArea: number | null;
  /** 상세용도 ("발전사업" 등 — detlsUsg) */
  detailUsage: string | null;
  /** 허가일 (prmsnYmd, "YYYY-MM-DD") */
  permitDate: string | null;
  /** 허가기관 (prmsnInst) */
  permitInst: string | null;
  /** 데이터 기준일 (crtrYmd) */
  referenceDate: string | null;
  /** 데이터 제공 기관 코드 (insttCode) */
  instCode: string | null;
  /** 데이터 제공 기관명 (insttNm) */
  instName: string | null;
}

export interface SolarPermitsPage {
  page: number;
  size: number;
  totalCount: number;
  rows: SolarPermit[];
}

/** raw 응답 — camelCase (명세 PDF 의 대문자 표기와 다름, 실측 검증) */
interface RawApiItem {
  solarGenFcltNm?: string;
  lctnLotnoAddr?: string;
  lctnRoadNmAddr?: string;
  latitude?: string | number;
  longitude?: string | number;
  capa?: string | number;
  instlDtlPstnSeNm?: string;
  oprtngSttsSeNm?: string;
  splyVolt?: string | number;
  freq?: string | number;
  instlYr?: string | number;
  instlArea?: string | number;
  detlsUsg?: string;
  prmsnYmd?: string;
  prmsnInst?: string;
  crtrYmd?: string;
  insttCode?: string;
  insttNm?: string;
  [key: string]: unknown;
}

interface RawApiResponse {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: {
      totalCount?: string | number;
      items?: RawApiItem[] | { item?: RawApiItem | RawApiItem[] };
    };
  };
  // 일부 응답이 envelope 없이 옴
  header?: { resultCode?: string; resultMsg?: string };
  body?: {
    totalCount?: string | number;
    items?: RawApiItem[] | { item?: RawApiItem | RawApiItem[] };
  };
}

/**
 * 페이지 단위 태양광 허가 정보 조회.
 *
 * @param page  1-base 페이지 번호 (기본 1)
 * @param size  페이지당 행 수 (기본 100, 최대 1000)
 * @returns     정규화된 SolarPermit 배열 + 전체 totalCount
 */
export async function getSolarPermitsByPage(
  page: number = 1,
  size: number = 100,
): Promise<SolarPermitsPage> {
  if (!KEY) throw new Error("DATA_GO_KR_KEY 환경변수가 등록되지 않았습니다.");

  const safePage = Math.max(1, Math.floor(page));
  const safeSize = Math.min(1000, Math.max(1, Math.floor(size)));

  const params = new URLSearchParams({
    serviceKey: KEY,
    pageNo: String(safePage),
    numOfRows: String(safeSize),
    type: "json",
  });

  const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
    cache: "no-store",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const text = await res.text();
  if (text.trim().startsWith("<")) {
    throw new Error(
      `예상 외 XML/HTML 응답 (키/권한 의심): ${text.slice(0, 200)}`,
    );
  }

  let data: RawApiResponse;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`JSON 파싱 실패: ${text.slice(0, 200)}`);
  }

  const envelope = data.response ?? data;
  const code = envelope.header?.resultCode;
  if (code && code !== "00" && code !== "0000") {
    if (code === "03") {
      // NO_DATA — 정상 (빈 페이지)
      return { page: safePage, size: safeSize, totalCount: 0, rows: [] };
    }
    throw new Error(
      `solar-permit ${code}: ${envelope.header?.resultMsg ?? ""}`,
    );
  }

  const body = envelope.body ?? {};
  const totalCount = Number(body.totalCount ?? 0) || 0;

  const rawItems = body.items ?? [];
  let items: RawApiItem[] = [];
  if (Array.isArray(rawItems)) {
    items = rawItems;
  } else if (rawItems && typeof rawItems === "object") {
    const inner = (rawItems as { item?: RawApiItem | RawApiItem[] }).item;
    items = inner ? (Array.isArray(inner) ? inner : [inner]) : [];
  }

  const rows = items.map(normalize);

  return { page: safePage, size: safeSize, totalCount, rows };
}

function normalize(it: RawApiItem): SolarPermit {
  return {
    facilityName: clean(it.solarGenFcltNm) ?? "",
    lotnoAddr: clean(it.lctnLotnoAddr) ?? "",
    roadAddr: clean(it.lctnRoadNmAddr),
    lat: parseNumOrNull(it.latitude),
    lng: parseNumOrNull(it.longitude),
    capacityKw: parseNum(it.capa),
    installLocation: clean(it.instlDtlPstnSeNm),
    operatingStatus: clean(it.oprtngSttsSeNm),
    supplyVoltage: clean(it.splyVolt),
    frequency: parseNumOrNull(it.freq),
    installYear: parseNumOrNull(it.instlYr),
    installArea: parseNumOrNull(it.instlArea),
    detailUsage: clean(it.detlsUsg),
    permitDate: clean(it.prmsnYmd),
    permitInst: clean(it.prmsnInst),
    referenceDate: clean(it.crtrYmd),
    instCode: clean(it.insttCode),
    instName: clean(it.insttNm),
  };
}

function clean(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t ? t : null;
}

function parseNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : 0;
}

function parseNumOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}
