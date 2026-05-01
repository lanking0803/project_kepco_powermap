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

import type {
  AppraisalRecord,
  OnbidDetail,
  OnbidListItem,
  OurCategory,
} from "./types";
import { classifyOurCategory } from "./categories";
import type { OnbidRawDetailItem, OnbidRawListItem } from "./client";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * dedup 시 같은 매물(cltrMngNo)의 다른 회차들에서 추출한 정보.
 * enrichRawItems 가 그룹화 직후 계산해서 enrichRawItem 에 넘김.
 *
 * 회차 모델 (실측 검증 2026-05-02):
 *   - 캠코는 같은 매물(cltrMngNo)을 회차별로 N row 응답
 *   - 유찰된 회차는 응답에서 빠짐 (이미 끝난 회차)
 *   - 응답 row 갯수 = "남은 회차 수" (현재 진행 중 + 미래 예정)
 *   - 총 회차 = usbdNft (이미 유찰) + 응답 row 갯수 (남은)
 *   - 단, 시도 단위 검색은 numOfRows cap 때문에 같은 매물 row 가 누락될 수 있음
 *     → 이 정보는 동단위 검색(by-pnu)에서만 신뢰. 목록 검색 카드에는 표시 X.
 */
export interface RoundInfo {
  /** 응답 row 갯수 (= 남은 회차 수). 동단위 검색에서만 의미 있음. */
  remainingRounds: number;
  /** 최저 시나리오 가격 — 가장 먼 미래 회차 가격. row 1개면 null */
  minRoundPrice: number | null;
}

/** raw 응답 + bjd_master 좌표 + 회차 정보 → OnbidListItem 1건 변환 */
export function enrichRawItem(
  raw: OnbidRawListItem,
  coord: { lat: number | null; lng: number | null },
  round: RoundInfo,
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

  const minRoundDiscountRatio =
    round.minRoundPrice != null && apslEvlAmt > 0
      ? Math.max(0, 1 - round.minRoundPrice / apslEvlAmt)
      : null;

  // 회차 모델 (실측 2026-05-02):
  //   유찰된 회차는 응답에서 빠짐 → 응답 row 갯수 = 남은 회차 수.
  //   현재 회차 = usbdNft + 1 (이미 유찰된 횟수의 다음 차).
  //   총 회차 = usbdNft (지난 회차) + remainingRounds (남은 회차).
  const usbdNft = raw.usbdNft ?? 0;
  const roundCurrent = usbdNft + 1;
  const roundTotal = usbdNft + round.remainingRounds;

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
    roundTotal,
    roundCurrent,
    minRoundPrice: round.minRoundPrice,
    minRoundDiscountRatio,
  };
}

/**
 * raw 응답 배열 → OnbidListItem 배열.
 *
 * - 같은 cltrMngNo 의 row 들은 회차로 묶고, 첫 row(=캠코 응답 순서상 최신·최저가 회차)를 대표로 보존.
 * - 회차 정보(roundTotal, roundCurrent, minRoundPrice)를 enrich 에 함께 전달해서 카드에 노출.
 * - bjd_master 좌표를 한 번에 조회 (PNU 앞 10자리 unique → IN 절).
 */
export async function enrichRawItems(
  rawItems: OnbidRawListItem[],
): Promise<OnbidListItem[]> {
  if (rawItems.length === 0) return [];

  // 1) cltrMngNo 별 회차 그룹핑 — 응답 순서 보존
  //    캠코 응답 실측 (test-onbid-rounds*.ts 2026-05-01~02):
  //      같은 매물의 row 들이 시간 정렬되어 있지만 **순서가 매물마다 다르게 옴** (정순/역순 혼재).
  //      → 응답 순서에 의존하면 안 됨. cltrBidEndDt 로 직접 정렬해서 결정.
  //    대표 row = "가장 임박한 회차" (가장 작은 cltrBidEndDt) — D-day 와 가격이 일치해야 영업 신뢰.
  //    최저 시나리오 가격 = "가장 먼 미래 회차" (가장 큰 cltrBidEndDt) — 모든 회차 유찰 시 적용될 가격.
  const groups = new Map<string, OnbidRawListItem[]>();
  for (const it of rawItems) {
    const arr = groups.get(it.cltrMngNo);
    if (arr) arr.push(it);
    else groups.set(it.cltrMngNo, [it]);
  }

  // 2) 대표 row(가장 임박) + 최저 시나리오 가격(가장 먼 미래)
  const representatives: { raw: OnbidRawListItem; round: RoundInfo }[] = [];
  for (const arr of groups.values()) {
    // 시간 정순으로 정렬 (작은 cltrBidEndDt = 가장 임박)
    const sorted = [...arr].sort((a, b) =>
      (a.cltrBidEndDt ?? "").localeCompare(b.cltrBidEndDt ?? ""),
    );
    const head = sorted[0]; // 가장 임박 = 현재 진행 중인 회차
    const minPriceRaw = sorted.length > 1 ? sorted[sorted.length - 1] : null; // 가장 먼 미래 = 최저가 시나리오
    representatives.push({
      raw: head,
      round: {
        remainingRounds: sorted.length, // 남은 회차 수 (현재 + 미래 예정)
        minRoundPrice: minPriceRaw
          ? parseLowstBidPrc(minPriceRaw.lowstBidPrcIndctCont)
          : null,
      },
    });
  }

  // 3) 좌표 일괄 조회
  const bjdCodes = new Set<string>();
  for (const { raw } of representatives) {
    const pnu = (raw.ltnoPnu ?? "").trim();
    if (/^\d{19}$/.test(pnu)) bjdCodes.add(pnu.slice(0, 10));
  }

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

  return representatives.map(({ raw, round }) => {
    const pnu = (raw.ltnoPnu ?? "").trim();
    const bjd = /^\d{19}$/.test(pnu) ? pnu.slice(0, 10) : "";
    const coord = coordMap.get(bjd) ?? { lat: null, lng: null };
    return enrichRawItem(raw, coord, round);
  });
}

