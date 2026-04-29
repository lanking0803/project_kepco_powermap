"use client";

/**
 * 공매 모드 검색 콘텐츠 (Sidebar 안에 inline 으로 들어감).
 *
 * 외곽 컨테이너/헤더는 부모 Sidebar 가 제공 (= 같은 모양 + 색만 다름).
 * 검색 입력 + 결과 카드 리스트만 담당.
 *
 * 백엔드 연결 시: MOCK_ITEMS 자리에 fetchOnbidSearch(params) 호출만 교체.
 */

import { useMemo, useState } from "react";
import {
  OUR_CATEGORY_LABEL,
  type OnbidListItem,
  type OnbidSearchParams,
  type OurCategory,
} from "@/lib/onbid/types";
import { MOCK_ITEMS } from "@/lib/onbid/mock";

interface Props {
  /** 검색 결과 변경 시 호출 — 지도 마커 갱신용 */
  onResults?: (items: OnbidListItem[]) => void;
  /** 매물 카드 클릭 시 호출 — 지도 강조 + ParcelInfoPanel (UI-6) */
  onItemClick?: (item: OnbidListItem) => void;
}

const EMPTY_PARAMS: OnbidSearchParams = {
  sido: "",
  sigungu: "",
  emdong: "",
  categories: [],
  landMin: null,
  landMax: null,
  apslMin: null,
  apslMax: null,
  bidStart: null,
  bidEnd: null,
  usbdMin: null,
  usbdMax: null,
  pageNo: 1,
  numOfRows: 200,
};

const MOCK_SIDOS = Array.from(
  new Set(MOCK_ITEMS.map((i) => i.lctnSdnm)),
).sort();

const ALL_CATEGORIES: OurCategory[] = [
  "토지",
  "유리온실",
  "축사",
  "창고",
  "건물50plus",
];

