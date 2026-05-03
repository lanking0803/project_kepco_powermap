/**
 * 건축HUB 표제부 (getBrTitleInfo) 호출.
 *
 * 한 지번 위에 지어진 메인 건물(들)의 영업 결정 정보.
 * (총괄표제부·층별·전유부 등 나머지 6개 operation 은 미래 확장 시 별도 파일.)
 *
 * 입력 = PNU 19자리. 산구분 자동 처리.
 * 출력 = BuildingTitleInfo[] (0건도 정상 — 빈 땅이거나 미등록).
 *
 * PNU → 건축HUB 5필드 매핑:
 *   PNU[0:5]   → sigunguCd
 *   PNU[5:10]  → bjdongCd
 *   PNU[10]    → platGbCd  (PNU 1=일반→0, 2=산→1)
 *   PNU[11:15] → bun
 *   PNU[15:19] → ji
 *
 * 발췌 정책: 응답 78개 필드 중 영업 가치 있는 ~22개만 정규화 (추가 호출 0).
 */

const ENDPOINT =
  "https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo";
const KEY = process.env.DATA_GO_KR_KEY || "";

export interface BuildingTitleInfo {
  // ── 식별 / TL;DR
  /** 관리건축물대장PK (예: "11680-700402") — 한 동 unique 키. 시설 모드 적재 시 PRIMARY. */
  mgmBldrgstPk: string | null;
  bldNm: string | null; // 건물명 (대부분 빈 값)
  mainPurpsCdNm: string; // 주용도 ("공장", "단독주택", ...)
  /** 주용도 5자리 코드 — 시설 모드 SQL 필터용. 예: "21000"=동·식물관련시설 */
  mainPurpsCd: string | null;
  /** 기타용도 — 유리온실/축사/돈사 세부 식별 */
  etcPurps: string | null;
  regstrKindCdNm: string | null; // 건축물 종류 ("일반건축물", "집합건축물")
  mainAtchGbCdNm: string | null; // "주건축물" / "부속건축물"
  /** 주부속구분코드 — "0"=주건축물 / "1"=부속건축물. 시설 모드 1차 필터(부속 제외) */
  mainAtchGbCd: string | null;
  useAprDay: string | null; // 사용승인일 YYYYMMDD
  pmsDay: string | null; // 허가일 YYYYMMDD
  stcnsDay: string | null; // 착공일 YYYYMMDD

  // ── 옥상 태양광 핵심
  archArea: number | null; // 건축면적 ㎡ (≈ 옥상 가용)
  totArea: number; // 연면적 ㎡
  roofCdNm: string | null; // 지붕 ("평슬래브", "기타지붕" 등)
  /** 지붕 코드 — 시설 모드: "41" = 유리 (유리온실 식별) */
  roofCd: string | null;
  etcRoof: string | null; // 기타지붕일 때 실제 자재 ("판넬", "슬레이트" 등)
  strctCdNm: string | null; // 구조 ("일반철골구조", "철근콘크리트구조" 등)
  heit: number | null; // 건축물 높이 m
  grndFlrCnt: number; // 지상층수
  ugrndFlrCnt: number; // 지하층수

  // ── 부지 · 확장
  platArea: number | null; // 대지면적 ㎡
  bcRat: number | null; // 건폐율 %
  vlRat: number | null; // 용적률 %
  atchBldCnt: number; // 부속건물 수
  atchBldArea: number; // 부속건물 합계 면적 ㎡

  // ── 조건부 (있을 때만)
  hhldCnt: number; // 세대수 (주택만)
  fmlyCnt: number; // 가구수
  hoCnt: number; // 호수
  oudrAutoUtcnt: number; // 옥외주차 대수

  // ── 주소 (헤더 중복이지만 대장 권위 출처용)
  newPlatPlc: string | null;
  platPlc: string | null;

  // ── PNU 합성 원천 (lib/facility/pnu.buildPnuFromRawItem 가 사용)
  sigunguCd: string | null;
  bjdongCd: string | null;
  platGbCd: string | null;
  bun: string | null;
  ji: string | null;
}

/**
 * 건축HUB 응답 단일 item — 78개 필드 중 우리가 발췌한 것만 선언.
 *
 * 외부 API 가 string 으로 보내는 게 보통이지만 일부 필드(mgmBldrgstPk, archArea 등)는
 * 응답 환경에 따라 number 로 떨어지는 경우가 실측됨 (2026-05-03 일괄 조회 검증).
 * → 타입은 `string | number` 둘 다 허용, normalize 가 흡수.
 */
type RawCell = string | number | null | undefined;

export interface BrTitleItem {
  mgmBldrgstPk?: RawCell;
  bldNm?: RawCell;
  mainPurpsCdNm?: RawCell;
  mainPurpsCd?: RawCell;
  etcPurps?: RawCell;
  regstrKindCdNm?: RawCell;
  mainAtchGbCdNm?: RawCell;
  mainAtchGbCd?: RawCell;
  useAprDay?: RawCell;
  pmsDay?: RawCell;
  stcnsDay?: RawCell;
  archArea?: RawCell;
  totArea?: RawCell;
  roofCdNm?: RawCell;
  roofCd?: RawCell;
  etcRoof?: RawCell;
  strctCdNm?: RawCell;
  heit?: RawCell;
  grndFlrCnt?: RawCell;
  ugrndFlrCnt?: RawCell;
  platArea?: RawCell;
  bcRat?: RawCell;
  vlRat?: RawCell;
  atchBldCnt?: RawCell;
  atchBldArea?: RawCell;
  hhldCnt?: RawCell;
  fmlyCnt?: RawCell;
  hoCnt?: RawCell;
  oudrAutoUtcnt?: RawCell;
  newPlatPlc?: RawCell;
  platPlc?: RawCell;
  // PNU 합성 원천 (lib/facility/pnu)
  sigunguCd?: RawCell;
  bjdongCd?: RawCell;
  platGbCd?: RawCell;
  bun?: RawCell;
  ji?: RawCell;
  // 페이지네이션 메타 (응답 envelope 안에 같이 박혀있는 케이스 — 일괄 조회용)
  rnum?: RawCell;
}