/**
 * raw 상세 응답 + listItem(이미 enrich된 OnbidListItem) → OnbidDetail.
 *
 * 사진/영상/감정평가 등 부가 필드 매핑.
 * urlList 류는 캠코가 응답 형태 일관성 안 지킴 — `{ item: [...] }` / 직접 배열 / null 모두 가능.
 */
export function enrichDetail(
  base: OnbidListItem,
  rawDetail: OnbidRawDetailItem,
): OnbidDetail {
  return {
    ...base,
    // 사진/멀티미디어
    // 사진 URL — 캠코는 기본 썸네일(7KB) 을 응답.
    //   - photoUrls: downloadImageKind=THNL_NM 제거 → 원본(1.1MB) — 갤러리 메인/라이트박스용
    //   - photoThumbUrls: 캠코 응답 그대로 → 썸네일(7KB) — 갤러리 12x12 칸용 (페이지 부담 ↓)
    photoUrls: extractUrlList(rawDetail.potoUrlList).map(toFullsize),
    photoThumbUrls: extractUrlList(rawDetail.potoUrlList),
    photo360Urls: extractUrlList(rawDetail.poto360DgrUrlList),
    videoUrls: extractUrlList(rawDetail.vdoUrlAdrList),
    locationMapUrls: extractPipeList(rawDetail.lmapUrlAdrList),
    // 주소/물건 부가
    cltrRadr: trimOrNull(rawDetail.cltrRadr),
    cltrEtcCont: trimOrNull(rawDetail.cltrEtcCont),
    frstPbancYmd: trimOrNull(rawDetail.frstPbancYmd),
    // 입찰 조건 / 매수 자격 / 납부 사항
    icdlCdtnCont: trimOrNull(rawDetail.icdlCdtnCont),
    locVntyPscdCont: trimOrNull(rawDetail.locVntyPscdCont),
    utlzPscdCont: trimOrNull(rawDetail.utlzPscdCont),
    dsplVldCont: trimOrNull(rawDetail.dsplVldCont),
    purrQlfcCont: trimOrNull(rawDetail.purrQlfcCont),
    pytnMtrsCont: trimOrNull(rawDetail.pytnMtrsCont),
    evcRsbyTrgtCont: trimOrNull(rawDetail.evcRsbyTrgtCont),
    // 감정평가 이력
    appraisals: extractAppraisals(rawDetail.apslEvlClgList),
  };
}

/** 캠코 urlList 류 응답 → URL 문자열 배열. 다양한 형태 모두 처리. */
function extractUrlList(
  list:
    | { item?: { urlAdr?: string } | { urlAdr?: string }[] }
    | { urlAdr?: string }[]
    | string
    | null
    | undefined,
): string[] {
  if (!list || typeof list === "string") return [];
  // 직접 배열
  if (Array.isArray(list)) {
    return list.map((x) => (x?.urlAdr ?? "").trim()).filter(Boolean);
  }
  // { item: [...] } 또는 { item: 객체 1개 }
  const inner = list.item;
  if (!inner) return [];
  if (Array.isArray(inner)) {
    return inner.map((x) => (x?.urlAdr ?? "").trim()).filter(Boolean);
  }
  return [(inner.urlAdr ?? "").trim()].filter(Boolean);
}

/**
 * 캠코 사진 URL 의 downloadImageKind=THNL_NM 파라미터 제거 = 원본 사진 응답.
 * 실측 (2026-04-30, 도동 246-7):
 *   - downloadImageKind=THNL_NM → 7 KB 썸네일 (영업 판단 어려움)
 *   - 파라미터 제거 → 1.1 MB 원본 (158배 큼, 화질 또렷)
 * 같은 atchFileLstNo 면 응답 동일하므로 단순 파라미터 제거로 충분.
 */
function toFullsize(url: string): string {
  return url.replace(/[?&]downloadImageKind=THNL_NM\b/g, "");
}

/** "url1|url2|url3" 같은 파이프 구분 문자열 → 배열 */
function extractPipeList(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean);
}

function extractAppraisals(
  list:
    | { item?: unknown }
    | unknown[]
    | string
    | null
    | undefined,
): AppraisalRecord[] {
  if (!list || typeof list === "string") return [];
  let arr: unknown[] = [];
  if (Array.isArray(list)) arr = list;
  else if ("item" in list && list.item) {
    arr = Array.isArray(list.item) ? list.item : [list.item];
  }
  return arr
    .map((raw) => {
      const r = raw as {
        apslEvlYmd?: string;
        apslEvlOrgNm?: string;
        apslApprNm?: string | null;
        apslEvlAmt?: number;
        urlAdr?: string;
      };
      return {
        date: (r.apslEvlYmd ?? "").trim(),
        org: (r.apslEvlOrgNm ?? "").trim(),
        appraiser: r.apslApprNm ?? null,
        amount: Number(r.apslEvlAmt) || 0,
        pdfUrl: (r.urlAdr ?? "").trim(),
      };
    })
    .filter((a) => a.date || a.org || a.amount > 0);
}

function trimOrNull(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  return t || null;
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
