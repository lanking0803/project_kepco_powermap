/**
 * 법원경매 raw → AuctionListItem (lib/hyphen/types.ts) 어댑터.
 *
 * 설계 원칙 (의뢰자 합의 2026-05-04):
 *   - SSOT: AuctionListItem 한 가지 타입을 마커/카드/모달이 사용
 *   - 채널 swap 시 route.ts 한 줄만 변경 (어댑터 함수 swap)
 *   - hyphen 의 enrichRawItems / pnu-fix.ts 와 같은 위치에서 동등한 역할
 *
 * 매핑 처리:
 *   1. 사건번호 파싱 — "2021타경4007" → { 사건년도: 2021, 사건번호: 4007 }
 *   2. 매각기일 — "20260511" + "1000" → "2026-05-11 10:00:00"
 *   3. PNU 합성 — srchHjguDongCd(8) + 리매칭(2) + addrGbncd + daepyoLotno
 *   4. 좌표 — bjd_master JOIN (xCordi/yCordi TM 변환은 별도 — 일단 동 단위 좌표 사용)
 *   5. 진행상태 한글 — yuchalCnt + maeGiil 비교로 ("신건"/"진행"/"유찰"/"매각"/"종결")
 */

import { buildPnuFromBjdAndJibun } from "@/lib/geo/pnu";
import type { AuctionListItem } from "@/lib/hyphen/types";
import { createAdminClient } from "@/lib/supabase/admin";

import type { CourtRawListItem } from "./types";

// ─── 메인 어댑터 (배열) ─────────────────────────────────

/**
 * Court raw 매물 배열 → AuctionListItem 배열.
 *
 * 0) 사건 단위 그룹핑 — 같은 (boCd, saNo) row 들을 1개 카드로 합침.
 *    court 응답은 한 사건의 매각자산 N개를 별도 row 로 보냄 (토지·건물·집합).
 *    예: 2024타경1199 → 503-8/산1-1/산1-6/...8 row → 1 카드, 사건 전체 합산 면적
 *    targetPnu 가 주어지면, 그 PNU 매칭되는 row 를 대표로 선정 (헤더에 사용자 클릭 지번 표시).
 * 1) bjd_master 일괄 조회 — 대표 row 의 BJD 코드로 좌표 매핑
 * 2) 매물별 좌표/bjd_code 매핑 후 정규화
 *
 * @param rawItems Court 응답 매물
 * @param opts.targetPnu by-pnu 흐름에서 사용자 클릭 PNU (대표 row 선정 우선순위 ⭐)
 */
export async function courtToAuctionItems(
  rawItems: CourtRawListItem[],
  opts?: { targetPnu?: string },
): Promise<AuctionListItem[]> {
  if (rawItems.length === 0) return [];

  // ── 0) 사건 단위 그룹핑 ────────────────────────────
  // 같은 (boCd, saNo) row = 한 사건. 사건 안의 매각자산 N개는 row 가 분리되어 옴.
  // targetPnu 가 있으면 그룹 안에서 그 PNU 매칭 row 를 대표로 선정.
  const grouped = groupCourtRawItems(rawItems, opts?.targetPnu);

  // ── 1) bjd_master 좌표 lookup — court 응답의 BJD 코드 직접 매칭 ──
  // raw 응답에 박혀있는 정확한 행정코드 사용 (한글 매칭 X — 동명/표기 흔들림 회피).
  //   - srchHjguRdCd: 10자리 BJD (리까지) — 있으면 그대로 사용
  //   - srchHjguDongCd: 8자리 BJD (동까지) — 리 없는 매물 (시 직할동 등)
  //                                          → "+00" 붙여 10자리 합성
  // bjd_master.bjd_code 는 10자리이므로 in() 한번에 lookup 가능.
  const bjdCodes = new Set<string>();
  for (const g of grouped) {
    const code = resolveBjdCode(g.representative);
    if (code) bjdCodes.add(code);
  }

  const coordMap = new Map<
    string,
    { lat: number | null; lng: number | null }
  >();

  if (bjdCodes.size > 0) {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("bjd_master")
      .select("bjd_code, lat, lng")
      .in("bjd_code", Array.from(bjdCodes));
    if (error) {
      console.error("[court-auction/adapter] bjd_master 조회 실패", error);
    } else {
      for (const row of data ?? []) {
        coordMap.set(row.bjd_code, {
          lat: row.lat ?? null,
          lng: row.lng ?? null,
        });
      }
    }
  }

  // ── 2) 매물별 정규화 (그룹 단위) ───────────────────
  return grouped.map((g) => {
    const raw = g.representative;
    const bjdCode = resolveBjdCode(raw);
    const coord = bjdCode ? coordMap.get(bjdCode) : undefined;
    return courtToAuctionItem(
      raw,
      bjdCode,
      { lat: coord?.lat ?? null, lng: coord?.lng ?? null },
      {
        groupSize: g.rows.length,
        landArea: g.landArea,
        buildingArea: g.buildingArea,
        breakdown: g.breakdown,
      },
    );
  });
}

