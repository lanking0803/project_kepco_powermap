"use client";

/**
 * 법원경매 (court) 채널 전용 카테고리 셀렉터.
 *
 * 사용자가 court 분류 코드를 직접 다중 선택 → 부모(AuctionSearchPanel)에
 * `sclCodes: string[]` 로 흘림. 부모가 검색 시 sclCodesToTriples 로 변환.
 *
 * UI:
 *   - "전체" 칩 (다 끔)
 *   - 영업 6그룹 칩 (단축 — 그룹 멤버 모두 토글 ON↔OFF)
 *   - 그룹 우측 ▾ 클릭 시 소분류 칩 펼침 (개별 다중 선택)
 *
 * hyphen 패턴 미러 — 동일한 시각/조작감 유지 (의뢰자 익숙).
 */

import { useState } from "react";
import {
  COURT_CATEGORY_GROUPS,
  COURT_CATEGORY_GROUP_ORDER,
  COURT_GROUP_LABEL,
  COURT_SCL_BY_MCL,
  type CourtCategoryGroup,
} from "@/lib/court-auction/categories";

interface Props {
  /** 현재 선택된 court 소분류 코드 다중. 빈 배열 = 전체. */
  sclCodes: string[];
  /** 변경 콜백. */
  onChange: (next: string[]) => void;
}

export default function CourtCategorySelector({ sclCodes, onChange }: Props) {
  const [expandedGroup, setExpandedGroup] = useState<CourtCategoryGroup | null>(
    null,
  );

  const isAll = sclCodes.length === 0;

  const toggleGroup = (group: CourtCategoryGroup) => {
    const groupCodes = COURT_CATEGORY_GROUPS[group];
    const allOn = groupCodes.every((c) => sclCodes.includes(c));
    if (allOn) {
      // 다 켜짐 → 그룹 멤버 모두 끔
      onChange(sclCodes.filter((c) => !groupCodes.includes(c)));
    } else {
      // 일부/전무 → 그룹 멤버 모두 켬 (다른 그룹 선택은 보존)
      const others = sclCodes.filter((c) => !groupCodes.includes(c));
      onChange([...others, ...groupCodes]);
    }
  };

  const toggleScl = (sclCd: string) => {
    onChange(
      sclCodes.includes(sclCd)
        ? sclCodes.filter((c) => c !== sclCd)
        : [...sclCodes, sclCd],
    );
  };

  // 그룹 안 소분류 칩 데이터 — 선택된 그룹의 소분류만 펼침.
  // 그룹의 sclCodes 가 어느 mcl 에 속하는지 보고 그 mcl 의 전체 소분류 보여줌.
  // 단, 그룹 정의에 박힌 코드만 칩으로 노출 (관리 단순화).
  const expandedSclList = (() => {
    if (!expandedGroup) return [];
    const groupCodes = COURT_CATEGORY_GROUPS[expandedGroup];
    // 코드 prefix 로 mcl 추론, 그 mcl 의 전체 소분류 중 그룹 멤버만 노출
    const out: Array<{ code: string; name: string }> = [];
    for (const code of groupCodes) {
      const mcl = `${code.slice(0, 3)}00`;
      const list = COURT_SCL_BY_MCL[mcl];
      if (!list) continue;
      const f = list.find((x) => x.code === code);
      if (f) out.push(f);
    }
    return out;
  })();

  return (
    <div className="space-y-1.5">
      {/* "전체" 칩 */}
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => onChange([])}
          className={`text-[11px] px-3 py-1 leading-none rounded-full border font-semibold transition-colors ${
            isAll
              ? "bg-amber-50 text-amber-700 border-amber-300"
              : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
          }`}
        >
          {isAll ? "✓ " : ""}
          전체
        </button>
      </div>

      {/* 영업 6그룹 칩 (단축) */}
      <div className="flex flex-wrap gap-1">
        {COURT_CATEGORY_GROUP_ORDER.map((group) => {
          const groupCodes = COURT_CATEGORY_GROUPS[group];
          const selectedCount = groupCodes.filter((c) =>
            sclCodes.includes(c),
          ).length;
          const allOn = selectedCount === groupCodes.length;
          const partialOn = selectedCount > 0 && selectedCount < groupCodes.length;
          const isExpanded = expandedGroup === group;

          const containerClass = allOn
            ? "border-amber-300 bg-amber-50 text-amber-700"
            : partialOn
              ? "border-amber-200 bg-amber-50/60 text-amber-700"
              : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50";

          return (
            <div
              key={group}
              className={`inline-flex items-center rounded-full border transition-colors ${containerClass}`}
            >
              <button
                type="button"
                onClick={() => toggleGroup(group)}
                title={COURT_GROUP_LABEL[group].sub}
                className="text-[11px] pl-2.5 pr-1 py-1 leading-none font-semibold rounded-l-full"
              >
                {allOn ? "✓ " : partialOn ? "◐ " : ""}
                {COURT_GROUP_LABEL[group].label}
                {partialOn && (
                  <span className="text-[9px] ml-0.5 tabular-nums opacity-80">
                    ({selectedCount}/{groupCodes.length})
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setExpandedGroup(isExpanded ? null : group)}
                title={isExpanded ? "접기" : "개별 선택"}
                className={`text-[10px] pr-2 pl-0.5 py-1 leading-none rounded-r-full transition-colors ${
                  isExpanded
                    ? "text-amber-700"
                    : "text-gray-400 hover:text-amber-700"
                }`}
              >
                {isExpanded ? "▴" : "▾"}
              </button>
            </div>
          );
        })}
      </div>

      {/* 그룹 펼침 — 개별 소분류 칩 */}
      {expandedGroup && (
        <div className="p-2 bg-amber-50/40 border border-amber-200 rounded space-y-1">
          <div className="text-[10px] text-amber-700 font-semibold">
            {COURT_GROUP_LABEL[expandedGroup].label} —{" "}
            {COURT_GROUP_LABEL[expandedGroup].sub}
          </div>
          <div className="flex flex-wrap gap-1">
            {expandedSclList.map((s) => {
              const checked = sclCodes.includes(s.code);
              return (
                <button
                  key={s.code}
                  type="button"
                  onClick={() => toggleScl(s.code)}
                  className={`text-[10px] px-2.5 py-0.5 leading-none rounded-full border transition-colors ${
                    checked
                      ? "bg-amber-600 text-white border-amber-700 font-semibold"
                      : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {checked ? "✓ " : ""}
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
