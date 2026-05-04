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
 * 1) bjd_master 일괄 조회 (sep_4=hjguDong, sep_5=hjguRd 매칭)
 * 2) 매물별 좌표/bjd_code 매핑 후 정규화
 *
 * @param rawItems Court 응답 매물
 * @param contextSidoName 시도 한글명 (예: "전라남도") — 동명이리 충돌 방지. null 이면 매칭 생략
 */
export async function courtToAuctionItems(
  rawItems: CourtRawListItem[],
  contextSidoName: string | null = null,
): Promise<AuctionListItem[]> {
  if (rawItems.length === 0) return [];

  // ── 1) bjd_master 역조회 ────────────────────────────
  // hjguDong (예: "돌산읍") + hjguRd (예: "금봉리")
  // 리가 빈값인 매물도 있음 → sep_5 IS NULL 매칭
  const lookupKeys = new Set<string>();
  for (const it of rawItems) {
    const sep4 = (it.hjguDong || "").trim();
    const sep5 = (it.hjguRd || "").trim();
    if (sep4) lookupKeys.add(`${sep4}|${sep5}`);
  }

  const bjdMap = new Map<
    string,
    { bjd_code: string; lat: number | null; lng: number | null }
  >();

  if (lookupKeys.size > 0) {
    const supabase = createAdminClient();

    const sep5Pairs = Array.from(lookupKeys)
      .filter((k) => k.split("|")[1] !== "")
      .map((k) => k.split("|"));
    const sep4OnlyKeys = Array.from(lookupKeys)
      .filter((k) => k.split("|")[1] === "")
      .map((k) => k.split("|")[0]);

    if (sep5Pairs.length > 0) {
      const sep4s = Array.from(new Set(sep5Pairs.map((p) => p[0])));
      const sep5s = Array.from(new Set(sep5Pairs.map((p) => p[1])));
      let query = supabase
        .from("bjd_master")
        .select("bjd_code, sep_1, sep_4, sep_5, lat, lng")
        .in("sep_4", sep4s)
        .in("sep_5", sep5s);
      if (contextSidoName) query = query.eq("sep_1", contextSidoName);
      const { data, error } = await query;
      if (error) {
        console.error("[court-auction/adapter] bjd_master sep_4/sep_5 조회 실패", error);
      } else {
        for (const row of data ?? []) {
          const k = `${row.sep_4}|${row.sep_5}`;
          if (!bjdMap.has(k)) {
            bjdMap.set(k, {
              bjd_code: row.bjd_code,
              lat: row.lat ?? null,
              lng: row.lng ?? null,
            });
          }
        }
      }
    }

    if (sep4OnlyKeys.length > 0) {
      let query = supabase
        .from("bjd_master")
        .select("bjd_code, sep_1, sep_4, sep_5, lat, lng")
        .in("sep_4", sep4OnlyKeys)
        .is("sep_5", null);
      if (contextSidoName) query = query.eq("sep_1", contextSidoName);
      const { data, error } = await query;
      if (error) {
        console.error("[court-auction/adapter] bjd_master sep_4 only 조회 실패", error);
      } else {
        for (const row of data ?? []) {
          const k = `${row.sep_4}|`;
          if (!bjdMap.has(k)) {
            bjdMap.set(k, {
              bjd_code: row.bjd_code,
              lat: row.lat ?? null,
              lng: row.lng ?? null,
            });
          }
        }
      }
    }
  }

  // ── 2) 매물별 정규화 ────────────────────────────────
  return rawItems.map((raw) => {
    const sep4 = (raw.hjguDong || "").trim();
    const sep5 = (raw.hjguRd || "").trim();
    const key = sep4 ? `${sep4}|${sep5}` : "";
    const bjd = bjdMap.get(key);
    return courtToAuctionItem(raw, bjd?.bjd_code ?? null, {
      lat: bjd?.lat ?? null,
      lng: bjd?.lng ?? null,
    });
  });
}

// ─── 단일 매물 어댑터 ─────────────────────────────────

/**
 * Court raw 매물 1건 + bjd 정보 → AuctionListItem.
 * bjd_master 조회는 호출자가 일괄 처리하고 결과를 주입.
 */
export function courtToAuctionItem(
  raw: CourtRawListItem,
  bjdCode: string | null,
  coord: { lat: number | null; lng: number | null },
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

  const 면적 = parseAreaMeter(raw.areaList);

  return {
    경매번호,
    사건번호코드,
    법원코드: raw.boCd ?? raw.cortOfcCd ?? "",
    사건년도,
    사건번호,
    물건번호: Number(raw.maemulSer) || 1,
    매각기일,
    감정가,
    최저가,
    물건용도코드: Number(raw.maemulUtilCd) || 0,
    진행상태코드: Number(raw.jinstatCd) || 0,
    진행상태,
    건물면적: 면적.building,
    토지면적: 면적.land,
    유찰수,
    도로명주소여부: raw.addrGbncd === "R" ? 1 : 0,
    대표소재지: cleanAddr(raw.printSt),
    담당계: raw.jpDeptNm ?? "",
    법원간략명: shortenCourtName(raw.jiwonNm),
    리스트지번주소: cleanAddr(raw.printSt),
    토지가격비율: 1, // Court 응답엔 토지/건물 분리 비율 없음. 기본값.
    경매다용도: null,
    법원용도: raw.dspslUsgNm ?? null,
    물건번호갯수: null,
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
  };
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

/** 한글주소 정리 (탭/줄바꿈 제거). */
function cleanAddr(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/[\r\n\t]+/g, " ").trim();
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
