"use client";

/**
 * 공매 모드 검색 콘텐츠 (Sidebar 안에 inline 으로 들어감).
 *
 * 외곽 컨테이너/헤더는 부모 Sidebar 가 제공 (= 같은 모양 + 색만 다름).
 * 검색 입력 + 결과 카드 리스트만 담당.
 *
 * 데이터: /api/onbid/search 호출 (캠코 OnbidRlstListSrvc2 + bjd_master JOIN).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  OUR_CATEGORY_LABEL,
  type OnbidListItem,
  type OnbidSearchParams,
  type OurCategory,
} from "@/lib/onbid/types";
import { jibunFromPnu } from "@/lib/geo/pnu";
import {
  loadModeState,
  saveModeState,
  clearModeState,
} from "@/lib/modes/storage";
import {
  ONBID_EMPTY_PARAMS,
  type OnbidPersistedState,
} from "@/lib/modes/modes/onbid";
import { fetchSigungus, type SigunguEntry } from "@/lib/api/regions";

/** 모드 ID — registry 에 등록된 안정 키. sessionStorage 키는 storage 헬퍼가 자동 처리. */
const MODE_ID = "onbid";

interface Props {
  /** 검색 결과 변경 시 호출 — 지도 마커 갱신용 */
  onResults?: (items: OnbidListItem[]) => void;
  /** 매물 카드 클릭 시 호출 — 지도 강조 + ParcelInfoPanel (UI-6) */
  onItemClick?: (item: OnbidListItem) => void;
}

/** 표시 한도 — 이 값 이상은 받지 않음 (캠코는 99,999 까지 가능하나 UX/렌더 부담) */
const MAX_RESULT_LIMIT = 1000;

const ALL_CATEGORIES: OurCategory[] = [
  "토지",
  "유리온실",
  "축사",
  "창고",
  "건물50plus",
];

