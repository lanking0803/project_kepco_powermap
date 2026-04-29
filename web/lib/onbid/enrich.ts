/**
 * 캠코 raw 응답 → OnbidListItem (UI 직접 사용 형태) 변환.
 *
 * 추가 필드:
 *   - ourCategory: 카테고리 분류 (categories.ts)
 *   - lat/lng: bjd_master JOIN (PNU 앞 10자리)
 *   - lowstBidPrc: 문자열 → 숫자
 *   - discountRatio: (감정가 - 최저입찰가) / 감정가
 *   - daysLeft: 입찰종료일 - 오늘 (KST)
 *   - isUrgent: D-3 이내
 *
 * 좌표 JOIN:
 *   - bjd_master 일괄 조회 (서버 1회 호출, 클라이언트에 결과 전달).
 *   - bjd_code 누락이거나 좌표 없는 동은 lat/lng = null (UI 마커에서 자동 제외).
 */

import type { OnbidListItem, OurCategory } from "./types";
import { classifyOurCategory } from "./categories";
import type { OnbidRawListItem } from "./client";
import { createAdminClient } from "@/lib/supabase/admin";

/** raw 응답 + bjd_master 좌표 → OnbidListItem 1건 변환 */
export function enrichRawItem(
  raw: OnbidRawListItem,
  coord: { lat: number | null; lng: number | null },
): OnbidListItem {
  const apslEvlAmt = Number(raw.apslEvlAmt) || 0;
  const lowstBidPrc = parseLowstBidPrc(raw.lowstBidPrcIndctCont);
  const discountRatio =
    apslEvlAmt > 0 ? Math.max(0, 1 - lowstBidPrc / apslEvlAmt) : 0;

  const daysLeft = computeDaysLeft(raw.cltrBidEndDt);
  const isUrgent = daysLeft >= 0 && daysLeft <= 3;

  const ourCategory: OurCategory | null = classifyOurCategory(
    raw.cltrUsgSclsCtgrId,
    raw.onbidCltrNm,
    raw.bldSqms,
  );

  return {
    cltrMngNo: raw.cltrMngNo,
    pbctCdtnNo: raw.pbctCdtnNo,
    onbidCltrno: raw.onbidCltrno,
    onbidPbancNo: raw.onbidPbancNo,
    pbctNo: raw.pbctNo,
    onbidCltrNm: raw.onbidCltrNm,
    ltnoPnu: raw.ltnoPnu,
    rdnmPnu: raw.rdnmPnu,
    lctnSdnm: raw.lctnSdnm,
    lctnSggnm: raw.lctnSggnm,
    lctnEmdNm: raw.lctnEmdNm,
    cltrUsgLclsCtgrId: raw.cltrUsgLclsCtgrId,
    cltrUsgMclsCtgrId: raw.cltrUsgMclsCtgrId,
    cltrUsgSclsCtgrId: raw.cltrUsgSclsCtgrId,
    cltrUsgSclsCtgrNm: raw.cltrUsgSclsCtgrNm,
    prptDivCd: raw.prptDivCd,
    prptDivNm: raw.prptDivNm,
    apslEvlAmt,
    lowstBidPrcIndctCont: raw.lowstBidPrcIndctCont,
    cltrBidBgngDt: raw.cltrBidBgngDt,
    cltrBidEndDt: raw.cltrBidEndDt,
    landSqms: raw.landSqms ?? null,
    bldSqms: raw.bldSqms ?? null,
    usbdNft: raw.usbdNft ?? null,
    ourCategory,
    lat: coord.lat,
    lng: coord.lng,
    lowstBidPrc,
    discountRatio,
    daysLeft,
    isUrgent,
  };
}

/**
 * raw 응답 배열 → OnbidListItem 배열.
 * bjd_master 좌표를 한 번에 조회 (PNU 앞 10자리 unique → IN 절).
 */
export async function enrichRawItems(
  rawItems: OnbidRawListItem[],
): Promise<OnbidListItem[]> {
  if (rawItems.length === 0) return [];

  // 고유 bjd_code 수집
  const bjdCodes = new Set<string>();
  for (const it of rawItems) {
    const pnu = (it.ltnoPnu ?? "").trim();
    if (/^\d{19}$/.test(pnu)) bjdCodes.add(pnu.slice(0, 10));
  }

  // bjd_master 일괄 조회 — 좌표 맵
  const coordMap = new Map<string, { lat: number | null; lng: number | null }>();
  if (bjdCodes.size > 0) {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("bjd_master")
      .select("bjd_code, lat, lng")
      .in("bjd_code", Array.from(bjdCodes));
    if (error) {
      console.error("[onbid/enrich] bjd_master 조회 실패", error);
    } else {
      for (const row of data ?? []) {
        coordMap.set(row.bjd_code, {
          lat: row.lat ?? null,
          lng: row.lng ?? null,
        });
      }
    }
  }

  return rawItems.map((raw) => {
    const pnu = (raw.ltnoPnu ?? "").trim();
    const bjd = /^\d{19}$/.test(pnu) ? pnu.slice(0, 10) : "";
    const coord = coordMap.get(bjd) ?? { lat: null, lng: null };
    return enrichRawItem(raw, coord);
  });
}

/** "284,000" / "비공개" → 284000 / 0 */
function parseLowstBidPrc(s: string | null | undefined): number {
  if (!s) return 0;
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return 0;
  return parseInt(digits, 10);
}

/** "202604301700" → 종료까지 남은 일수 (KST 자정 기준). 음수면 마감. */
function computeDaysLeft(yyyymmddhhmm: string | null | undefined): number {
  if (!yyyymmddhhmm || yyyymmddhhmm.length < 8) return -9999;
  const y = parseInt(yyyymmddhhmm.slice(0, 4), 10);
  const m = parseInt(yyyymmddhhmm.slice(4, 6), 10);
  const d = parseInt(yyyymmddhhmm.slice(6, 8), 10);
  if (!y || !m || !d) return -9999;
  const end = Date.UTC(y, m - 1, d); // 종료 자정 KST 약간 단순화 (차이는 1일 이내)
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((end - today) / (24 * 3600 * 1000));
}
