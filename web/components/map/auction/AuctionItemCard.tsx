"use client";

/**
 * 경매 매물 카드 (목록용) — Hyphen 진행물건검색 응답 1건 표시.
 *
 * 영업담당자 관점 우선순위 (의뢰자 의도):
 *   1. 사건명칭 + 진행상태 — 어느 사건/지금 어디까지?
 *   2. 감정가 + 최저가 + 할인율 — 가격 임팩트
 *   3. 매각기일 + D-day — 영업 액션 타이밍
 *   4. 면적 + 유찰수 — 매물 규모 + 가격 하락 가능성
 *   5. 법원/담당계 — 입찰 등록 시 어디로 갈지
 *
 * 스타일: OnbidItemCard 베이스 + 경매=노랑(amber) 톤. 진행상태 색상 분기.
 *
 * 사용처:
 *   - AuctionTab matched 매물 / fallback villageItems / VillageModal
 */

import type { AuctionListItem } from "@/lib/hyphen/types";
import { jibunFromPnu } from "@/lib/geo/pnu";

export default function AuctionItemCard({
  item,
  onClick,
}: {
  item: AuctionListItem;
  onClick: () => void;
}) {
  const jibun = item.pnuStandard ? jibunFromPnu(item.pnuStandard) : null;
  const status = classifyStatus(item.진행상태);
  const dDay = formatDday(item.daysLeft);
  const discountPct = Math.round(item.discountRatio * 100);

  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full text-left bg-white border border-gray-200 hover:border-amber-300 hover:bg-amber-50/30 rounded-lg transition-colors"
    >
      <div className="flex items-stretch">
        {/* 좌측 — 지번 컬럼 */}
        <div className="flex-shrink-0 w-20 md:w-24 flex flex-col items-center justify-center px-2 py-3 border-r border-gray-100 bg-gray-50/60 rounded-l-lg">
          <span className="text-[10px] text-gray-400 mb-0.5">지번</span>
          <span className="inline-flex items-center gap-1 text-amber-700 font-semibold text-sm">
            <span className="text-[10px]">📍</span>
            <span className="tabular-nums">{jibun ?? "—"}</span>
          </span>
        </div>

        {/* 우측 — 매물 상세 */}
        <div className="flex-1 min-w-0 p-3">
          {/* 1줄: 진행상태 배지 + D-day + 용도 */}
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span
              className={`text-[11px] font-semibold px-2 py-0.5 rounded ${status.colorClass}`}
            >
              {item.진행상태 || "—"}
            </span>
            {dDay && (
              <span
                className={`text-[11px] font-semibold ${
                  item.isUrgent ? "text-red-600" : "text-gray-600"
                }`}
              >
                {dDay}
              </span>
            )}
            {item.용도 && (
              <span className="text-[11px] text-gray-500">{item.용도}</span>
            )}
            {item.유찰수 > 0 && (
              <span className="ml-auto text-[11px] text-amber-700 font-semibold">
                유찰 {item.유찰수}회
              </span>
            )}
          </div>

          {/* 2줄: 사건명칭 + 법원/담당계 */}
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className="text-sm font-bold text-gray-900 tabular-nums">
              {item.사건명칭}
            </span>
            <span className="text-[11px] text-gray-500 truncate">
              {item.법원간략명}
              {item.담당계 ? ` ${item.담당계}` : ""}
            </span>
          </div>

          {/* 3줄: 가격 (감정가 / 최저가 / 할인율) */}
          <div className="flex items-baseline gap-2 mb-1">
            <div className="flex flex-col">
              <span className="text-[10px] text-gray-400">감정가</span>
              <span className="text-[12px] text-gray-500 tabular-nums">
                {formatWon(item.감정가)}
              </span>
            </div>
            <div className="text-gray-300">→</div>
            <div className="flex flex-col">
              <span className="text-[10px] text-gray-400">최저가</span>
              <span className="text-base font-bold text-gray-900 tabular-nums leading-none">
                {formatWon(item.최저가)}
              </span>
            </div>
            {discountPct > 0 && (
              <span className="ml-auto text-xs font-bold text-red-600 tabular-nums">
                -{discountPct}%
              </span>
            )}
          </div>

          {/* 4줄: 면적 */}
          {(hasArea(item.토지면적) || hasArea(item.건물면적)) && (
            <div className="text-[11px] text-gray-600">
              {hasArea(item.토지면적) && (
                <span>토지 {item.토지면적!.toLocaleString()}㎡</span>
              )}
              {hasArea(item.토지면적) && hasArea(item.건물면적) && (
                <span className="text-gray-300"> · </span>
              )}
              {hasArea(item.건물면적) && (
                <span>건물 {item.건물면적!.toLocaleString()}㎡</span>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

// ─── 헬퍼 ─────────────────────────────────────────────────

function hasArea(v: number | null): boolean {
  return typeof v === "number" && v > 0;
}

function formatWon(won: number): string {
  if (won >= 100_000_000) {
    const eok = won / 100_000_000;
    return eok >= 10
      ? `${Math.round(eok).toLocaleString()}억`
      : `${eok.toFixed(1)}억`;
  }
  if (won >= 10_000) return `${Math.round(won / 10_000).toLocaleString()}만`;
  return `${won.toLocaleString()}원`;
}

function formatDday(days: number): string | null {
  if (!Number.isFinite(days) || days <= -9000) return null;
  if (days > 0) return `D-${days}`;
  if (days === 0) return "D-DAY";
  return `D+${Math.abs(days)}`;
}

/** 진행상태 → 배지 색상.
 *  진행/유찰 = 영업 가능 (노랑/주황) / 매각/낙찰 = 종결 (회색) / 취하/기각/변경 = 무산 (회색). */
function classifyStatus(s: string): { colorClass: string } {
  if (!s) return { colorClass: "text-gray-600 bg-gray-100" };
  if (s.includes("진행") || s.includes("신건"))
    return { colorClass: "text-amber-700 bg-amber-50" };
  if (s.includes("유찰"))
    return { colorClass: "text-orange-700 bg-orange-50" };
  if (s.includes("매각") || s.includes("낙찰"))
    return { colorClass: "text-gray-600 bg-gray-100" };
  if (s.includes("취하") || s.includes("기각") || s.includes("변경") || s.includes("정지"))
    return { colorClass: "text-gray-500 bg-gray-100" };
  return { colorClass: "text-gray-700 bg-gray-100" };
}
