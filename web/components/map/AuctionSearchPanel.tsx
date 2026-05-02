"use client";

/**
 * 경매(Hyphen) 모드 검색 패널 — Sidebar 안에 inline 으로 들어감.
 *
 * 외곽 컨테이너/헤더 색은 부모 Sidebar 가 registry.colors 로 분기 (amber 톤).
 * 본 컴포넌트는 검색 입력 + 결과 카드 영역만 담당.
 *
 * 데이터 흐름 (현재는 미니멀 골격):
 *   1. /api/regions/sigungu → 시도/시군구 드롭다운 (atomic, 30일 CDN)
 *   2. 검색 → /api/auction/search (다음 단계, 현재는 mock 빈 결과)
 *   3. 결과 카드 → 지도 마커 + 클릭 시 지번 진입 (다음 단계)
 *
 * 카테고리/진행상태/고급필터는 시각 확인 후 단계적 추가.
 */

import { useEffect, useMemo, useState } from "react";
import {
  loadModeState,
  saveModeState,
  clearModeState,
} from "@/lib/modes/storage";
import {
  AUCTION_CATEGORY_GROUPS,
  AUCTION_CATEGORY_GROUP_ORDER,
  AUCTION_EMPTY_PARAMS,
  AUCTION_GROUP_LABEL,
  AUCTION_YONGDO_LABEL,
  type AuctionCategoryGroup,
  type AuctionPersistedState,
  type AuctionSearchUiParams,
} from "@/lib/modes/modes/auction";
import { fetchSigungus, type SigunguEntry } from "@/lib/api/regions";
import type { AuctionListItem } from "@/lib/hyphen/types";

const MODE_ID = "auction";

/**
 * 진행상태 칩 옵션 — Hyphen 응답에 등장 가능한 한글값.
 * v5 검증(2026-05-02) 실측 등장: 신건/진행/유찰/매각/취하.
 * 변경/정지는 명세상 가능하지만 미관측 — 자주 보이지 않으므로 미노출 (필요 시 응답 후 처리).
 *
 * 정렬 = 영업 시각 흐름 (입찰 가능 → 종결 순).
 */
const PROGRESS_STATUS_OPTIONS = ["신건", "진행", "유찰", "매각", "취하"];

interface Props {
  /** 검색 결과 변경 — 지도 마커 갱신용 (현재 단계는 호출되지 않음) */
  onResults?: (items: AuctionListItem[]) => void;
  /** 매물 카드 클릭 — 지도 강조 + 상세 진입 (현재 단계는 호출되지 않음) */
  onItemClick?: (item: AuctionListItem) => void;
}

/** "수원시" + "권선구" → "수원시 권선구" / 한쪽만 있으면 그것만 */
function formatSigungu(si: string | null, gu: string): string {
  return si && si.trim() !== "" ? `${si} ${gu}` : gu;
}

