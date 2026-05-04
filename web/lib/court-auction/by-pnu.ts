/**
 * 법원경매 by-pnu 서버 로직 — court 채널.
 *
 * 호출 정책 (의뢰자 결정 2026-05-04):
 *   1차: emdCd 좁힘 sweep (빠름, 보통 1페이지)
 *     → 매칭 ≥1건 발견 시 즉시 종료 (2차 호출 X)
 *   2차: emdCd 빼고 시군구 sweep — 매칭 0건일 때만 트리거
 *     → court 사이트의 emdCd 인덱스 누락 케이스 우회 (예: 강남구 역삼동 740-7)
 *
 * 95% 케이스는 1차로 끝남 → 평균 호출량 거의 증가 없음.
 *
 * 분기:
 *   - 1차 매칭 ≥1건 → 정상 (2차 호출 X)
 *   - 1차 매칭 0건 + 2차 매칭 ≥1건 → 정상 (court 인덱스 누락 우회)
 *   - 2차 매칭 0건 + 시군구 매물 ≥1건 → fallback (같은 동네 매물 표시)
 *   - 시군구 매물 0건 → village_empty
 */

import { courtToAuctionItems } from "./adapter";
import { fetchCourtSweep } from "./sweep";
import type { CourtApiStatus, CourtRawListItem } from "./types";

import { jibunFromPnu } from "@/lib/geo/pnu";
import type { AuctionListItem } from "@/lib/hyphen/types";

/** by-pnu 결과 — hyphen 의 AuctionByPnuResult 와 같은 형. */
export interface CourtByPnuResult {
  apiStatus: CourtApiStatus;
  errMsg: string;
  /** 입력 PNU 정확 매칭 매물 */
  items: AuctionListItem[];
  /** 정확 매칭 0건일 때 같은 읍면동/시군구 매물 (fallback UI 용) */
  villageItems: AuctionListItem[];
  /** 시군구 자체에 매물 0건 */
  villageEmpty: boolean;
  /** sweep cap 으로 잘렸으면 true */
  truncated: boolean;
  /** 입력 PNU 의 사람이 읽는 지번 (fallback UI 표시용) */
  targetJibun: string;
}

/** PNU 19자리 → 그 지번의 court 경매 매물 + fallback. */
export async function fetchAuctionByPnuCourt(
  pnu: string,
): Promise<CourtByPnuResult> {
  const sdCd = pnu.slice(0, 2);
  const sggCd = pnu.slice(2, 5);
  const emdCd = pnu.slice(5, 8);
  const targetJibun = jibunFromPnu(pnu) ?? "";

  // 매각기일 6개월 윈도 — court 가 이 조건 없으면 진행 중 매물을 응답에서 빠뜨리는 결함 회피.
  // 영업 의도와도 일치 (종결 매물은 가치 0).
  const { bidBgngYmd, bidEndYmd } = build6MonthBidWindow();

  // ── 1차: emdCd 좁힘 호출 ─────────────────────────────
  const sweep1 = await fetchCourtSweep(
    { sdCd, sggCd, emdCd, pageSize: 50, bidBgngYmd, bidEndYmd },
    [],
  );

  if (sweep1.apiStatus === "blocked" || sweep1.apiStatus === "unavailable") {
    return errorResult(sweep1.apiStatus, sweep1.errMsg, targetJibun);
  }

  // 1차 매칭 시도 — targetPnu 주입 (그룹 안에서 클릭 지번 row 를 대표로 선정)
  if (sweep1.items.length > 0) {
    const items1 = await courtToAuctionItems(sweep1.items, { targetPnu: pnu });
    const matched1 = items1.filter((it) => it.pnuStandard === pnu);
    if (matched1.length > 0) {
      // ✅ 1차 매칭 성공 — 2차 호출 X, 즉시 종료
      return {
        apiStatus: "ok",
        errMsg: "",
        items: matched1,
        villageItems: [],
        villageEmpty: false,
        truncated: sweep1.truncated,
        targetJibun,
      };
    }
  }

  // ── 2차: emdCd 빼고 시군구 sweep — 1차 매칭 0건일 때만 ──
  // court 사이트 emdCd 인덱스 누락/지연 회피용 보강.
  const sweep2 = await fetchCourtSweep(
    { sdCd, sggCd, pageSize: 50, bidBgngYmd, bidEndYmd },
    [],
  );

  if (sweep2.apiStatus === "blocked" || sweep2.apiStatus === "unavailable") {
    return errorResult(sweep2.apiStatus, sweep2.errMsg, targetJibun);
  }

  if (sweep2.items.length === 0) {
    // 시군구 자체 매물 0건
    return {
      apiStatus: "ok",
      errMsg: "",
      items: [],
      villageItems: [],
      villageEmpty: true,
      truncated: false,
      targetJibun,
    };
  }

  // 2차 매물에 1차 응답 합쳐서 docid dedup (같은 매물 중복 방지)
  const merged = mergeByDocid(sweep1.items, sweep2.items);
  const items2 = await courtToAuctionItems(merged, { targetPnu: pnu });
  const matched2 = items2.filter((it) => it.pnuStandard === pnu);

  if (matched2.length > 0) {
    // ✅ 2차에서 매칭 성공 (court 인덱스 누락 케이스 우회)
    return {
      apiStatus: "ok",
      errMsg: "",
      items: matched2,
      villageItems: [],
      villageEmpty: false,
      truncated: sweep2.truncated,
      targetJibun,
    };
  }

  // 매칭 0건 — 같은 시군구 매물로 fallback
  return {
    apiStatus: "ok",
    errMsg: "",
    items: [],
    villageItems: items2,
    villageEmpty: false,
    truncated: sweep2.truncated,
    targetJibun,
  };
}

function errorResult(
  apiStatus: CourtApiStatus,
  errMsg: string | undefined,
  targetJibun: string,
): CourtByPnuResult {
  return {
    apiStatus,
    errMsg: errMsg ?? "",
    items: [],
    villageItems: [],
    villageEmpty: false,
    truncated: false,
    targetJibun,
  };
}

/** docid 기준 dedup 후 union. 1차 응답이 우선. */
function mergeByDocid(
  a: CourtRawListItem[],
  b: CourtRawListItem[],
): CourtRawListItem[] {
  const seen = new Set<string>();
  const out: CourtRawListItem[] = [];
  for (const it of [...a, ...b]) {
    if (!it.docid || seen.has(it.docid)) continue;
    seen.add(it.docid);
    out.push(it);
  }
  return out;
}

/**
 * 매각기일 윈도 — 오늘 ~ 오늘+6개월 (KST).
 * court 사이트가 이 조건 없으면 종결 매물 위주로 응답 → 진행 중 매물 누락.
 */
function build6MonthBidWindow(): { bidBgngYmd: string; bidEndYmd: string } {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }),
  );
  const start = ymd(now);
  const end = new Date(now);
  end.setMonth(end.getMonth() + 6);
  return { bidBgngYmd: start, bidEndYmd: ymd(end) };
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}
