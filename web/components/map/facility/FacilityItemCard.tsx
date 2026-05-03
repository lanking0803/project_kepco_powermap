"use client";

/**
 * 시설 1건 카드 — FacilityVillageModal + (사이드바도 추후 통일 가능).
 *
 * 공매 OnbidItemCard / 경매 AuctionItemCard 패턴 미러:
 *   - <button> + flex items-stretch
 *   - 좌측 지번 컬럼 (회색 배경 박스 — 모달 안에서 줄 정렬 통일감)
 *   - 우측 본문 (카테고리/평수/주소/구조)
 *
 * 색상: violet (필지 모드 톤).
 *
 * 클릭 = 부모(MapClient) 가 PNU 합성 → openParcelPanelByPnu.
 */

import type { FacilityListItem } from "@/lib/facility/enrich";
import { FACILITY_CATEGORIES } from "@/lib/facility/classify";

interface Props {
  /** 카드 위 표시할 # 번호 (모달은 1부터 순번). 0/undefined 면 숨김. */
  index?: number;
  item: FacilityListItem;
  onClick: (item: FacilityListItem) => void;
}

export default function FacilityItemCard({ index, item, onClick }: Props) {
  const { building: b, category, pyeong } = item;
  const catInfo = FACILITY_CATEGORIES[category];

  // 영업 핵심 — 구조/지붕/층수
  const buildSpecParts: string[] = [];
  if (b.strctCdNm) buildSpecParts.push(b.strctCdNm);
  if (b.roofCdNm) buildSpecParts.push(`${b.roofCdNm}지붕`);
  if (b.grndFlrCnt > 0) buildSpecParts.push(`${b.grndFlrCnt}층`);

  // 사용승인일 YYYYMMDD → "YYYY.MM"
  const useAprLabel =
    b.useAprDay && b.useAprDay.length >= 6
      ? `${b.useAprDay.slice(0, 4)}.${b.useAprDay.slice(4, 6)}`
      : null;

  const jibun = pickJibunFromPlatPlc(b.platPlc) ?? "—";

  return (
    <button
      type="button"
      onClick={() => onClick(item)}
      className="block w-full text-left bg-white border border-gray-200 hover:border-violet-300 hover:bg-violet-50/30 rounded-lg transition-colors"
    >
      <div className="flex items-stretch">
        {/* 좌측 — 지번 컬럼 (공매·경매 미러) */}
        <div className="flex-shrink-0 w-20 md:w-24 flex flex-col items-center justify-center px-2 py-3 border-r border-gray-100 bg-gray-50/60 rounded-l-lg">
          <span className="text-[10px] text-gray-400 mb-0.5">지번</span>
          <span className="inline-flex items-center gap-1 text-violet-700 font-semibold text-sm">
            <span className="text-[10px]">📍</span>
            <span className="tabular-nums">{jibun}</span>
          </span>
        </div>

        {/* 우측 — 시설 상세 */}
        <div className="flex-1 min-w-0 p-3">
          {/* 1줄: 카테고리 배지 + #번호 + 평수 (우측 정렬) */}
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-[11px] font-semibold text-violet-700 bg-violet-50 px-2 py-0.5 rounded">
              {catInfo.label}
            </span>
            {index ? (
              <span className="text-[11px] text-gray-400">#{index}</span>
            ) : null}
            {pyeong != null && (
              <span className="ml-auto text-sm font-bold text-violet-900 tabular-nums">
                {pyeong.toLocaleString()}평
              </span>
            )}
          </div>

          {/* 2줄: 건물명 (있을 때만) — 경매 "사건명칭" 위치 */}
          {b.bldNm && (
            <div className="text-sm font-bold text-gray-900 mb-1 truncate">
              {b.bldNm}
            </div>
          )}

          {/* 3줄: 지번주소 — 가독성 위해 가운데 위계로 */}
          {b.platPlc && (
            <div className="text-[12px] text-gray-700 truncate mb-0.5">
              {b.platPlc}
            </div>
          )}

          {/* 4줄: 도로명 (지번과 다를 때만) */}
          {b.newPlatPlc && b.newPlatPlc !== b.platPlc && (
            <div className="text-[10px] text-gray-500 truncate mb-0.5">
              🛣 {b.newPlatPlc}
            </div>
          )}

          {/* 5줄: 구조·지붕·층수 */}
          {buildSpecParts.length > 0 && (
            <div className="text-[11px] text-violet-700 truncate mb-0.5">
              🏗 {buildSpecParts.join(" · ")}
            </div>
          )}

          {/* 6줄: 용도세부 + 사용승인 */}
          <div className="flex flex-wrap items-baseline justify-between text-[10px] text-gray-500 tabular-nums gap-x-2 gap-y-0.5">
            <span className="break-keep truncate">
              {b.mainPurpsCdNm}
              {b.etcPurps && ` · ${b.etcPurps}`}
            </span>
            {useAprLabel && (
              <span className="flex-shrink-0">사용승인 {useAprLabel}</span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

/**
 * platPlc 한글 주소 끝에서 지번만 추출.
 *   "부산광역시 남구 용당동 49번지"  → "49"
 *   "전라남도 여수시 남면 연도리 산 359"  → "산359"
 */
export function pickJibunFromPlatPlc(platPlc: string | null): string | null {
  if (!platPlc) return null;
  const sanMatch = platPlc.match(/산\s*(\d+(?:-\d+)?)/);
  if (sanMatch) return `산${sanMatch[1]}`;
  const m =
    platPlc.match(/(\d+(?:-\d+)?)\s*번지?\s*$/) ??
    platPlc.match(/(\d+(?:-\d+)?)\s*$/);
  return m ? m[1] : null;
}
