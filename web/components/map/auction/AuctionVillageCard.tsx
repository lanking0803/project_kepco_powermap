"use client";

/**
 * 경매 마을 요약 카드 — 노랑 마을 마커 클릭 시 우측 표시.
 *
 * 공매 OnbidVillageCard 미러 + amber 톤 + 경매 특화 지표.
 *
 * 영업담당자 시각:
 *   - 평균 할인율 (저가 매입 발굴 핵심)
 *   - 신건 수 (새 매물 영업 매력)
 *   - D-3 임박 매물 수
 *   - 유찰 진행 매물 수
 *
 * 가격 합계는 표시 X — 한 사건의 여러 호수가 겹치면 합산이 의미 없어짐.
 */

import type { AuctionVillageGroup } from "@/lib/hyphen/group";
import AddrLine from "../AddrLine";

interface Props {
  group: AuctionVillageGroup;
  onShowDetail: () => void;
  onClose: () => void;
}

export default function AuctionVillageCard({
  group,
  onShowDetail,
  onClose,
}: Props) {
  const total = group.items.length;
  const usbdCount = group.items.filter((i) => i.유찰수 > 0).length;
  const urgentCount = group.items.filter(
    (i) => i.isUrgent && i.daysLeft >= 0,
  ).length;
  const newCount = group.newCount;
  const avgDiscountPct = Math.round(group.avgDiscountRatio * 100);

  // 위치 표기 — 동 이름이 있으면 그것만, 없으면 첫 매물의 대표소재지 앞부분
  const locationParts = group.emdName
    ? [group.emdName]
    : [group.items[0]?.대표소재지?.split(",")[0] ?? ""];

  return (
    <div className="absolute left-4 right-4 bottom-4 md:left-auto md:right-4 md:bottom-4 md:w-[380px] max-w-[calc(100%-32px)] bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden z-10 flex flex-col max-h-[calc(100dvh-80px)] kepco-slide-up">
      {/* 헤더 — amber 톤 */}
      <div className="px-3 py-2.5 md:px-4 md:py-3 border-b bg-amber-50 flex items-center justify-between gap-2 flex-shrink-0">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-xs md:text-sm text-gray-900 truncate">
            <AddrLine parts={locationParts} />
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span>매물 {total.toLocaleString()}건</span>
            {avgDiscountPct > 0 && (
              <>
                <span className="text-gray-300">·</span>
                <span className="text-rose-600 font-bold tabular-nums">
                  평균 -{avgDiscountPct}%
                </span>
              </>
            )}
          </div>
        </div>
        <button
          onClick={onShowDetail}
          className="flex-shrink-0 md:hidden bg-amber-600 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg"
        >
          상세 &rsaquo;
        </button>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-lg leading-none flex-shrink-0"
          aria-label="닫기"
        >
          ×
        </button>
      </div>

      {/* 본문 — 데스크톱 통계 */}
      <div className="hidden md:block overflow-y-auto flex-1 px-4 py-4 space-y-2.5">
        {avgDiscountPct > 0 && (
          <Stat
            label="평균 할인율"
            value={`-${avgDiscountPct}%`}
            valueCls="text-rose-600 font-bold tabular-nums"
            hint="감정가 대비 다음 회차 최저가 기준"
          />
        )}
        {newCount > 0 && (
          <Stat
            label="신건 (새 매물)"
            value={`${newCount}건`}
            valueCls="text-blue-600 font-semibold tabular-nums"
          />
        )}
        {urgentCount > 0 && (
          <Stat
            label="D-3 임박"
            value={`${urgentCount}건`}
            valueCls="text-rose-600 font-bold tabular-nums animate-pulse"
          />
        )}
        {usbdCount > 0 && (
          <Stat
            label="유찰 진행"
            value={`${usbdCount}건`}
            subtle={`(전체 ${total}건 중)`}
          />
        )}
      </div>

      {/* 모바일 — 간략 통계 1줄 */}
      <div className="md:hidden px-3 py-2 text-[11px] text-gray-700 flex flex-wrap gap-x-2 gap-y-0.5">
        {newCount > 0 && (
          <span>
            신건 <b className="text-blue-600">{newCount}</b>
          </span>
        )}
        {urgentCount > 0 && (
          <span>
            임박 <b className="text-rose-600">{urgentCount}</b>
          </span>
        )}
        {usbdCount > 0 && (
          <span>
            유찰 <b className="text-amber-700">{usbdCount}</b>
          </span>
        )}
      </div>

      {/* 푸터 — 전체 매물 보기 (데스크톱) */}
      <div className="hidden md:block px-4 py-3 border-t bg-gray-50 flex-shrink-0">
        <button
          type="button"
          onClick={onShowDetail}
          className="w-full bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold py-2 rounded-lg transition-colors"
        >
          매물 {total.toLocaleString()}건 자세히 보기
        </button>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────
// 보조
// ───────────────────────────────────────────────

function Stat({
  label,
  value,
  subtle,
  valueCls = "text-gray-900 font-semibold tabular-nums",
  hint,
}: {
  label: string;
  value: string;
  subtle?: string;
  valueCls?: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-gray-500">{label}</span>
        <span className="flex items-baseline gap-1">
          <span className={`text-sm ${valueCls}`}>{value}</span>
          {subtle && <span className="text-[10px] text-gray-400">{subtle}</span>}
        </span>
      </div>
      {hint && (
        <div className="text-[10px] text-gray-400 mt-0.5 leading-snug">
          {hint}
        </div>
      )}
    </div>
  );
}