export default function OnbidSearchPanel({ onResults, onItemClick }: Props) {
  // 모드 영속화 헬퍼로 마운트 시 1회 복원. 모드 전환 OFF→ON 사이클에서 검색 상태 유지.
  const persistedRef = useRef<OnbidPersistedState | null>(null);
  if (persistedRef.current === null && typeof window !== "undefined") {
    persistedRef.current = loadModeState<OnbidPersistedState>(MODE_ID);
  }
  const persisted = persistedRef.current;

  const [params, setParams] = useState<OnbidSearchParams>(
    persisted?.params ?? ONBID_EMPTY_PARAMS,
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [results, setResults] = useState<OnbidListItem[]>(
    persisted?.results ?? [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCountAll, setTotalCountAll] = useState<number | null>(
    persisted?.totalCountAll ?? null,
  );

  // 마운트 시 — 복원된 결과를 부모(MapClient)로 올려서 지도 마커도 즉시 복원
  const onResultsRef = useRef(onResults);
  onResultsRef.current = onResults;
  useEffect(() => {
    if (persisted && persisted.results.length > 0) {
      onResultsRef.current?.(persisted.results);
    }
    // 마운트 1회만 — persisted 는 ref 라서 deps 변경 X
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 시군구 마스터 — 모든 모드 공통 atomic. 모듈 캐시 hit 시 외부 호출 0.
  const [allSigungus, setAllSigungus] = useState<SigunguEntry[]>([]);
  const [regionsLoading, setRegionsLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    fetchSigungus()
      .then((items) => {
        if (alive) setAllSigungus(items);
      })
      .catch((e) => {
        console.error("[OnbidSearchPanel] 시군구 로드 실패", e);
      })
      .finally(() => {
        if (alive) setRegionsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  /** 시도 목록 — atomic 응답 unique. */
  const sidos = useMemo(() => {
    const set = new Set<string>();
    for (const r of allSigungus) set.add(r.sido);
    return [...set];
  }, [allSigungus]);

  /**
   * 선택 시도의 시군구 옵션 — label = 백엔드 통합 표기값(sep_2 + sep_3).
   * 캠코 lctnSggnm 검증(2026-05-03): 여수시/수원시(시 자체)/수원시 권선구(통합)
   * 모두 정상. "권선구" 단독은 0건이라 반드시 통합 표기.
   */
  const sigunguOptions = useMemo(() => {
    if (!params.sido) return [] as Array<{ label: string; value: string }>;
    return allSigungus
      .filter((r) => r.sido === params.sido && r.label !== "")
      .map((r) => ({ label: r.label, value: r.label }));
  }, [allSigungus, params.sido]);

  /** 시도 변경 또는 데이터 갱신 시 — 무효 시군구 자동 초기화.
   * sigunguOptions 가 비어있는 동안은 검증 보류 (atomic 미응답 시 복원값 보존). */
  useEffect(() => {
    if (!params.sigungu) return;
    if (sigunguOptions.length === 0) return;
    const stillValid = sigunguOptions.some((o) => o.value === params.sigungu);
    if (!stillValid) {
      setParams((p) => ({ ...p, sigungu: "" }));
    }
  }, [sigunguOptions, params.sigungu]);

  // params/results/totalCountAll 변경 시 sessionStorage 자동 저장
  useEffect(() => {
    saveModeState<OnbidPersistedState>(MODE_ID, {
      params,
      results,
      totalCountAll,
    });
  }, [params, results, totalCountAll]);

  /** /api/onbid/search 호출 — 캠코 실 데이터 */
  const runSearch = async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (params.sido) qs.set("sido", params.sido);
      if (params.sigungu) qs.set("sigungu", params.sigungu);
      if (params.emdong) qs.set("emdong", params.emdong);
      if (params.categories.length > 0)
        qs.set("categories", params.categories.join(","));
      if (params.landMin != null) qs.set("landMin", String(params.landMin));
      if (params.landMax != null) qs.set("landMax", String(params.landMax));
      // 감정가는 사용자가 만원 단위로 입력 → 원으로 변환
      if (params.apslMin != null)
        qs.set("apslMin", String(params.apslMin * 10000));
      if (params.apslMax != null)
        qs.set("apslMax", String(params.apslMax * 10000));
      if (params.bidStart) qs.set("bidStart", params.bidStart);
      if (params.bidEnd) qs.set("bidEnd", params.bidEnd);
      if (params.usbdMin != null) qs.set("usbdMin", String(params.usbdMin));
      if (params.usbdMax != null) qs.set("usbdMax", String(params.usbdMax));
      qs.set("numOfRows", String(params.numOfRows));
      qs.set("pageNo", String(params.pageNo));

      const res = await fetch(`/api/onbid/search?${qs.toString()}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      const items: OnbidListItem[] = json.items ?? [];
      setResults(items);
      setTotalCountAll(json.totalCount ?? null);
      onResults?.(items);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setResults([]);
      onResults?.([]);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setParams(ONBID_EMPTY_PARAMS);
    setResults([]);
    setError(null);
    setTotalCountAll(null);
    onResults?.([]);
    // 사용자가 명시적으로 "초기화" 누른 경우 — sessionStorage 도 비움
    clearModeState(MODE_ID);
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
    // 통째 스크롤 패턴 — 전기탭 미러 (2026-05-08).
    // 외곽 1개 스크롤. 검색조건/결과 자체 스크롤 제거 → 자연스럽게 흘러내림.
    <div className="flex flex-col h-full overflow-y-auto">
      {/* 검색 입력 */}
      <div className="p-3 space-y-3 flex-shrink-0 border-b border-gray-100">
        {/* 지역 */}
        <Section title="지역">
          <div className="space-y-1.5">
            <Field label="시도">
              <select
                value={params.sido}
                disabled={regionsLoading}
                onChange={(e) =>
                  setParams((p) => ({
                    ...p,
                    sido: e.target.value,
                    sigungu: "",
                  }))
                }
                className="w-full text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 focus:border-rose-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">
                  {regionsLoading ? "불러오는 중…" : "전체"}
                </option>
                {sidos.map((sd) => (
                  <option key={sd} value={sd}>
                    {sd}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="시군구">
              <select
                value={params.sigungu}
                disabled={!params.sido || regionsLoading}
                onChange={(e) =>
                  setParams((p) => ({ ...p, sigungu: e.target.value }))
                }
                className="w-full text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 focus:border-rose-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">
                  {params.sido ? "전체" : "(시도 먼저 선택)"}
                </option>
                {sigunguOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
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

        {/* 카테고리 — [전체] 는 모든 카테고리 해제 단축 (선택 0 = 전체 의미) */}
        <Section title="카테고리">
          <div className="flex flex-wrap gap-1">
            {(() => {
              const isAll = params.categories.length === 0;
              return (
                <button
                  type="button"
                  onClick={() =>
                    setParams((p) => ({ ...p, categories: [] }))
                  }
                  className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                    isAll
                      ? "bg-rose-50 text-rose-700 border-rose-300 font-semibold"
                      : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {isAll ? "✓ " : ""}
                  전체
                </button>
              );
            })()}
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

        <div className="text-[10px] text-gray-500 leading-snug px-0.5">
          ※ 전국 매물은 약 2만 건. <b>시군구</b>까지 좁히는 걸 권장합니다.
        </div>
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={runSearch}
            disabled={loading}
            className="flex-1 text-xs font-bold py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-rose-300 text-white rounded shadow-sm flex items-center justify-center gap-1.5"
          >
            {loading ? (
              <>
                <span className="w-3 h-3 border-2 border-white/70 border-t-transparent rounded-full animate-spin" />
                조회 중...
              </>
            ) : (
              <>🔍 검색</>
            )}
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={loading}
            className="text-xs py-2 px-3 bg-white text-gray-600 border border-gray-300 hover:bg-gray-50 disabled:opacity-50 rounded"
          >
            초기화
          </button>
        </div>
      </div>

      {/* 결과 — 외곽 통째 스크롤 패턴 (2026-05-08): 자체 스크롤 제거, 검색조건과 한 흐름. */}
      <div className="flex flex-col">
        <div className="px-3 py-1.5 text-[11px] font-semibold text-gray-700 flex items-center justify-between border-b border-gray-200 bg-gray-50">
          <span>결과</span>
          <span className="tabular-nums">매물 {totalCount.toLocaleString()}건</span>
        </div>
        {/* 한도 도달 안내 — 캠코 응답이 1,000을 초과하면 일부 매물 누락 가능.
            (캠코는 매물 1건당 회차별로 여러 row 응답 → 1,000 row cap 안에 들어가는 매물 일부만 dedup 후 표시) */}
        {totalCountAll != null && totalCountAll > MAX_RESULT_LIMIT && (
          <div className="px-3 py-2 text-[11px] text-amber-800 bg-amber-50 border-b border-amber-200 leading-snug">
            ⚠️ 결과가 너무 많아 일부 매물이 누락될 수 있습니다.
            <br />
            시군구·읍면동·카테고리로 좁혀주세요.
          </div>
        )}
        <div>
          {loading ? (
            <div className="p-4 text-center text-xs text-gray-500 flex flex-col items-center gap-2">
              <span className="w-5 h-5 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
              매물 조회 중...
            </div>
          ) : error ? (
            <div className="p-4 text-center text-xs text-red-600">
              조회 실패: {error}
            </div>
          ) : results.length === 0 ? (
            <div className="p-4 text-center text-xs text-gray-400">
              검색 조건을 입력하고 [검색] 버튼을 눌러주세요
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
  // 목록 카드 — 캠코 응답 단일 row 의 100% 정확한 정보만 표시.
  // 표시 X: 회차 추정, 할인율, "최저입찰가" (응답 row 가 어느 회차인지 알 수 없음 → 거짓 위험).
  // 표시 O: 감정가(절대값), 유찰 횟수, 면적, 카테고리, 위치, 재산유형.
  // 회차/현재가/할인율은 매물 클릭 후 상세 팝업에서 동단위 호출로 정확히 분석.
  const apslMan = Math.round(item.apslEvlAmt / 10000);
  const jibun = jibunFromPnu(item.ltnoPnu) ?? "—";

  // 면적 표시: 토지/건물 중 큰 쪽 우선. 둘 다 없으면 생략.
  const areaText = (() => {
    const land = item.landSqms;
    const bld = item.bldSqms;
    if (bld != null && bld > 0 && (land == null || bld >= land)) {
      return `건물 ${Math.round(bld).toLocaleString()}㎡`;
    }
    if (land != null && land > 0) {
      return `토지 ${Math.round(land).toLocaleString()}㎡`;
    }
    return null;
  })();

  return (
    <div className="w-full px-3 py-2.5 border-b border-gray-200 transition-colors bg-white hover:bg-rose-50">
      <div className="flex items-stretch gap-2">
        {/* 좌측 본문 */}
        <button
          type="button"
          onClick={onClick}
          className="flex-1 min-w-0 text-left active:opacity-70"
        >
          {/* 1줄: 카테고리 배지 + 재산유형 + 위치 */}
          <div className="flex items-center gap-1.5 mb-1">
            {item.ourCategory && (
              <span className="text-[10px] font-semibold px-1.5 py-px bg-rose-50 text-rose-700 rounded">
                {OUR_CATEGORY_LABEL[item.ourCategory]}
              </span>
            )}
            <span className="text-[10px] text-gray-500">{item.cltrUsgSclsCtgrNm}</span>
            <span className="text-[10px] text-gray-300">·</span>
            <span className="text-[10px] text-gray-500">{item.prptDivNm}</span>
            <span className="text-[10px] text-gray-400 ml-auto">
              {item.lctnSdnm} {item.lctnSggnm}
            </span>
          </div>

          {/* 2줄: 매물명 */}
          <div className="text-[12px] text-gray-900 font-semibold leading-tight mb-1.5 truncate">
            {item.onbidCltrNm}
          </div>

          {/* 3줄: 감정가 (큰 글씨, 절대값) */}
          <div className="flex items-baseline gap-1.5 mb-1">
            <span className="text-[10px] text-gray-500">감정가</span>
            <span className="text-[14px] font-bold text-gray-900 tabular-nums leading-none">
              {apslMan.toLocaleString()}만원
            </span>
          </div>

          {/* 4줄: 면적 + 유찰 횟수 */}
          <div className="flex items-center gap-2 text-[11px] text-gray-600">
            {areaText && <span>{areaText}</span>}
            {areaText && item.usbdNft != null && item.usbdNft > 0 && (
              <span className="text-gray-300">·</span>
            )}
            {item.usbdNft != null && item.usbdNft > 0 && (
              <span className="text-amber-700 font-semibold">유찰 {item.usbdNft}회</span>
            )}
          </div>
        </button>

        {/* 우측 — 📍 지번 핀 */}
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