/**
 * Court raw row → 행안부 표준 BJD 10자리.
 *
 * 우선순위:
 *   1. srchHjguRdCd (10자리) — court 가 박아주는 정확한 BJD (리 포함)
 *   2. srchHjguDongCd (8자리) + "00" — 리 없는 매물 (시 직할동/면 단위 등)
 *   3. daepyoSidoCd + daepyoSiguCd + daepyoDongCd + daepyoRdCd 합성 — 위 둘이 빈값일 때 fallback
 *
 * 한글주소(hjguDong/hjguRd) 는 사용 안 함 — 동명이리/표기흔들림 회피 (의뢰자 결정 2026-05-04).
 */
function resolveBjdCode(raw: CourtRawListItem): string | null {
  const srchRd = (raw.srchHjguRdCd ?? "").trim();
  if (/^\d{10}$/.test(srchRd)) return srchRd;

  const srchDong = (raw.srchHjguDongCd ?? "").trim();
  if (/^\d{8}$/.test(srchDong)) return `${srchDong}00`;

  // fallback — 분리 코드 합성
  const sd = (raw.daepyoSidoCd ?? "").trim();
  const sg = (raw.daepyoSiguCd ?? "").trim();
  const dg = (raw.daepyoDongCd ?? "").trim();
  const rd = (raw.daepyoRdCd ?? "00").trim();
  if (/^\d{2}$/.test(sd) && /^\d{3}$/.test(sg) && /^\d{3}$/.test(dg)) {
    return `${sd}${sg}${dg}${rd.padEnd(2, "0").slice(0, 2)}`;
  }
  return null;
}

/** 그룹핑 결과 — 대표 row + 합산 정보. */
interface CourtGroup {
  /** 대표 row (보통 jimokList 채워진 row, 없으면 첫 row) */
  representative: CourtRawListItem;
  /** 그룹에 속한 모든 row (대표 포함) */
  rows: CourtRawListItem[];
  /** 그룹 내 토지면적 합산 (jimokList 채워진 row 의 areaList 파싱) */
  landArea: number | null;
  /** 그룹 내 건물면적 합산 (buldList 가 의미있는 row 의 면적) */
  buildingArea: number | null;
  /** mokGbncd 분류별 row 수 — 카드 배지 "토지 N·건물 N·집합 N" 표시용. */
  breakdown: { land: number; building: number; aggregate: number };
}

