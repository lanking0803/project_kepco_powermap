"use client";

/**
 * 필지 마을 요약 카드 — 보라 마을 마커 클릭 시 우측 표시.
 *
 * OnbidVillageCard 의 직계 미러. 차이점:
 *   - 색상: rose → violet
 *   - 본문: 카테고리 분포 + 평수 통계 (D-day/할인율 없음)
 *   - 푸터 라벨: "시설 N건 보기"
 */

import type { FacilityVillageGroup } from "@/lib/facility/group";
import {
  FACILITY_CATEGORIES,
  FACILITY_CATEGORY_ORDER,
  type FacilityCategory,
} from "@/lib/facility/classify";
import AddrLine from "../AddrLine";

interface Props {
  group: FacilityVillageGroup;
  onShowDetail: () => void;
  onClose: () => void;
}

export default function FacilityVillageCard({
  group,
  onShowDetail,
  onClose,
}: Props) {
  const total = group.items.length;
  const locationParts = [group.sd, group.sgg, group.emd].filter(Boolean);
  const avgPyeong = total > 0 ? Math.round(group.totalPyeong / total) : 0;

  return (
    <div className="absolute left-4 right-4 bottom-4 md:left-auto md:right-4 md:bottom-4 md:w-[380px] max-w-[calc(100%-32px)] bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden z-10 flex flex-col max-h-[calc(100dvh-80px)] kepco-slide-up">
      {/* 헤더 */}
      <div className="px-3 py-2.5 md:px-4 md:py-3 border-b bg-violet-50 flex items-center justify-between gap-2 flex-shrink-0">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-xs md:text-sm text-gray-900 truncate">
            <AddrLine parts={locationParts} />
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5">
            시설 {total.toLocaleString()}건
            {group.maxPyeong > 0 && (
              <span className="text-violet-700 font-semibold ml-1.5">
                · 최대 {Math.round(group.maxPyeong).toLocaleString()}평
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onShowDetail}
          className="flex-shrink-0 md:hidden bg-violet-600 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg"
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

      {/* 본문 — 데스크톱 */}
      <div className="hidden md:block overflow-y-auto flex-1 px-4 py-4 space-y-3">
        <CategoryDistribution group={group} total={total} />
        {avgPyeong > 0 && (
          <Stat label="평균 평수" value={`${avgPyeong.toLocaleString()}평`} />
        )}
        {group.maxPyeong > 0 && (
          <Stat
            label="최대 평수"
            value={`${Math.round(group.maxPyeong).toLocaleString()}평`}
            highlight
          />
        )}
      </div>

      {/* 모바일 — 카테고리 칩 */}
      <div className="md:hidden px-3 py-2 text-[11px] text-gray-700">
        {FACILITY_CATEGORY_ORDER.filter(
          (k) => (group.categoryCount[k] ?? 0) > 0,
        ).map((k) => (
          <span
            key={k}
            className="inline-block mr-2 mb-1 bg-violet-50 text-violet-700 px-2 py-0.5 rounded"
          >
            {FACILITY_CATEGORIES[k].label} {group.categoryCount[k]}
          </span>
        ))}
      </div>

      {/* 푸터 */}
      <div className="hidden md:block px-4 py-3 border-t bg-violet-50 flex-shrink-0">
        <button
          onClick={onShowDetail}
          className="w-full bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium py-2 rounded-md transition-colors flex items-center justify-center gap-1.5"
        >
          시설 {total.toLocaleString()}건 보기
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

function CategoryDistribution({
  group,
  total,
}: {
  group: FacilityVillageGroup;
  total: number;
}) {
  const entries = FACILITY_CATEGORY_ORDER.map(
    (k) => [k, group.categoryCount[k] ?? 0] as [FacilityCategory, number],
  )
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
                {FACILITY_CATEGORIES[k].label}
              </span>
              <div className="flex-1 h-2 bg-gray-100 rounded overflow-hidden">
                <div
                  className="h-full bg-violet-600"
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
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-gray-500 w-20 shrink-0">{label}</span>
      <span
        className={`text-sm font-bold tabular-nums ${
          highlight ? "text-violet-700" : "text-gray-900"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
