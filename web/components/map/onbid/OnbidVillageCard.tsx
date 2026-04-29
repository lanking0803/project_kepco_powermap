"use client";

/**
 * 공매 마을 요약 카드 — 빨간 마을 마커 클릭 시 우측 표시.
 *
 * 전기 LocationSummaryCard 와 시각/레이아웃 일관성:
 *   - 같은 wrapper className (kepco-slide-up, 우측 고정 위치, 동일 padding)
 *   - 같은 헤더 (AddrLine + 닫기 ×)
 *   - 같은 푸터 (전체 너비 버튼)
 * 차이:
 *   - 색상: blue → rose 계열
 *   - 본문: 시설별 막대 → 카테고리 분포 + 임박/할인율
 *   - 푸터 라벨: "상세 목록 보기" → "매물 N건 보기"
 */

import type { OnbidVillageGroup } from "@/lib/onbid/group";
import { OUR_CATEGORY_LABEL } from "@/lib/onbid/types";
import AddrLine from "../AddrLine";

interface Props {
  group: OnbidVillageGroup;
  onShowDetail: () => void;
  onClose: () => void;
}

export default function OnbidVillageCard({ group, onShowDetail, onClose }: Props) {
  const total = group.items.length;
  const urgentCount = group.items.filter(
    (i) => i.isUrgent && i.daysLeft >= 0,
  ).length;
  const endedCount = group.items.filter((i) => i.daysLeft < 0).length;
  const avgDiscountPct = Math.round(group.avgDiscountRatio * 100);
  const locationParts = [group.sd, group.sgg, group.emd].filter(Boolean);

  return (
    <div className="absolute left-4 right-4 bottom-4 md:left-auto md:right-4 md:bottom-4 md:w-[380px] max-w-[calc(100%-32px)] bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden z-10 flex flex-col max-h-[calc(100dvh-80px)] kepco-slide-up">
      {/* 헤더 — LocationSummaryCard 와 동일 레이아웃, 색만 rose */}
      <div className="px-3 py-2.5 md:px-4 md:py-3 border-b bg-rose-50 flex items-center justify-between gap-2 flex-shrink-0">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-xs md:text-sm text-gray-900 truncate">
            <AddrLine parts={locationParts} />
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5">
            매물 {total.toLocaleString()}건
            {urgentCount > 0 && (
              <span className="text-rose-600 font-semibold ml-1.5">
                ⚠ 임박 {urgentCount}
              </span>
            )}
            {endedCount > 0 && (
              <span className="text-gray-400 ml-1.5">
                · 마감 {endedCount}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onShowDetail}
          className="flex-shrink-0 md:hidden bg-rose-500 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg"
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

      {/* 본문 — 데스크톱 (카테고리 분포 + 통계) */}
      <div className="hidden md:block overflow-y-auto flex-1 px-4 py-4 space-y-3">
        <CategoryDistribution group={group} total={total} />
        <Stat
          label="평균 할인율"
          value={`${avgDiscountPct}%`}
          subtle="(감정가 대비 최저입찰가)"
        />
        {group.minDaysLeft != null && (
          <Stat
            label="가장 임박"
            value={`D-${group.minDaysLeft}`}
            highlight={group.minDaysLeft <= 3}
          />
        )}
      </div>

      {/* 모바일 — 간략 카테고리 표시 */}
      <div className="md:hidden px-3 py-2 text-[11px] text-gray-700">
        {Object.entries(group.categoryCount).map(([k, v]) => (
          <span
            key={k}
            className="inline-block mr-2 mb-1 bg-rose-50 text-rose-700 px-2 py-0.5 rounded"
          >
            {OUR_CATEGORY_LABEL[k as keyof typeof OUR_CATEGORY_LABEL]} {v}
          </span>
        ))}
      </div>

      {/* 푸터 — 데스크톱 [매물 N건 보기] */}
      <div className="hidden md:block px-4 py-3 border-t bg-rose-50 flex-shrink-0">
        <button
          onClick={onShowDetail}
          className="w-full bg-rose-500 hover:bg-rose-600 text-white text-sm font-medium py-2 rounded-md transition-colors flex items-center justify-center gap-1.5"
        >
          매물 {total.toLocaleString()}건 보기
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────
// 카테고리 분포 막대 — 전기 FacilityRatio 와 시각 패턴 미러
// ───────────────────────────────────────────

function CategoryDistribution({
  group,
  total,
}: {
  group: OnbidVillageGroup;
  total: number;
}) {
  const entries = (Object.entries(group.categoryCount) as [
    keyof typeof OUR_CATEGORY_LABEL,
    number,
  ][])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    return <div className="text-xs text-gray-500">카테고리 정보 없음</div>;
  }

  return (
    <div>
      <div className="text-[10px] font-bold text-gray-500 mb-1.5 tracking-wider uppercase">
        카테고리 분포
      </div>
      <div className="space-y-1.5">
        {entries.map(([k, v]) => {
          const pct = total > 0 ? Math.round((v / total) * 100) : 0;
          return (
            <div key={k} className="flex items-center gap-2">
              <span className="w-16 text-xs text-gray-700">
                {OUR_CATEGORY_LABEL[k]}
              </span>
              <div className="flex-1 h-2 bg-gray-100 rounded overflow-hidden">
                <div
                  className="h-full bg-rose-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-[11px] text-gray-700 tabular-nums w-10 text-right">
                {v}건
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  subtle,
  highlight,
}: {
  label: string;
  value: string;
  subtle?: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-gray-500 w-20 shrink-0">{label}</span>
      <span
        className={`text-sm font-bold tabular-nums ${
          highlight ? "text-rose-600" : "text-gray-900"
        }`}
      >
        {value}
      </span>
      {subtle && <span className="text-[10px] text-gray-400">{subtle}</span>}
    </div>
  );
}