/**
 * 사건 단위 그룹핑 — 같은 (boCd, saNo) row 들을 1개 카드로 합침.
 *
 * 그룹 키: boCd + saNo
 *   - boCd: 법원 코드 ("B000513")
 *   - saNo: 사건 raw 14자리 ("20230130057289")
 *
 * 한 사건이 매각하는 자산이 N개라도 (토지·건물·집합 모두 포함, 다른 지번 포함)
 * 카드는 1개로 통합. 가격/매각기일/유찰/담당계 모두 사건 단위 단일값이므로
 * 자산별로 카드를 쪼개면 정보 중복만 발생.
 * 자산별 상세는 카드 내부 매각자산 섹션 (이 지번 / 사건 전체 토글) 으로 정리.
 *
 * 한글 텍스트 비교는 회피 — addrGbncd 한글주소(A) / 도로명(R) row 분리 함정 회피.
 *
 * 대표 row 선정 우선순위:
 *   1. targetPnu (있으면) 매칭되는 row ⭐ — 사용자가 클릭한 지번이 카드 헤더로
 *   2. jimokList 채워진 row (= 토지 정보 있는 row)
 *   3. areaList 채워진 row
 *   4. mokmulSer 가장 작은 row
 */
function groupCourtRawItems(
  items: CourtRawListItem[],
  targetPnu?: string,
): CourtGroup[] {
  const groupMap = new Map<string, CourtRawListItem[]>();

  // 그룹 키로 묶기 (입력 순서 보존을 위해 keysOrder 별도 관리)
  const keysOrder: string[] = [];
  for (const it of items) {
    const key = makeGroupKey(it);
    if (!groupMap.has(key)) {
      groupMap.set(key, []);
      keysOrder.push(key);
    }
    groupMap.get(key)!.push(it);
  }

  return keysOrder.map((key) => {
    const rows = groupMap.get(key)!;
    const representative = pickRepresentative(rows, targetPnu);
    const landArea = sumLandArea(rows);
    const buildingArea = sumBuildingArea(rows);
    const breakdown = countByMokGbncd(rows);
    return { representative, rows, landArea, buildingArea, breakdown };
  });
}

/** mokGbncd 별 row 수 집계 — 01=토지 / 02=건물 / 03=집합건물. */
function countByMokGbncd(rows: CourtRawListItem[]): {
  land: number;
  building: number;
  aggregate: number;
} {
  let land = 0;
  let building = 0;
  let aggregate = 0;
  for (const r of rows) {
    const k = (r.mokGbncd ?? "").toString();
    if (k === "01") land++;
    else if (k === "02") building++;
    else if (k === "03") aggregate++;
  }
  return { land, building, aggregate };
}

function makeGroupKey(it: CourtRawListItem): string {
  // 빈 docid 케이스 방지 — docid 가 빈값이면 그룹핑 안 함 (단독 처리)
  if (!it.docid) return `__solo__${Math.random()}`;
  const bo = it.boCd ?? "";
  const sa = it.saNo ?? "";
  // 사건 단위 그룹핑: 핵심 코드(법원/사건) 중 하나라도 비면 단독 처리.
  if (!bo || !sa) return `__solo__${it.docid}`;
  return [bo, sa].join("|");
}

/**
 * 그룹 안에서 카드 헤더로 보여줄 row 선정.
 *
 * by-pnu 흐름: targetPnu 가 매칭되는 row 가 있으면 그 row 우선 — 사용자가 클릭한
 * 지번이 카드 헤더에 표시되어 컨텍스트 일치.
 * 시군구 sweep / 마커 흐름: targetPnu 미전달 → 기존 휴리스틱 유지.
 */
function pickRepresentative(
  rows: CourtRawListItem[],
  targetPnu?: string,
): CourtRawListItem {
  if (rows.length === 1) return rows[0];

  // 1. targetPnu 매칭 row — 사용자 클릭 지번 컨텍스트 보존
  if (targetPnu && /^\d{19}$/.test(targetPnu)) {
    const matched = rows.find((r) => buildPnuFromRaw(r) === targetPnu);
    if (matched) return matched;
  }

  // 2. jimokList 채워진 row (= 토지 정보 있는 row)
  const withJimok = rows.find((r) => (r.jimokList ?? "").trim() !== "");
  if (withJimok) return withJimok;

  // 3. areaList 채워진 row 우선
  const withArea = rows.find((r) => (r.areaList ?? "").trim() !== "");
  if (withArea) return withArea;

  // 4. mokmulSer 가장 작은 row
  return rows.slice().sort((a, b) => {
    const am = Number(a.mokmulSer) || 999;
    const bm = Number(b.mokmulSer) || 999;
    return am - bm;
  })[0];
}

