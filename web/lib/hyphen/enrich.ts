/**
 * Hyphen 진행물건검색 raw 응답 → AuctionListItem (UI 직접 사용 형태) 변환.
 *
 * 추가 필드 (캠코 enrich.ts 미러):
 *   - 사건명칭: "YYYY타경NNN" 조합
 *   - pnuStandard: 행안부 표준 PNU 19자리 (응답 텍스트 파싱 + bjd_master 역조회)
 *   - lat/lng: bjd_master 좌표
 *   - discountRatio: (감정가 - 최저가) / 감정가
 *   - daysLeft: 매각기일 - 오늘
 *   - isUrgent: D-3 이내
 *
 * 좌표/PNU 매핑 핵심:
 *   - Hyphen 의 dong 필터는 "면" 단위라 응답에 다른 리(里)도 섞여 옴.
 *   - 매물 1건마다 한글주소에서 sep_4(면)/sep_5(리) 추출 → bjd_master 역조회 → bjd_code 확정.
 *   - 그 bjd_code 로 PNU 조립 + 좌표 enrich.
 */

import { buildPnuFromBjdAndJibun } from "@/lib/geo/pnu";
import { createAdminClient } from "@/lib/supabase/admin";

import { cleanAuctionAddress, extractFirstJibun, extractSep45 } from "./pnu-fix";
import type { AuctionListItem, AuctionRawListItem } from "./types";

/**
 * raw 응답 1건 + 좌표/bjd_code 보강 + 사건명칭 조합 → AuctionListItem.
 */
function enrichOne(
  raw: AuctionRawListItem,
  bjdCode: string | null,
  coord: { lat: number | null; lng: number | null },
): AuctionListItem {
  const apslEvlAmt = Number(raw.감정가) || 0;
  const lowstBidPrc = Number(raw.최저가) || 0;
  const discountRatio =
    apslEvlAmt > 0 ? Math.max(0, 1 - lowstBidPrc / apslEvlAmt) : 0;

  const daysLeft = computeDaysLeftFromIso(raw.매각기일);
  const isUrgent = daysLeft >= 0 && daysLeft <= 3;

  // 사건명칭 = "2023타경51302" — 한국 법원 표준 표기
  const 사건명칭 = `${raw.사건년도}타경${raw.사건번호}`;

  // PNU 조립 — bjd_code 가 확정된 경우만
  let pnuStandard: string | null = null;
  const jibunText = extractFirstJibun(raw.리스트지번주소 || raw.대표소재지);
  if (bjdCode && jibunText) {
    pnuStandard = buildPnuFromBjdAndJibun(bjdCode, jibunText);
  }

  return {
    경매번호: raw.경매번호,
    사건번호코드: raw.사건번호코드,
    법원코드: raw.법원코드,
    사건년도: raw.사건년도,
    사건번호: raw.사건번호,
    물건번호: raw.물건번호,
    매각기일: raw.매각기일,
    감정가: apslEvlAmt,
    최저가: lowstBidPrc,
    물건용도코드: raw.물건용도코드,
    진행상태코드: raw.진행상태코드,
    진행상태: raw.진행상태,
    건물면적: raw.건물면적 ?? null,
    토지면적: raw.토지면적 ?? null,
    유찰수: raw.유찰수,
    도로명주소여부: raw.도로명주소여부,
    대표소재지: cleanAuctionAddress(raw.대표소재지),
    담당계: raw.담당계,
    법원간략명: raw.법원간략명,
    리스트지번주소: cleanAuctionAddress(raw.리스트지번주소),
    토지가격비율: raw.토지가격비율,
    경매다용도: raw.경매다용도 ?? null,
    법원용도: raw.법원용도 ?? null,
    물건번호갯수: raw.물건번호갯수 ?? null,
    낙찰가: raw.낙찰가 ?? null,
    용도: raw.용도 ?? null,
    매각기일일자: raw.매각기일일자 ?? null,
    매각기일일시: raw.매각기일일시 ?? null,

    // 추가 필드
    사건명칭,
    pnuStandard,
    bjdCode,
    lat: coord.lat,
    lng: coord.lng,
    discountRatio,
    daysLeft,
    isUrgent,
    지번: jibunText ?? "",
  };
}