export default function OnbidSearchPanel({ onResults, onItemClick }: Props) {
  const [params, setParams] = useState<OnbidSearchParams>(EMPTY_PARAMS);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [results, setResults] = useState<OnbidListItem[]>(() => MOCK_ITEMS);

  /** 백엔드 연결 시 이 함수만 fetchOnbidSearch(params) 로 교체 */
  const runSearch = () => {
    const filtered = MOCK_ITEMS.filter((it) => {
      if (params.sido && it.lctnSdnm !== params.sido) return false;
      if (params.sigungu && !it.lctnSggnm.includes(params.sigungu))
        return false;
      if (params.emdong && !it.lctnEmdNm.includes(params.emdong)) return false;
      if (params.categories.length > 0) {
        if (!it.ourCategory) return false;
        if (!params.categories.includes(it.ourCategory)) return false;
      }
      if (params.landMin != null && (it.landSqms ?? 0) < params.landMin)
        return false;
      if (params.landMax != null && (it.landSqms ?? Infinity) > params.landMax)
        return false;
      if (params.apslMin != null && it.apslEvlAmt < params.apslMin * 10000)
        return false;
      if (params.apslMax != null && it.apslEvlAmt > params.apslMax * 10000)
        return false;
      if (params.usbdMin != null && (it.usbdNft ?? 0) < params.usbdMin)
        return false;
      if (params.usbdMax != null && (it.usbdNft ?? Infinity) > params.usbdMax)
        return false;
      return true;
    });
    setResults(filtered);
    onResults?.(filtered);
  };

  const reset = () => {
    setParams(EMPTY_PARAMS);
    setResults(MOCK_ITEMS);
    onResults?.(MOCK_ITEMS);
  };

  const toggleCategory = (cat: OurCategory) => {
    setParams((p) => ({
      ...p,
      categories: p.categories.includes(cat)
        ? p.categories.filter((c) => c !== cat)
        : [...p.categories, cat],
    }));
  };

  const totalCount = useMemo(() => results.length, [results]);

  return (
    <div className="flex flex-col h-full">
      {/* 검색 입력 */}
      <div className="p-3 space-y-3 overflow-y-auto flex-shrink-0 border-b border-gray-100">
        {/* 지역 */}
        <Section title="지역">
          <div className="space-y-1.5">
            <Field label="시도">
              <select
                value={params.sido}
                onChange={(e) =>
                  setParams((p) => ({ ...p, sido: e.target.value }))
                }
                className="w-full text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 focus:border-rose-500 focus:outline-none"
              >
                <option value="">전체</option>
                {MOCK_SIDOS.map((sd) => (
                  <option key={sd} value={sd}>
                    {sd}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="시군구">
              <input
                type="text"
                placeholder="예: 나주시"
                value={params.sigungu}
                onChange={(e) =>
                  setParams((p) => ({ ...p, sigungu: e.target.value }))
                }
                className="w-full text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 focus:border-rose-500 focus:outline-none"
              />
            </Field>
            <Field label="읍면동">
              <input
                type="text"
                placeholder="예: 동강면 (선택)"
                value={params.emdong}
                onChange={(e) =>
                  setParams((p) => ({ ...p, emdong: e.target.value }))
                }
                className="w-full text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 focus:border-rose-500 focus:outline-none"
              />
            </Field>
          </div>
        </Section>

        {/* 카테고리 */}
        <Section title="카테고리">
          <div className="flex flex-wrap gap-1">
            {ALL_CATEGORIES.map((cat) => {
              const checked = params.categories.includes(cat);
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleCategory(cat)}
                  className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                    checked
                      ? "bg-rose-50 text-rose-700 border-rose-300 font-semibold"
                      : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {checked ? "✓ " : ""}
                  {OUR_CATEGORY_LABEL[cat]}
                </button>
              );
            })}
          </div>
        </Section>

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="w-full text-[11px] py-1 text-gray-500 hover:text-rose-700 border border-dashed border-gray-300 hover:border-rose-300 rounded"
        >
          {showAdvanced ? "▴ 고급 필터 접기" : "▾ 고급 필터 (면적·감정가·입찰일·유찰)"}
        </button>

        {showAdvanced && (
          <div className="space-y-2.5 px-1">
            <RangeField
              label="토지면적 (㎡)"
              minVal={params.landMin}
              maxVal={params.landMax}
              onChange={(min, max) =>
                setParams((p) => ({ ...p, landMin: min, landMax: max }))
              }
            />
            <RangeField
              label="감정가 (만원)"
              minVal={params.apslMin}
              maxVal={params.apslMax}
              onChange={(min, max) =>
                setParams((p) => ({ ...p, apslMin: min, apslMax: max }))
              }
            />
            <Field label="입찰 시작 ~ 종료">
              <div className="flex items-center gap-1">
                <input
                  type="date"
                  value={params.bidStart ?? ""}
                  onChange={(e) =>
                    setParams((p) => ({
                      ...p,
                      bidStart: e.target.value || null,
                    }))
                  }
                  className="flex-1 text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 focus:border-rose-500 focus:outline-none"
                />
                <span className="text-xs text-gray-400">~</span>
                <input
                  type="date"
                  value={params.bidEnd ?? ""}
                  onChange={(e) =>
                    setParams((p) => ({
                      ...p,
                      bidEnd: e.target.value || null,
                    }))
                  }
                  className="flex-1 text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 focus:border-rose-500 focus:outline-none"
                />
              </div>
            </Field>
            <RangeField
              label="유찰 횟수"
              minVal={params.usbdMin}
              maxVal={params.usbdMax}
              onChange={(min, max) =>
                setParams((p) => ({ ...p, usbdMin: min, usbdMax: max }))
              }
            />
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={runSearch}
            className="flex-1 text-xs font-bold py-2 bg-rose-600 hover:bg-rose-700 text-white rounded shadow-sm"
          >
            🔍 검색
          </button>
          <button
            type="button"
            onClick={reset}
            className="text-xs py-2 px-3 bg-white text-gray-600 border border-gray-300 hover:bg-gray-50 rounded"
          >
            초기화
          </button>
        </div>
      </div>

      {/* 결과 — 사이드바 내부 스크롤 영역 */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-3 py-1.5 text-[11px] font-semibold text-gray-700 flex items-center justify-between border-b border-gray-200 bg-gray-50">
          <span>결과</span>
          <span className="tabular-nums">{totalCount.toLocaleString()}건</span>
        </div>
        <div className="overflow-y-auto flex-1">
          {results.length === 0 ? (
            <div className="p-4 text-center text-xs text-gray-400">
              검색 결과 없음
            </div>
          ) : (
            results.map((it) => (
              <ResultCard
                key={it.cltrMngNo}
                item={it}
                onClick={() => onItemClick?.(it)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────
// 보조 컴포넌트
// ───────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] font-bold text-gray-700 mb-1">{title}</div>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-gray-500 w-14 shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function RangeField({
  label,
  minVal,
  maxVal,
  onChange,
}: {
  label: string;
  minVal: number | null;
  maxVal: number | null;
  onChange: (min: number | null, max: number | null) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-1">
        <input
          type="number"
          placeholder="최소"
          value={minVal ?? ""}
          onChange={(e) =>
            onChange(e.target.value === "" ? null : Number(e.target.value), maxVal)
          }
          className="w-full min-w-0 text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 tabular-nums focus:border-rose-500 focus:outline-none"
        />
        <span className="text-xs text-gray-400">~</span>
        <input
          type="number"
          placeholder="최대"
          value={maxVal ?? ""}
          onChange={(e) =>
            onChange(minVal, e.target.value === "" ? null : Number(e.target.value))
          }
          className="w-full min-w-0 text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 tabular-nums focus:border-rose-500 focus:outline-none"
        />
      </div>
    </Field>
  );
}

function ResultCard({
  item,
  onClick,
}: {
  item: OnbidListItem;
  onClick: () => void;
}) {
  const apslMan = Math.round(item.apslEvlAmt / 10000);
  const lowstMan = Math.round(item.lowstBidPrc / 10000);
  const discountPct = Math.round(item.discountRatio * 100);
  const jibun = jibunFromPnu(item.ltnoPnu);
  return (
    <div
      className={`w-full px-3 py-2 border-b border-gray-200 transition-colors ${
        item.isUrgent ? "bg-rose-50/60" : "bg-white"
      } hover:bg-rose-50`}
    >
      <div className="flex items-stretch gap-2">
        {/* 좌측 본문 — 카드 클릭으로 ParcelInfoPanel 매물 PNU 흐름 */}
        <button
          type="button"
          onClick={onClick}
          className="flex-1 min-w-0 text-left active:opacity-70"
        >
          <div className="flex items-center gap-1.5 mb-0.5">
            {item.isUrgent ? (
              <span className="text-[9px] px-1 py-px bg-rose-600 text-white rounded font-bold animate-pulse">
                D-{item.daysLeft}
              </span>
            ) : item.daysLeft >= 0 ? (
              <span className="text-[9px] px-1 py-px bg-gray-100 text-gray-600 rounded">
                D-{item.daysLeft}
              </span>
            ) : (
              <span className="text-[9px] px-1 py-px bg-gray-300 text-gray-700 rounded">
                마감
              </span>
            )}
            {item.ourCategory && (
              <span className="text-[9px] px-1 py-px bg-blue-50 text-blue-700 rounded">
                {OUR_CATEGORY_LABEL[item.ourCategory]}
              </span>
            )}
            <span className="text-[9px] text-gray-400 ml-auto">
              {item.lctnSdnm} {item.lctnSggnm}
            </span>
          </div>
          <div className="text-[11px] text-gray-900 font-semibold leading-tight mb-1 truncate">
            {item.onbidCltrNm}
          </div>
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-gray-400 line-through tabular-nums">
              {apslMan.toLocaleString()}만
            </span>
            <span className="text-rose-700 font-bold tabular-nums">
              → {lowstMan.toLocaleString()}만
            </span>
            <span className="text-emerald-600 font-semibold">
              {discountPct}% ↓
            </span>
            {item.usbdNft != null && item.usbdNft > 0 && (
              <span className="text-gray-500 ml-auto">유찰 {item.usbdNft}회</span>
            )}
          </div>
        </button>

        {/* 우측 — 📍 지번 핀 (전기 SearchResultList 패턴 미러) */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          className="flex-shrink-0 inline-flex items-center gap-0.5 self-center px-2 py-1 rounded text-rose-600 font-semibold hover:bg-rose-100 active:bg-rose-200 transition-colors text-xs"
          title="지도에서 이 지번 위치 보기"
        >
          <span className="text-[10px]">📍</span>
          <span className="tabular-nums">{jibun}</span>
        </button>
      </div>
    </div>
  );
}

/**
 * PNU 19자리 → 지번 텍스트.
 * 산구분: 11번째 글자 1=일반, 2=산. 부번 0이면 본번만.
 */
function jibunFromPnu(pnu: string): string {
  if (!/^\d{19}$/.test(pnu)) return "—";
  const isSan = pnu.charAt(10) === "2";
  const bonbun = parseInt(pnu.slice(11, 15), 10);
  const bubun = parseInt(pnu.slice(15, 19), 10);
  const text = bubun > 0 ? `${bonbun}-${bubun}` : `${bonbun}`;
  return isSan ? `산${text}` : text;
}