/** raw row 1건 → PNU 19자리 (BJD 코드 + 지번 합성). 실패 시 null. */
function buildPnuFromRaw(raw: CourtRawListItem): string | null {
  const code = resolveBjdCode(raw);
  if (!code) return null;
  const jibun = composeJibun(raw);
  if (!jibun) return null;
  return buildPnuFromBjdAndJibun(code, jibun);
}

/** 그룹 내 토지면적 합산 — jimokList 채워진 row 의 areaList 만 ㎡ 환산해서 합. */
function sumLandArea(rows: CourtRawListItem[]): number | null {
  let sum = 0;
  let hasAny = false;
  for (const r of rows) {
    if (!(r.jimokList ?? "").trim()) continue;
    const a = parseAreaMeter(r.areaList);
    if (a.land != null) {
      sum += a.land;
      hasAny = true;
    }
  }
  return hasAny ? sum : null;
}

/** 그룹 내 건물면적 합산 — buldList 또는 areaList 의 건물 키워드 인 row 만. */
function sumBuildingArea(rows: CourtRawListItem[]): number | null {
  let sum = 0;
  let hasAny = false;
  for (const r of rows) {
    // 1) buldList 직접 파싱
    const fromBuld = parseAreaMeter(r.buldList);
    if (fromBuld.building != null) {
      sum += fromBuld.building;
      hasAny = true;
      continue;
    }
    // 2) areaList 가 건물 형식인 경우 (jimokList 빈 row + 구조 키워드)
    if (!(r.jimokList ?? "").trim()) {
      const fromArea = parseAreaMeter(r.areaList);
      if (fromArea.building != null) {
        sum += fromArea.building;
        hasAny = true;
      }
    }
  }
  return hasAny ? sum : null;
}

// ─── 단일 매물 어댑터 ─────────────────────────────────

/**
 * Court raw 매물 1건 + bjd 정보 → AuctionListItem.
 * bjd_master 조회는 호출자가 일괄 처리하고 결과를 주입.
 *
 * groupInfo (옵션):
 *   - 같은 (사건+지번) row N개를 합친 그룹의 정보
 *   - groupSize ≥ 2 면 카드에 "물건 N건" 배지 표시 (UI 가 물건번호갯수 > 1 보고 자동)
 *   - 단일 row 면 미전달 또는 groupSize=1
 */