interface BrTitleResponse {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: {
      // items 가 정상이면 객체, 결과 0건일 때 빈 문자열로 오는 케이스 둘 다 방어
      items?: { item?: BrTitleItem | BrTitleItem[] } | string;
      totalCount?: string | number;
    };
  };
}

export async function getBuildingTitleByPnu(
  pnu: string,
): Promise<BuildingTitleInfo[]> {
  if (!/^\d{19}$/.test(pnu)) return [];
  if (!KEY) throw new Error("DATA_GO_KR_KEY 환경변수가 등록되지 않았습니다.");

  const sigunguCd = pnu.slice(0, 5);
  const bjdongCd = pnu.slice(5, 10);
  const platGbCd = pnu[10] === "2" ? "1" : "0";
  const bun = pnu.slice(11, 15);
  const ji = pnu.slice(15, 19);

  const params = new URLSearchParams({
    serviceKey: KEY,
    sigunguCd,
    bjdongCd,
    platGbCd,
    bun,
    ji,
    _type: "json",
    numOfRows: "100",
    pageNo: "1",
  });

  const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`건축HUB HTTP ${res.status}`);

  const data = (await res.json()) as BrTitleResponse;
  const code = data.response?.header?.resultCode;
  if (code && code !== "00") {
    throw new Error(
      `건축HUB ${code}: ${data.response?.header?.resultMsg ?? ""}`,
    );
  }

  const items = data.response?.body?.items;
  if (!items || typeof items !== "object") return [];
  const raw = items.item;
  if (!raw) return [];
  const arr: BrTitleItem[] = Array.isArray(raw) ? raw : [raw];
  return arr.map(normalize);
}

/** BrTitleItem → BuildingTitleInfo 정규화 (단건/목록 공용) */
export function normalize(it: BrTitleItem): BuildingTitleInfo {
  return {
    mgmBldrgstPk: clean(it.mgmBldrgstPk),
    bldNm: clean(it.bldNm),
    mainPurpsCdNm: clean(it.mainPurpsCdNm) ?? "",
    mainPurpsCd: clean(it.mainPurpsCd),
    etcPurps: clean(it.etcPurps),
    regstrKindCdNm: clean(it.regstrKindCdNm),
    mainAtchGbCdNm: clean(it.mainAtchGbCdNm),
    mainAtchGbCd: clean(it.mainAtchGbCd),
    useAprDay: clean(it.useAprDay),
    pmsDay: clean(it.pmsDay),
    stcnsDay: clean(it.stcnsDay),

    archArea: numOrNull(it.archArea),
    totArea: num(it.totArea),
    roofCdNm: clean(it.roofCdNm),
    roofCd: clean(it.roofCd),
    etcRoof: clean(it.etcRoof),
    strctCdNm: clean(it.strctCdNm),
    heit: numOrNull(it.heit),
    grndFlrCnt: num(it.grndFlrCnt),
    ugrndFlrCnt: num(it.ugrndFlrCnt),

    platArea: numOrNull(it.platArea),
    bcRat: numOrNull(it.bcRat),
    vlRat: numOrNull(it.vlRat),
    atchBldCnt: num(it.atchBldCnt),
    atchBldArea: num(it.atchBldArea),

    hhldCnt: num(it.hhldCnt),
    fmlyCnt: num(it.fmlyCnt),
    hoCnt: num(it.hoCnt),
    oudrAutoUtcnt: num(it.oudrAutoUtcnt),

    newPlatPlc: clean(it.newPlatPlc),
    platPlc: clean(it.platPlc),

    sigunguCd: clean(it.sigunguCd),
    bjdongCd: clean(it.bjdongCd),
    platGbCd: clean(it.platGbCd),
    bun: clean(it.bun),
    ji: clean(it.ji),
  };
}

/**
 * 외부 API 응답 필드는 보통 string 인데 일부 (mgmBldrgstPk, archArea 등)는
 * 숫자로 떨어지는 경우가 있어서 `string | number | null | undefined` 모두 방어.
 *
 * 큰 숫자(예: 25자리 mgmBldrgstPk) 가 number 로 떨어지면 정밀도 손실 +
 * scientific notation 직렬화로 같은 키가 여러 행에서 충돌함 (2026-05-03 React duplicate key 사고).
 * → number 일 때는 toFixed(0) 으로 정수 표기 보존.
 */
function clean(v: unknown): string | null {
  if (v == null) return null;
  let s: string;
  if (typeof v === "string") {
    s = v;
  } else if (typeof v === "number") {
    s = Number.isFinite(v) ? v.toFixed(0) : String(v);
  } else {
    s = String(v);
  }
  const t = s.trim();
  return t ? t : null;
}

function num(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