/**
 * raw 매물 배열 → AuctionListItem 배열.
 *
 * 1) 각 매물의 한글주소에서 sep_4/sep_5 추출
 * 2) 모든 (sep_1, sep_4, sep_5) 조합 unique → bjd_master 일괄 조회 (외부 호출 1번)
 * 3) 매물별 bjd_code + 좌표 매핑 후 enrichOne
 *
 * sep_1 은 입력 PNU 의 시도 코드 (sigungu 단위 호출 응답이라 모든 매물이 같은 시도).
 */
export async function enrichRawItems(
  rawItems: AuctionRawListItem[],
  contextSidoName: string | null = null,
): Promise<AuctionListItem[]> {
  if (rawItems.length === 0) return [];

  // 1) 매물별 sep_4/sep_5 추출
  const sepInfo = rawItems.map((raw) => {
    const addr = raw.리스트지번주소 || raw.대표소재지 || "";
    const { sep_4, sep_5 } = extractSep45(addr);
    return { raw, sep_4, sep_5 };
  });

  // 2) bjd_master 역조회 — sep_5(리) 가 있으면 (sep_4, sep_5) 조합 / 없으면 sep_4 단독
  // contextSidoName 이 주어지면 sep_1 까지 매칭해서 동명이리 충돌 방지.
  const lookupKeys = new Set<string>();
  for (const { sep_4, sep_5 } of sepInfo) {
    if (sep_4) {
      lookupKeys.add(`${sep_4}|${sep_5 ?? ""}`);
    }
  }

  const bjdMap = new Map<
    string,
    { bjd_code: string; lat: number | null; lng: number | null }
  >();

  if (lookupKeys.size > 0) {
    const supabase = createAdminClient();
    // sep_5 가 있는 키 / 없는 키 분리해서 조회 (Supabase or 조건이 까다로워 두 번 분리)
    const sep5Keys = Array.from(lookupKeys)
      .filter((k) => k.split("|")[1] !== "")
      .map((k) => k.split("|"));
    const sep4OnlyKeys = Array.from(lookupKeys)
      .filter((k) => k.split("|")[1] === "")
      .map((k) => k.split("|")[0]);

    if (sep5Keys.length > 0) {
      // sep_5 단일 in 절 + sep_4 단일 in 절 (서버 측 소량 over-fetch 후 클라이언트 매칭).
      const sep4s = Array.from(new Set(sep5Keys.map((p) => p[0])));
      const sep5s = Array.from(new Set(sep5Keys.map((p) => p[1])));
      let query = supabase
        .from("bjd_master")
        .select("bjd_code, sep_1, sep_4, sep_5, lat, lng")
        .in("sep_4", sep4s)
        .in("sep_5", sep5s);
      if (contextSidoName) {
        query = query.eq("sep_1", contextSidoName);
      }
      const { data, error } = await query;
      if (error) {
        console.error("[hyphen/enrich] bjd_master sep_4/sep_5 조회 실패", error);
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
      // sep_5 가 없는 동(예: 동 단위 매물) — sep_4 단독 매칭. sep_5 가 null 인 row 만.
      let query = supabase
        .from("bjd_master")
        .select("bjd_code, sep_1, sep_4, sep_5, lat, lng")
        .in("sep_4", sep4OnlyKeys)
        .is("sep_5", null);
      if (contextSidoName) {
        query = query.eq("sep_1", contextSidoName);
      }
      const { data, error } = await query;
      if (error) {
        console.error("[hyphen/enrich] bjd_master sep_4 only 조회 실패", error);
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

  // 3) 매물별 enrich
  return sepInfo.map(({ raw, sep_4, sep_5 }) => {
    const key = sep_4 ? `${sep_4}|${sep_5 ?? ""}` : "";
    const bjd = bjdMap.get(key);
    return enrichOne(
      raw,
      bjd?.bjd_code ?? null,
      { lat: bjd?.lat ?? null, lng: bjd?.lng ?? null },
    );
  });
}

// ─── 헬퍼 ─────────────────────────────────────────────────

/** "2026-02-03 10:00:00" → 오늘과의 일수 차이. */
function computeDaysLeftFromIso(iso: string | null | undefined): number {
  if (!iso) return -9999;
  // "2026-02-03 10:00:00" 또는 "2026-02-03"
  const datePart = iso.slice(0, 10);
  const t = Date.parse(`${datePart}T00:00:00+09:00`);
  if (!Number.isFinite(t)) return -9999;
  const today = new Date();
  // KST 오늘 0시
  const todayKst = new Date(today.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  todayKst.setHours(0, 0, 0, 0);
  const diffMs = t - todayKst.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}