export default function AuctionSearchPanel({ onResults: _onResults, onItemClick: _onItemClick }: Props) {
  // ─── 상태 복원 ─────────────────────────────────────────────
  const persisted =
    typeof window !== "undefined"
      ? loadModeState<AuctionPersistedState>(MODE_ID)
      : null;

  const [params, setParams] = useState<AuctionSearchUiParams>(
    persisted?.params ?? AUCTION_EMPTY_PARAMS,
  );
  const [results, setResults] = useState<AuctionListItem[]>(
    persisted?.results ?? [],
  );

  // ─── 시군구 마스터 (모든 모드 공통 atomic) ──────────────────
  const [allSigungus, setAllSigungus] = useState<SigunguEntry[]>([]);
  const [regionsLoading, setRegionsLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    fetchSigungus()
      .then((items) => {
        if (alive) setAllSigungus(items);
      })
      .catch((e) => {
        console.error("[AuctionSearchPanel] 시군구 로드 실패", e);
      })
      .finally(() => {
        if (alive) setRegionsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  /** 시도 unique 목록 */
  const sidos = useMemo(() => {
    const set = new Set<string>();
    for (const r of allSigungus) set.add(r.sido);
    return [...set];
  }, [allSigungus]);

  /** 선택 시도의 시군구 옵션 — { label 한글, code 5자리 } */
  const sigungus = useMemo(() => {
    if (!params.sido) return [] as Array<{ label: string; code: string }>;
    return allSigungus
      .filter((r) => r.sido === params.sido)
      .map((r) => ({ label: formatSigungu(r.si, r.gu), code: r.code }));
  }, [allSigungus, params.sido]);

  /** 시도 변경 시 무효 시군구 자동 초기화 */
  useEffect(() => {
    if (!params.sigungu) return;
    const stillValid = sigungus.some((s) => s.label === params.sigungu);
    if (!stillValid) {
      setParams((p) => ({ ...p, sigungu: "", sigunguCode: "" }));
    }
  }, [sigungus, params.sigungu]);

  // ─── 영속화 ──────────────────────────────────────────────
  useEffect(() => {
    saveModeState<AuctionPersistedState>(MODE_ID, {
      params,
      results,
      totalCountAll: null,
    });
  }, [params, results]);

  // ─── 카테고리 펼치기 상태 — 한 번에 1개 그룹만 펼침 (시각 단순화) ──
  const [expandedGroup, setExpandedGroup] = useState<AuctionCategoryGroup | null>(
    null,
  );

  // ─── 고급 필터 펼침 상태 — 모바일 시각 부담 줄임. 디폴트 접힘. ──
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ─── 검색 (미니멀 골격 — 다음 단계에서 /api/auction/search 연결) ──
  const [searching, setSearching] = useState(false);
  const canSearch = params.sigunguCode !== "" && !searching;

  const runSearch = async () => {
    if (!canSearch) return;
    setSearching(true);
    try {
      // TODO(다음 단계): /api/auction/search 호출 → enrich → setResults
      await new Promise((r) => setTimeout(r, 300));
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const reset = () => {
    setParams(AUCTION_EMPTY_PARAMS);
    setResults([]);
    clearModeState(MODE_ID);
  };

  /** 진행상태 칩 토글 — 다중 선택. 빈 배열 허용(=결과 없음 방지로 검색버튼은 활성 유지). */
  const toggleProgressStatus = (status: string) => {
    setParams((p) => ({
      ...p,
      progressStatus: p.progressStatus.includes(status)
        ? p.progressStatus.filter((s) => s !== status)
        : [...p.progressStatus, status],
    }));
  };

  /** 그룹 칩 토글 — 그룹 멤버 모두 OFF→ON / 일부라도 ON→모두 OFF (3상 토글). */
  const toggleGroup = (group: AuctionCategoryGroup) => {
    const groupCodes = AUCTION_CATEGORY_GROUPS[group];
    setParams((p) => {
      const allOn = groupCodes.every((c) => p.yongdoCodes.includes(c));
      const next = allOn
        ? p.yongdoCodes.filter((c) => !groupCodes.includes(c)) // 다 켜짐 → 다 끔
        : [
            ...p.yongdoCodes.filter((c) => !groupCodes.includes(c)),
            ...groupCodes,
          ]; // 일부/전무 → 전부 켬
      return { ...p, yongdoCodes: next };
    });
  };

  /** 개별 yongdo 코드 토글 — 그룹 펼침 안에서 사용. */
  const toggleYongdo = (code: string) => {
    setParams((p) => ({
      ...p,
      yongdoCodes: p.yongdoCodes.includes(code)
        ? p.yongdoCodes.filter((c) => c !== code)
        : [...p.yongdoCodes, code],
    }));
  };

  // ─── 렌더 ────────────────────────────────────────────────
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
                disabled={regionsLoading}
                onChange={(e) =>
                  setParams((p) => ({
                    ...p,
                    sido: e.target.value,
                    sigungu: "",
                    sigunguCode: "",
                  }))
                }
                className="w-full text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 focus:border-amber-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
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
                onChange={(e) => {
                  const label = e.target.value;
                  const found = sigungus.find((s) => s.label === label);
                  setParams((p) => ({
                    ...p,
                    sigungu: label,
                    sigunguCode: found?.code ?? "",
                  }));
                }}
                className="w-full text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 focus:border-amber-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">
                  {params.sido ? "선택" : "(시도 먼저 선택)"}
                </option>
                {sigungus.map((s) => (
                  <option key={s.code} value={s.label}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="읍면동">
              <input
                type="text"
                placeholder="예: 대곶면 (선택)"
                value={params.emdong}
                onChange={(e) =>
                  setParams((p) => ({ ...p, emdong: e.target.value }))
                }
                className="w-full text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 focus:border-amber-500 focus:outline-none"
              />
            </Field>
          </div>
        </Section>

        {/* 카테고리(용도) — 영업 2순위 축.
            그룹 6개 칩 (토지농지/공장창고/주거/상업업무/공공시설/동산).
            그룹 클릭 = 그룹 멤버 모두 토글 ON↔OFF.
            그룹 펼치기 = 그룹 안 yongdo 코드 개별 다중 선택. */}
        <Section title="카테고리">
          <div className="space-y-1.5">
            {/* [전체] — 빈 배열 = 전체 의미. 그룹 칩과 동일 알약형. */}
            <div className="flex flex-wrap gap-1">
              {(() => {
                const isAll = params.yongdoCodes.length === 0;
                return (
                  <button
                    type="button"
                    onClick={() => setParams((p) => ({ ...p, yongdoCodes: [] }))}
                    className={`text-[11px] px-3 py-1 leading-none rounded-full border font-semibold transition-colors ${
                      isAll
                        ? "bg-amber-50 text-amber-700 border-amber-300"
                        : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {isAll ? "✓ " : ""}
                    전체
                  </button>
                );
              })()}
            </div>

            {/* 그룹 칩 */}
            <div className="flex flex-wrap gap-1">
              {AUCTION_CATEGORY_GROUP_ORDER.map((group) => {
                const groupCodes = AUCTION_CATEGORY_GROUPS[group];
                const groupSelectedCount = groupCodes.filter((c) =>
                  params.yongdoCodes.includes(c),
                ).length;
                const allOn = groupSelectedCount === groupCodes.length;
                const partialOn =
                  groupSelectedCount > 0 && groupSelectedCount < groupCodes.length;
                const isExpanded = expandedGroup === group;

                // 알약형 단일 칩 — 좌측 본체(그룹 토글) + 우측 화살표(펼침).
                // 두 클릭 영역은 분리되지만 시각적으로 한 덩어리.
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
                      title={AUCTION_GROUP_LABEL[group].sub}
                      className="text-[11px] pl-2.5 pr-1 py-1 leading-none font-semibold rounded-l-full"
                    >
                      {allOn ? "✓ " : partialOn ? "◐ " : ""}
                      {AUCTION_GROUP_LABEL[group].label}
                      {partialOn && (
                        <span className="text-[9px] ml-0.5 tabular-nums opacity-80">
                          ({groupSelectedCount}/{groupCodes.length})
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

            {/* 그룹 펼침 — 개별 yongdo 코드 칩 */}
            {expandedGroup && (
              <div className="p-2 bg-amber-50/40 border border-amber-200 rounded space-y-1">
                <div className="text-[10px] text-amber-700 font-semibold">
                  {AUCTION_GROUP_LABEL[expandedGroup].label} —{" "}
                  {AUCTION_GROUP_LABEL[expandedGroup].sub}
                </div>
                <div className="flex flex-wrap gap-1">
                  {AUCTION_CATEGORY_GROUPS[expandedGroup].map((code) => {
                    const checked = params.yongdoCodes.includes(code);
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() => toggleYongdo(code)}
                        className={`text-[10px] px-2.5 py-0.5 leading-none rounded-full border transition-colors ${
                          checked
                            ? "bg-amber-600 text-white border-amber-700 font-semibold"
                            : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                        }`}
                      >
                        {checked ? "✓ " : ""}
                        {AUCTION_YONGDO_LABEL[code] ?? code}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* 진행상태 — 영업 핵심 필터.
            v5 검증 응답 등장값: 신건/진행/유찰/매각/취하 (+변경/정지 가능).
            기본 ON = 신건+진행+유찰 (입찰 가능 매물). 응답 후 클라이언트 사이드 필터. */}
        <Section title="진행 상태">
          <div className="flex flex-wrap gap-1">
            {PROGRESS_STATUS_OPTIONS.map((status) => {
              const checked = params.progressStatus.includes(status);
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => toggleProgressStatus(status)}
                  className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                    checked
                      ? "bg-amber-50 text-amber-700 border-amber-300 font-semibold"
                      : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {checked ? "✓ " : ""}
                  {status}
                </button>
              );
            })}
          </div>
          <div className="text-[10px] text-gray-400 mt-1 leading-snug">
            ※ 신건/진행/유찰 = 입찰 가능. 매각/취하 = 종결.
          </div>
        </Section>

        {/* 매각기일 — 영업 1순위 필터.
            v5 검증 결과 필터 없으면 응답이 종결건 위주라, 미래 윈도우 좁힘 필수.
            기본 = 오늘 ~ +6개월 (모델 EMPTY_PARAMS 가 자동 세팅). */}
        <Section title="매각기일">
          <div className="space-y-1.5">
            <Field label="시작">
              <input
                type="date"
                value={params.bidStart ?? ""}
                onChange={(e) =>
                  setParams((p) => ({
                    ...p,
                    bidStart: e.target.value || null,
                  }))
                }
                className="w-full text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 focus:border-amber-500 focus:outline-none"
              />
            </Field>
            <Field label="종료">
              <input
                type="date"
                value={params.bidEnd ?? ""}
                onChange={(e) =>
                  setParams((p) => ({
                    ...p,
                    bidEnd: e.target.value || null,
                  }))
                }
                className="w-full text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 focus:border-amber-500 focus:outline-none"
              />
            </Field>
            <div className="flex gap-1 pt-0.5">
              <QuickRangeButton label="오늘~1개월" onClick={() => setParams((p) => ({ ...p, ...rangeFromToday(1) }))} />
              <QuickRangeButton label="3개월" onClick={() => setParams((p) => ({ ...p, ...rangeFromToday(3) }))} />
              <QuickRangeButton label="6개월" onClick={() => setParams((p) => ({ ...p, ...rangeFromToday(6) }))} />
            </div>
          </div>
        </Section>

        {/* 고급 필터 — 모바일 시각 부담 줄임. 평소엔 접힘.
            의뢰자 결정(2026-05-03): 감정가/토지/건물/할인율 4개. */}
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="w-full text-[11px] py-1 text-gray-500 hover:text-amber-700 border border-dashed border-gray-300 hover:border-amber-300 rounded transition-colors"
        >
          {showAdvanced
            ? "▴ 고급 필터 접기"
            : "▾ 고급 필터 (감정가·면적·할인율)"}
        </button>

        {showAdvanced && (
          <div className="space-y-2.5 px-1">
            <RangeField
              label="감정가 (만원)"
              minVal={params.gamMin}
              maxVal={params.gamMax}
              onChange={(min, max) =>
                setParams((p) => ({ ...p, gamMin: min, gamMax: max }))
              }
            />
            <RangeField
              label="토지면적 (㎡)"
              minVal={params.landMin}
              maxVal={params.landMax}
              onChange={(min, max) =>
                setParams((p) => ({ ...p, landMin: min, landMax: max }))
              }
            />
            <RangeField
              label="건물면적 (㎡)"
              minVal={params.bareaMin}
              maxVal={params.bareaMax}
              onChange={(min, max) =>
                setParams((p) => ({ ...p, bareaMin: min, bareaMax: max }))
              }
            />
            <RangeField
              label="할인율 (%)"
              minVal={params.discountMin}
              maxVal={params.discountMax}
              onChange={(min, max) =>
                setParams((p) => ({ ...p, discountMin: min, discountMax: max }))
              }
              hint="감정가 대비 % 할인 (예: 30 = 30%↓)"
            />
          </div>
        )}

        <div className="text-[10px] text-gray-500 leading-snug px-0.5">
          ※ Hyphen 호출 비용 절감을 위해 <b>시군구</b>까지 좁혀야 검색 가능합니다.
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={runSearch}
            disabled={!canSearch}
            className="flex-1 text-xs font-bold py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white rounded shadow-sm flex items-center justify-center gap-1.5"
          >
            {searching ? (
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
            disabled={searching}
            className="text-xs py-2 px-3 bg-white text-gray-600 border border-gray-300 hover:bg-gray-50 disabled:opacity-50 rounded"
          >
            초기화
          </button>
        </div>
      </div>

      {/* 결과 영역 — 다음 단계에서 카드 리스트로 채움 */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-3 py-1.5 text-[11px] font-semibold text-gray-700 flex items-center justify-between border-b border-gray-200 bg-gray-50">
          <span>결과</span>
          <span className="tabular-nums">매물 {results.length.toLocaleString()}건</span>
        </div>
        <div className="overflow-y-auto flex-1">
          {results.length === 0 ? (
            <div className="p-4 text-center text-xs text-gray-400 leading-relaxed">
              {params.sigunguCode === "" ? (
                <>지역(시군구)을 선택하고 [검색] 버튼을 눌러주세요</>
              ) : searching ? (
                <>매물 조회 중...</>
              ) : (
                <>
                  검색 결과 0건
                  <br />
                  <span className="text-[10px] text-gray-300">
                    (백엔드 미연결 — 다음 단계에서 활성화)
                  </span>
                </>
              )}
            </div>
          ) : (
            <div className="p-4 text-center text-xs text-gray-400">
              결과 카드는 다음 단계에서 렌더됩니다
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────
// 보조 컴포넌트 — 모드별 패널이 동일한 시각으로 보이도록 통일
// (다음 단계에서 lib/modes/components/ 로 추출 후 모드 간 공유)
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

/** min~max 숫자 RangeField — 고급 필터 안 4종 공통. */
function RangeField({
  label,
  minVal,
  maxVal,
  onChange,
  hint,
}: {
  label: string;
  minVal: number | null;
  maxVal: number | null;
  onChange: (min: number | null, max: number | null) => void;
  hint?: string;
}) {
  return (
    <div>
      <Field label={label}>
        <div className="flex items-center gap-1">
          <input
            type="number"
            placeholder="최소"
            value={minVal ?? ""}
            onChange={(e) =>
              onChange(
                e.target.value === "" ? null : Number(e.target.value),
                maxVal,
              )
            }
            className="w-full min-w-0 text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 tabular-nums focus:border-amber-500 focus:outline-none"
          />
          <span className="text-xs text-gray-400">~</span>
          <input
            type="number"
            placeholder="최대"
            value={maxVal ?? ""}
            onChange={(e) =>
              onChange(
                minVal,
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
            className="w-full min-w-0 text-xs px-2 py-1 border border-gray-300 rounded bg-white text-gray-900 tabular-nums focus:border-amber-500 focus:outline-none"
          />
        </div>
      </Field>
      {hint && (
        <div className="text-[10px] text-gray-400 leading-snug mt-0.5 ml-16">
          {hint}
        </div>
      )}
    </div>
  );
}

/** 매각기일 빠른 범위 버튼 — "3개월" 클릭 = 오늘 ~ +3개월 */
function QuickRangeButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 bg-white text-gray-600 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700 transition-colors"
    >
      {label}
    </button>
  );
}

/** KST 오늘 ~ +N개월 윈도우 (YYYY-MM-DD). 모델의 computeDefaultBidWindow 와 동일 시각 기준. */
function rangeFromToday(months: number): { bidStart: string; bidEnd: string } {
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const start = kstNow.toISOString().slice(0, 10);
  const future = new Date(kstNow);
  future.setUTCMonth(future.getUTCMonth() + months);
  const end = future.toISOString().slice(0, 10);
  return { bidStart: start, bidEnd: end };
}