export function courtToAuctionItem(
  raw: CourtRawListItem,
  bjdCode: string | null,
  coord: { lat: number | null; lng: number | null },
  groupInfo?: {
    groupSize: number;
    landArea: number | null;
    buildingArea: number | null;
    breakdown: { land: number; building: number; aggregate: number };
  },
): AuctionListItem {
  const 감정가 = Number(raw.gamevalAmt) || 0;
  const 최저가 = Number(raw.minmaePrice) || 0;
  const 유찰수 = Number(raw.yuchalCnt) || 0;
  const discountRatio = 감정가 > 0 ? Math.max(0, 1 - 최저가 / 감정가) : 0;

  // 사건번호 파싱 — "2021타경4007" → { year: 2021, num: 4007 }
  const { 사건년도, 사건번호 } = parseSrnSaNo(raw.srnSaNo);

  // 매각기일 — "20260511" + "1000" → "2026-05-11 10:00:00"
  const 매각기일 = formatMaeGiil(raw.maeGiil, raw.maeHh1);
  const 매각기일일자 = formatYmdDash(raw.maeGiil);
  const 매각기일일시 = formatHm(raw.maeHh1);

  // 진행상태 한글 — yuchalCnt 와 maeGiil 로 추정
  const 진행상태 = inferProgressStatus(raw.maeGiil, 유찰수, raw.mulJinYn);

  // PNU 조립
  let pnuStandard: string | null = null;
  if (bjdCode) {
    const jibun = composeJibun(raw);
    if (jibun) {
      pnuStandard = buildPnuFromBjdAndJibun(bjdCode, jibun);
    }
  }

  // 경매번호 PK — Court 엔 정수 PK 가 없어 docid 의 안정 부분에서 파생
  // hyphen 의 경매번호와 충돌 가능성 0 (hyphen 은 다른 채널)
  const 경매번호 = hashDocidToInt(raw.docid);
  const 사건번호코드 = hashDocidToInt(raw.docid + "_alt"); // 보조 PK

  // 매각기일 대비 D-day
  const daysLeft = computeDaysLeftFromYmd(raw.maeGiil);
  const isUrgent = daysLeft >= 0 && daysLeft <= 3;

  // 면적 — 그룹 합산값 우선, 없으면 단건 row 파싱.
  const 면적단건 = parseAreaMeter(raw.areaList);
  const 토지면적 = groupInfo?.landArea ?? 면적단건.land;
  const 건물면적 = groupInfo?.buildingArea ?? 면적단건.building;

  // 물건번호갯수 — 그룹 크기 (≥2 면 UI 카드 배지 자동 표시).
  // 단일 row 그룹은 1 (배지 미표시), groupInfo 미전달 시 null (기존 호환).
  const 물건번호갯수 =
    groupInfo == null ? null : Math.max(1, groupInfo.groupSize);
  // 물건번호 — 대표 row 의 mokmulSer (또는 maemulSer fallback). hyphen 호환.
  const 물건번호 = Number(raw.mokmulSer) || Number(raw.maemulSer) || 1;

  return {
    경매번호,
    사건번호코드,
    법원코드: raw.boCd ?? raw.cortOfcCd ?? "",
    사건년도,
    사건번호,
    물건번호,
    매각기일,
    감정가,
    최저가,
    물건용도코드: Number(raw.maemulUtilCd) || 0,
    진행상태코드: Number(raw.jinstatCd) || 0,
    진행상태,
    건물면적,
    토지면적,
    유찰수,
    도로명주소여부: raw.addrGbncd === "R" ? 1 : 0,
    // 의뢰자 결정 (2026-05-04): 항상 지번주소로 통일.
    // raw.printSt 는 R row 면 도로명("조은길 16")으로 옴 — 사용 X.
    // hjguSido/Sigu/Dong/Rd + daepyoLotno 조립으로 항상 지번 형식 보장.
    대표소재지: composeJibunAddrFromList(raw),
    담당계: raw.jpDeptNm ?? "",
    법원간략명: shortenCourtName(raw.jiwonNm),
    리스트지번주소: composeJibunAddrFromList(raw),
    토지가격비율: 1, // Court 응답엔 토지/건물 분리 비율 없음. 기본값.
    경매다용도: null,
    법원용도: raw.dspslUsgNm ?? null,
    물건번호갯수,
    낙찰가: null,
    용도: raw.dspslUsgNm ?? null,
    매각기일일자,
    매각기일일시,

    // 추가 필드
    사건명칭: raw.srnSaNo, // "2021타경4007"
    pnuStandard,
    bjdCode,
    lat: coord.lat,
    lng: coord.lng,
    discountRatio,
    daysLeft,
    isUrgent,
    // court 채널 — 합쳐진 카드면 분류별 카운트 노출 (UI 카드 배지용)
    ...(groupInfo && groupInfo.groupSize > 1
      ? { groupBreakdown: groupInfo.breakdown }
      : {}),
    // court 사건키 — 모달에서 /api/auction/court-detail 호출용.
    // boCd 와 cortOfcCd 둘 다 응답에 박힘. boCd 우선 (docid 의 법원 5자리 부분과 일치).
    courtCaseKey: {
      cortOfcCd: raw.boCd ?? raw.cortOfcCd ?? "",
      csNo: raw.saNo ?? "",
    },
    // 지번 (본번-부번) — composeJibun 으로 산 표기 보강 후 그대로 박음.
    지번: composeJibun(raw) ?? (raw.daepyoLotno ?? "").trim(),
    // 회차별 최저가 이력 — 영업 시각: 가격 하락 추이 시각화용
    회차별최저가: extractRoundPrices(raw),
  };
}

