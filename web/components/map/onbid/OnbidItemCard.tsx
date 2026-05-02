"use client";

/**
 * 공매 매물 단일 row 카드 — 캠코 응답 단일 row 의 정확한 정보만 표시.
 *
 * 회차 추정/할인율/"최저입찰가" 는 어느 회차 row 인지 알 수 없어 거짓 위험 → 표시 X.
 * 회차/현재가/할인율은 카드 클릭 후 상세 팝업(OnbidTab)에서 동단위 호출로 정확히 분석.
 *
 * 사용처:
 *   - OnbidVillageModal: 마을 매물 목록
 *   - OnbidTab fallback: 같은 마을 매물 목록 (KEPCO LocationDetailGrouped 패턴 미러)
 */

import type { OnbidListItem } from "@/lib/onbid/types";
import { OUR_CATEGORY_LABEL } from "@/lib/onbid/types";
import { jibunFromPnu } from "@/lib/geo/pnu";

export default function OnbidItemCard({
  item,
  onClick,
}: {
  item: OnbidListItem;
  onClick: () => void;
}) {
  const jibun = jibunFromPnu(item.ltnoPnu) ?? "—";

  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full text-left bg-white border border-gray-200 hover:border-rose-300 hover:bg-rose-50/30 rounded-lg transition-colors"
    >
      <div className="flex items-stretch">
        {/* 좌측 — 지번 컬럼 */}
        <div className="flex-shrink-0 w-20 md:w-24 flex flex-col items-center justify-center px-2 py-3 border-r border-gray-100 bg-gray-50/60 rounded-l-lg">
          <span className="text-[10px] text-gray-400 mb-0.5">지번</span>
          <span className="inline-flex items-center gap-1 text-rose-600 font-semibold text-sm">
            <span className="text-[10px]">📍</span>
            <span className="tabular-nums">{jibun}</span>
          </span>
        </div>

        {/* 우측 — 매물 상세 */}
        <div className="flex-1 min-w-0 p-3">
          {/* 1줄: 카테고리 배지 + 재산유형 + 유찰 */}
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            {item.ourCategory && (
              <span className="text-[11px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded">
                {OUR_CATEGORY_LABEL[item.ourCategory]}
              </span>
            )}
            <span className="text-[11px] text-gray-500">{item.cltrUsgSclsCtgrNm}</span>
            <span className="text-[11px] text-gray-300">·</span>
            <span className="text-[11px] text-gray-500">{item.prptDivNm}</span>
            {item.usbdNft != null && item.usbdNft > 0 && (
              <span className="ml-auto text-[11px] text-amber-700 font-semibold">
                유찰 {item.usbdNft}회
              </span>
            )}
          </div>

          {/* 2줄: 매물명 */}
          <div className="text-sm text-gray-900 mb-1.5 font-semibold leading-tight truncate">
            {item.onbidCltrNm}
          </div>

          {/* 3줄: 감정가 */}
          <div className="flex items-baseline gap-1.5 mb-1">
            <span className="text-[11px] text-gray-500">감정가</span>
            <span className="text-base font-bold text-gray-900 tabular-nums leading-none">
              {formatPrice(item.apslEvlAmt)}
            </span>
          </div>

          {/* 4줄: 면적 */}
          {(item.landSqms != null || (item.bldSqms != null && item.bldSqms > 0)) && (
            <div className="text-[11px] text-gray-600">
              {item.landSqms != null && item.landSqms > 0 && (
                <span>토지 {item.landSqms.toLocaleString()}㎡</span>
              )}
              {item.landSqms != null && item.bldSqms != null && item.bldSqms > 0 && (
                <span className="text-gray-300"> · </span>
              )}
              {item.bldSqms != null && item.bldSqms > 0 && (
                <span>건물 {item.bldSqms.toLocaleString()}㎡</span>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function formatPrice(won: number): string {
  if (won >= 100_000_000) {
    const eok = won / 100_000_000;
    return eok >= 10 ? `${Math.round(eok).toLocaleString()}억` : `${eok.toFixed(1)}억`;
  }
  if (won >= 10_000) return `${Math.round(won / 10_000).toLocaleString()}만`;
  return `${won.toLocaleString()}원`;
}