/**
 * raw.notifyMinmaePrice1~4 + Rate1~2 → 회차별 가격 배열.
 * 0/빈값 회차는 제외. 첫 회차부터 의미 있는 회차만 반환.
 */
function extractRoundPrices(
  raw: CourtRawListItem,
): Array<{ 회차: number; 가격: number; 감정대비비율: number | null }> {
  const prices = [
    raw.notifyMinmaePrice1,
    raw.notifyMinmaePrice2,
    raw.notifyMinmaePrice3,
    raw.notifyMinmaePrice4,
  ];
  const rates = [raw.notifyMinmaePriceRate1, raw.notifyMinmaePriceRate2];
  const out: Array<{ 회차: number; 가격: number; 감정대비비율: number | null }> = [];
  prices.forEach((p, i) => {
    const price = Number(p) || 0;
    if (price <= 0) return;
    const rateRaw = i < 2 ? rates[i] : "";
    const rate = Number(rateRaw);
    out.push({
      회차: i + 1,
      가격: price,
      감정대비비율: Number.isFinite(rate) && rate > 0 ? rate : null,
    });
  });
  return out;
}

// ─── 헬퍼 ─────────────────────────────────────────────────

/** "2021타경4007" → { 사건년도: 2021, 사건번호: 4007 } */
function parseSrnSaNo(s: string): { 사건년도: number; 사건번호: number } {
  if (!s) return { 사건년도: 0, 사건번호: 0 };
  const m = s.match(/^(\d{4})\D+(\d+)$/);
  if (!m) return { 사건년도: 0, 사건번호: 0 };
  return { 사건년도: Number(m[1]), 사건번호: Number(m[2]) };
}

/** "20260511" + "1000" → "2026-05-11 10:00:00" */
function formatMaeGiil(ymd: string, hm: string): string {
  const ymdDash = formatYmdDash(ymd);
  if (!ymdDash) return "";
  const time = formatHm(hm) || "00:00";
  return `${ymdDash} ${time}:00`;
}

/** "20260511" → "2026-05-11" */
function formatYmdDash(ymd: string | null | undefined): string | null {
  if (!ymd || ymd.length !== 8) return null;
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

/** "1000" → "10:00" */
function formatHm(hm: string | null | undefined): string | null {
  if (!hm || hm.length < 4) return null;
  return `${hm.slice(0, 2)}:${hm.slice(2, 4)}`;
}

/** YYYYMMDD → 오늘과의 일수 차이 (KST 기준). */
function computeDaysLeftFromYmd(ymd: string): number {
  if (!ymd || ymd.length !== 8) return -9999;
  const iso = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T00:00:00+09:00`;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return -9999;
  const today = new Date();
  const todayKst = new Date(today.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  todayKst.setHours(0, 0, 0, 0);
  return Math.round((t - todayKst.getTime()) / (1000 * 60 * 60 * 24));
}

/** 진행 상태 추정 — 응답에 직접 한글 없어서 휴리스틱. */
function inferProgressStatus(ymd: string, yuchal: number, mulJin: string): string {
  if (mulJin !== "Y") return "종결";
  if (yuchal === 0) return "신건";
  // 이전 매각기일이 미래면 "진행", 과거+유찰수>0 이면 "유찰"
  const dleft = computeDaysLeftFromYmd(ymd);
  if (dleft >= 0) return "진행";
  return "유찰";
}

/** 매물 한글주소 + daepyoLotno + addrGbncd → "산566" / "1231-3" 형태 지번 */
function composeJibun(raw: CourtRawListItem): string | null {
  const lotno = (raw.daepyoLotno || raw.srchHjguLotno || "").trim();
  if (!lotno) return null;
  // addrGbncd 가 "S" 등 산 표시인지 — printSt 에 "산" 포함 여부로 보조 판정
  const isSan = /\s산\s*\d/.test(raw.printSt || "");
  return isSan && !lotno.startsWith("산") ? `산${lotno}` : lotno;
}

/**
 * Court 목록 raw row → "전라남도 여수시 화장동 252-1" 형태의 풀 지번주소.
 *
 * 의뢰자 결정 (2026-05-04): 본 서비스는 항상 지번주소 사용.
 * 도로명 row(R) 도 raw 에 시도/시군구/읍면동 + 지번 필드가 박혀있어 조립 가능.
 *
 * raw 의 hjguSido/hjguSigu/hjguDong/hjguRd 사용 (목록 응답).
 * 산 매물이면 daepyoLotno 가 이미 "산566" 형식이거나, printSt 의 산 표기로 보강.
 */
export function composeJibunAddrFromList(raw: CourtRawListItem): string {
  const sido = (raw.hjguSido || "").trim();
  const sigu = (raw.hjguSigu || "").trim();
  const dong = (raw.hjguDong || "").trim();
  const ri = (raw.hjguRd || "").trim();
  const lotno = composeJibun(raw) ?? (raw.daepyoLotno || "").trim();
  return [sido, sigu, dong, ri, lotno].filter(Boolean).join(" ");
}

/**
 * Court 상세 raw 의 dlt_dspslGdsDspslObjctLst row → "전라남도 여수시 화장동 252-1" 형태.
 *
 * 상세 응답은 한글주소 필드명이 adongSdNm/adongSggNm/adongEmdNm/adongRiNm 으로 다름.
 * 도로명(R) row 도 이 필드들이 박혀있어 같은 방식으로 조립.
 *
 * 건물명(bldNm) 있으면 끝에 보조 표시 — 영업 시각에서 "어느 동인지" 단서.
 */
export function composeJibunAddrFromDetailGoods(g: {
  adongSdNm?: string | null;
  adongSggNm?: string | null;
  adongEmdNm?: string | null;
  adongRiNm?: string | null;
  rprsLtnoAddr?: string | null;
  bldNm?: string | null;
}): string {
  const parts = [
    g.adongSdNm,
    g.adongSggNm,
    g.adongEmdNm,
    g.adongRiNm,
    g.rprsLtnoAddr,
  ]
    .map((s) => (s ? s.trim() : ""))
    .filter(Boolean);
  const base = parts.join(" ");
  return g.bldNm ? `${base} ${g.bldNm}` : base;
}

/** "순천지원" → "순천", "서울동부지방법원" → "서울동부", "광주지방법원" → "광주" */
function shortenCourtName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .replace(/지방법원$/, "")
    .replace(/지원$/, "")
    .trim();
}

/** "철근콘크리트구조 15.93㎡" 또는 "4109㎡" → { land/building }. */
function parseAreaMeter(s: string | null | undefined): {
  land: number | null;
  building: number | null;
} {
  if (!s) return { land: null, building: null };
  const m = s.match(/([\d,.]+)\s*㎡/);
  const num = m ? Number(m[1].replace(/,/g, "")) : null;
  if (num == null || !Number.isFinite(num)) return { land: null, building: null };
  // 구조 키워드 있으면 건물 면적, 없으면 토지 면적으로 간주
  const isBuilding = /구조|콘크리트|블록조|벽돌조|목조|철골|철근|아파트/.test(s);
  return isBuilding
    ? { land: null, building: num }
    : { land: num, building: null };
}

/**
 * docid → 32-bit int 해시.
 * AuctionListItem.경매번호 가 number 타입이라 정수 PK 필요.
 * docid 는 22~24자 string 이라 정수 변환 필요.
 *
 * 동일 docid 는 동일 정수 (deterministic).
 * hyphen 의 경매번호 (Hyphen 내부 PK) 와는 절대 충돌 안 함 (다른 채널, swap 시 재계산).
 */
function hashDocidToInt(docid: string): number {
  // FNV-1a 32bit
  let h = 0x811c9dc5;
  for (let i = 0; i < docid.length; i++) {
    h ^= docid.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0; // unsigned
}
