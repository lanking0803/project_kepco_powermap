"use client";

/**
 * 필지 정보 패널 (1차 1단계 — 지도 클릭 시 표시되는 상담 허브).
 *
 * 설계 원칙:
 *   - 지번 = 정보 출발점. 좌표 진입이든 지번 직접 진입이든 같은 패널.
 *   - 탭으로 정보 카테고리 분리: 필지 / 전기 / 가격 / 입지
 *   - 1차/2차/3차 기능 확장은 각 탭 내부에 섹션 추가 (패널 구조는 그대로)
 *
 * 레이아웃:
 *   - 데스크톱: 좌측 고정 패널
 *   - 모바일: 하단 바텀시트 (화면 하단부)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { AddrMeta, KepcoDataRow } from "@/lib/types";
import type { JibunInfo, ParcelGeometry } from "@/lib/vworld/parcel";
import { formatRelativeKst, formatAbsoluteKst } from "@/lib/dateFormat";
import {
  fetchBuildingsByPnu,
  type BuildingTitleInfo,
} from "@/lib/api/buildings";
import { fetchVworldParcelByPnu } from "@/lib/api/vworld";
import {
  fetchKepcoByPnu,
  refreshKepcoByPnu,
  clearKepcoByPnuCache,
} from "@/lib/kepco/by-pnu";
import { jibunFromPnu, buildPnuFromBjdAndJibun } from "@/lib/geo/pnu";
import LocationDetailGrouped from "./LocationDetailGrouped";
import {
  fetchLandTransactionsByPnu,
  fetchNrgTransactionsByPnu,
  type LandTransaction,
  type NrgTransaction,
  type TradeStats,
  type LandTransactionsResult,
  type NrgTransactionsResult,
} from "@/lib/api/transactions";
import {
  computeLandStats,
  computeNrgStats,
  computeSimilarAreaMedian,
  type CategoryStats,
} from "@/lib/rtms/trade-stats";
import PriceCard from "./parcel/PriceCard";
import PriceTrendChart from "./parcel/PriceTrendChart";
import {
  classifyPurpose,
  classifyRoof,
  classifyStructure,
  yearsSince,
  formatBldgYearMonth,
  toPyeong,
  NOTEWORTHY_OLD_YEARS,
  LAND_SOLAR_HINT_BCRAT,
  type PurposeGrade,
} from "@/lib/building-hub/classify";
import AddrLine from "./AddrLine";
import SolarSection from "./SolarSection";
import type { SolarMarker } from "@/lib/api/solar-permits";
import OnbidTab from "./onbid/OnbidTab";
import AuctionTab from "./auction/AuctionTab";
import RegulationsCard from "@/components/quote/RegulationsCard";

type TabKey = "parcel" | "electric" | "onbid" | "auction" | "price" | "location" | "regulation";

interface Props {
  /**
   * 패널이 표시할 필지의 PNU 19자리.
   * 모든 탭의 단일 입력값 — 진입 모드(전기/공매/견적) 무관 동일 흐름.
   */
  pnu: string;
  onClose: () => void;
  /**
   * 견적 모드용 — VWorld 도로명주소건물(lt_c_spbd) 폴리곤 개수.
   * undefined: 알 수 없음(메인 지도). 0 + 건축물대장≥1 일 때만 ⚠️ 도로명주소 미부여 안내.
   */
  polygonCount?: number;
  /**
   * 견적 모드 안에서 패널이 떴을 때 true — [📐 면적 산출 시작] 버튼 숨김
   * (이미 견적 모드 안이라 중복).
   */
  inQuoteMode?: boolean;
  /**
   * @deprecated 자동 마커 표시 정책 폐기 (2026-04-30). 모달 행 클릭 → 지번 흐름으로 통합.
   * 마커/타입/prop 일괄 정리는 마무리 단계.
   */
  onSolarMarkers: (markers: SolarMarker[]) => void;
  /**
   * 입지 탭의 발전소 목록에서 행 클릭 → 그 발전소 PNU 로 이 패널 자체를 갈아끼움.
   * 메인 지도(MapClient): openParcelPanelByPnu 그대로 전달.
   * 견적 모드(QuoteModeClient): PNU 고정이라 미전달 → 행 클릭 비활성화.
   */
  onPnuChange?: (pnu: string) => void;
}


const M2_TO_PYEONG = 0.3025;

/** 지목 1글자 코드 → 풀명. 매핑 없으면 원본 유지. */
const JIMOK_EXPAND: Record<string, string> = {
  대: "대지",
  답: "논",
  전: "밭",
  과: "과수원",
  임: "임야",
  잡: "잡종지",
  도: "도로",
  천: "하천",
  구: "구거",
  유: "유지",
  묘: "묘지",
  사: "사적지",
  학: "학교용지",
  종: "종교용지",
  공: "공장용지",
  창: "창고용지",
  주: "주차장",
  차: "주유소용지",
  체: "체육용지",
  양: "양어장",
  광: "광천지",
  염: "염전",
  철: "철도용지",
  수: "수도용지",
  제: "제방",
  원: "유원지",
};

function expandJimok(jimok: string): string {
  return jimok.length === 1 ? (JIMOK_EXPAND[jimok] ?? jimok) : jimok;
}

const TABS: { key: TabKey; label: string }[] = [
  { key: "parcel", label: "필지" },
  { key: "electric", label: "전기" },
  { key: "onbid", label: "공매" },
  { key: "auction", label: "경매" },
  { key: "price", label: "가격" },
  { key: "location", label: "입지" },
  { key: "regulation", label: "규제" },
];

/** 마지막으로 본 탭 localStorage 키 — 다음 패널 진입 시 그 탭으로 시작. */
const LAST_TAB_STORAGE_KEY = "parcel-panel:last-tab";
const DEFAULT_TAB: TabKey = "electric";

function readLastTab(): TabKey {
  if (typeof window === "undefined") return DEFAULT_TAB;
  try {
    const v = window.localStorage.getItem(LAST_TAB_STORAGE_KEY);
    if (v && TABS.some((t) => t.key === v)) return v as TabKey;
  } catch {}
  return DEFAULT_TAB;
}

export default function ParcelInfoPanel({
  pnu,
  onClose,
  polygonCount,
  inQuoteMode,
  onSolarMarkers,
  onPnuChange,
}: Props) {
  // 마지막 본 탭 기억 — 진입 모드 무관 단일 정책 (분기 0).
  const [tab, setTabState] = useState<TabKey>(() => readLastTab());
  const setTab = useCallback((v: TabKey) => {
    setTabState(v);
    try {
      window.localStorage.setItem(LAST_TAB_STORAGE_KEY, v);
    } catch {}
  }, []);

  // 패널 확장 토글 — 매번 기본 사이즈로 시작(저장 X). 견적 모드에서는 의미 없어 무시.
  const [expanded, setExpanded] = useState(false);

  // PNU → VWorld parcel (jibun + geometry) self-fetch.
  // 모듈 캐시 (lib/api/vworld) 가 있어 같은 PNU 재방문 비용 0.
  const [jibun, setJibun] = useState<JibunInfo | null>(null);
  const [geometry, setGeometry] = useState<ParcelGeometry | null>(null);
  const [parcelLoading, setParcelLoading] = useState(false);
  const [parcelError, setParcelError] = useState<string | null>(null);

  useEffect(() => {
    if (!/^\d{19}$/.test(pnu)) {
      setJibun(null);
      setGeometry(null);
      return;
    }
    let alive = true;
    setParcelLoading(true);
    setParcelError(null);
    setJibun(null);
    setGeometry(null);
    fetchVworldParcelByPnu(pnu)
      .then((res) => {
        if (!alive) return;
        if (res) {
          setJibun(res.jibun);
          setGeometry(res.geometry);
        }
      })
      .catch((e: unknown) => {
        if (alive) setParcelError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setParcelLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [pnu]);

  // 헤더 주소 — VWorld jibun 우선 사용. 없으면 PNU 에서 지번만 도출 (즉시 표시 가능).
  const fallbackJibun = useMemo(() => jibunFromPnu(pnu) ?? "", [pnu]);
  const clickedJibun = jibun?.jibun || fallbackJibun;
  const headerParts: string[] = jibun
    ? ([jibun.ctp_nm, jibun.sig_nm, jibun.emd_nm, jibun.li_nm || null, jibun.jibun].filter(
        Boolean,
      ) as string[])
    : fallbackJibun
      ? [fallbackJibun]
      : [];

  // 견적 모드 임베드 시 = 좌측 패널 0번 섹션 안. floating overlay X / 자체 헤더 X.
  // 일반 모드: 기본(우하단 카드) ↔ 확장(중앙 큰 모달, 모바일 풀스크린).
  const wrapperClass = inQuoteMode
    ? "bg-white flex flex-col"
    : expanded
      ? "fixed inset-0 md:inset-auto md:left-[calc(320px+(100vw-320px)/2)] md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[min(80vw-320px,1400px)] md:h-[85vh] bg-white md:rounded-xl shadow-2xl border border-gray-200 overflow-hidden z-20 flex flex-col transition-all duration-200"
      : "absolute left-4 right-4 bottom-4 md:left-auto md:right-4 md:bottom-4 md:w-[520px] max-w-[calc(100%-32px)] bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden z-10 flex flex-col h-[62dvh] md:h-[min(560px,calc(100dvh-120px))] kepco-slide-up transition-all duration-200";

  // 패널이 한 번이라도 jibun/geometry 받기 전엔 탭 내용 숨김.
  // (탭 자체 fetch 가 PNU 만 의존하면 이미 시작 가능하지만, ParcelTab/PriceTab 이
  //  geometry 의존이라 일관성 위해 받은 후 일괄 노출)
  const ready = jibun != null && geometry != null;

  return (
    <div className={wrapperClass}>
      {/* 헤더 — 견적 모드(임베드) 시 SectionHeader 가 대체하므로 숨김 */}
      {!inQuoteMode && (
        <div className="px-3 py-2.5 md:px-4 md:py-3 border-b bg-gray-50 flex items-start justify-between gap-2 flex-shrink-0">
          <div className="flex-1 min-w-0">
            {headerParts.length === 0 ? (
              parcelLoading ? (
                <div className="text-sm text-gray-500 py-1">필지 정보 불러오는 중...</div>
              ) : parcelError ? (
                <div className="text-sm text-red-600 py-1">조회 실패: {parcelError}</div>
              ) : (
                <div className="text-sm text-gray-600 py-1">이 위치에 필지 없음</div>
              )
            ) : (
              <div className="font-bold text-sm md:text-base text-gray-900 truncate">
                <AddrLine parts={headerParts} />
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-gray-700 hover:text-blue-600 hover:bg-blue-50 leading-none w-8 h-8 flex items-center justify-center rounded border border-gray-300 hover:border-blue-400 transition-colors"
              aria-label={expanded ? "축소" : "확대"}
              title={expanded ? "원래 크기로" : "크게 보기"}
            >
              {expanded ? (
                // 축소 (대각선 안쪽으로) — SVG
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9,3 9,7 13,7" />
                  <line x1="14" y1="2" x2="9" y2="7" />
                  <polyline points="7,13 7,9 3,9" />
                  <line x1="2" y1="14" x2="7" y2="9" />
                </svg>
              ) : (
                // 확장 (대각선 바깥쪽으로) — SVG
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="10,2 14,2 14,6" />
                  <line x1="14" y1="2" x2="9" y2="7" />
                  <polyline points="6,14 2,14 2,10" />
                  <line x1="2" y1="14" x2="7" y2="9" />
                </svg>
              )}
            </button>
            <button
              onClick={onClose}
              className="text-gray-700 hover:text-red-600 hover:bg-red-50 text-xl leading-none w-8 h-8 flex items-center justify-center rounded border border-gray-300 hover:border-red-400 transition-colors font-bold"
              aria-label="닫기"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* 탭 */}
      {ready && (
        <div className="flex border-b border-gray-200 flex-shrink-0">
          {TABS.map((t) => {
            const isOnbid = t.key === "onbid";
            const activeColor = isOnbid
              ? "text-rose-600 border-rose-600 bg-white"
              : "text-blue-600 border-blue-600 bg-white";
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 py-2 text-xs font-semibold transition-colors border-b-2 ${
                  tab === t.key
                    ? activeColor
                    : "text-gray-500 border-transparent hover:bg-gray-50"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      {/* 탭 내용 — 모든 탭이 단일 입력 PNU 만 받음. 활성 시점에 자체 fetch. */}
      {ready && jibun && (
        <div className="flex-1 overflow-auto px-3 py-3 md:px-4 md:py-3">
          {tab === "parcel" && (
            <ParcelTab
              jibun={jibun}
              geometry={geometry}
              polygonCount={polygonCount}
              inQuoteMode={inQuoteMode}
            />
          )}
          {tab === "electric" && (
            <ElectricTab
              pnu={pnu}
              clickedJibun={clickedJibun}
              onPnuChange={onPnuChange}
            />
          )}
          {tab === "onbid" && <OnbidTab pnu={pnu} onPnuChange={onPnuChange} />}
          {tab === "auction" && <AuctionTab pnu={pnu} onPnuChange={onPnuChange} />}
          {tab === "price" && (
            <PriceTab
              jibun={jibun}
              geometry={geometry}
              clickedJibun={clickedJibun}
              meta={null}
            />
          )}
          {tab === "location" && (
            <LocationTab
              pnu={pnu}
              areaLabel={[jibun.emd_nm, jibun.li_nm].filter(Boolean).join(" ")}
              onSolarMarkers={onSolarMarkers}
              onPnuClick={onPnuChange}
            />
          )}
          {tab === "regulation" && <RegulationsCard pnu={pnu} />}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────
// 탭별 컨텐츠
// ───────────────────────────────────────────

function ParcelTab({
  jibun,
  geometry,
  polygonCount,
  inQuoteMode,
}: {
  jibun: JibunInfo;
  geometry: ParcelGeometry | null;
  /** 견적 모드 한정: VWorld 도로명주소건물 폴리곤 개수. undefined 면 안내 X */
  polygonCount?: number;
  /** 견적 모드 안에서 떴을 때 true — [면적 산출 시작] 버튼 숨김 */
  inQuoteMode?: boolean;
}) {
  // 탭 활성화 시점에 lazy fetch (1 atomic = 1 외부 호출).
  // 같은 PNU 재방문은 모듈 scope 캐시로 0회.
  const [buildings, setBuildings] = useState<BuildingTitleInfo[]>([]);
  const [bldgLoading, setBldgLoading] = useState(false);
  const [bldgError, setBldgError] = useState<string | null>(null);

  useEffect(() => {
    if (!jibun.pnu) return;
    const controller = new AbortController();
    setBldgLoading(true);
    setBldgError(null);
    setBuildings([]);
    fetchBuildingsByPnu(jibun.pnu, { signal: controller.signal })
      .then((rows) => {
        if (controller.signal.aborted) return;
        setBuildings(rows);
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name === "AbortError") return;
        setBldgError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBldgLoading(false);
      });
    return () => controller.abort();
  }, [jibun.pnu]);

  return (
    <div className="space-y-3">
      <ParcelHero jibun={jibun} geometry={geometry} />

      <BSection title="🏢 건축물대장">
        {bldgLoading ? (
          <div className="text-[13px] text-gray-500 py-1">
            건축물 정보 불러오는 중...
          </div>
        ) : bldgError ? (
          <div className="text-[13px] text-red-600 py-1">
            조회 실패: {bldgError}
          </div>
        ) : buildings.length === 0 ? (
          <div className="text-[13px] text-gray-500 py-3 text-center bg-white rounded border border-dashed border-gray-200">
            등록된 건축물 없음 <span className="text-gray-400">(빈 땅)</span>
          </div>
        ) : (
          <div className="space-y-2">
            {/* 견적 모드 한정: 대장은 있지만 폴리곤 0건 → 도로명주소 미부여 의심 */}
            {polygonCount === 0 && (
              <div className="text-[12px] text-amber-800 bg-amber-50 border border-amber-300 rounded px-2 py-1.5 leading-snug">
                ⚠️ 도로명주소가 부여되지 않은 건물입니다 (시골 농업시설 등에서 흔함).
                <br />
                자동 폴리곤이 잡히지 않으니 견적 모드에서{" "}
                <b>위성 사진을 보고 직접 그려주세요</b>.
              </div>
            )}
            {buildings.map((b, i) => (
              <BuildingCard key={i} info={b} />
            ))}
          </div>
        )}
      </BSection>

      {!inQuoteMode && <QuoteEntryButton pnu={jibun.pnu} />}

      <ParcelFooter jibun={jibun} />
    </div>
  );
}

/**
 * 견적 모드 진입 버튼 — /quote/[pnu] 풀스크린으로 이동.
 *
 * 1차 2단계 진입점. 새 탭에서 열기 — 영업 시 메인 지도(여러 부지 비교) 와
 * 견적 작업창을 동시에 띄워두는 흐름이 자연스러움.
 * PNU 19자리 검증은 라우트 page.tsx 에서.
 */
function QuoteEntryButton({ pnu }: { pnu: string }) {
  if (!/^\d{19}$/.test(pnu)) return null;
  return (
    <Link
      href={`/quote/${pnu}`}
      target="_blank"
      rel="noopener noreferrer"
      className="block w-full py-2.5 text-sm font-bold text-center
                 bg-blue-600 hover:bg-blue-700 active:bg-blue-800
                 text-white rounded-lg shadow-sm transition-colors"
    >
      📐 견적 시작 ↗
    </Link>
  );
}

/**
 * 필지 Hero — 지목 + 평수 강조 (영업 의사결정 첫 한 줄).
 *
 * violet 그라데이션 컨테이너로 영역 시각화. 평수가 가장 큰 글씨 (영업이 평당 단가
 * 계산할 때 가장 먼저 보는 정보).
 */
function ParcelHero({
  jibun,
  geometry,
}: {
  jibun: JibunInfo;
  geometry: ParcelGeometry | null;
}) {
  const pyeong = geometry ? toPyeong(geometry.area_m2) : null;
  const jimokFull = geometry?.jimok ? expandJimok(geometry.jimok) : null;
  return (
    <div className="bg-gradient-to-br from-violet-50 to-purple-50 border border-violet-200 rounded-lg p-3">
      <div className="text-[12px] font-bold text-violet-800 uppercase tracking-wider mb-1.5">
        🏞 필지 정보
      </div>
      <div className="flex items-baseline gap-x-2 gap-y-1 flex-wrap">
        {jimokFull && (
          <span className="text-[17px] md:text-[18px] font-bold text-gray-900">
            {jimokFull}
          </span>
        )}
        {pyeong != null && geometry && (
          <>
            {jimokFull && <span className="text-gray-300">·</span>}
            <span className="text-[22px] md:text-[24px] font-bold text-gray-900 tabular-nums leading-none">
              {pyeong.toLocaleString()}
              <span className="text-[14px] font-semibold text-gray-500 ml-0.5">
                평
              </span>
            </span>
            <span className="text-[12px] text-gray-500 tabular-nums">
              ({Math.round(geometry.area_m2).toLocaleString()}㎡)
            </span>
          </>
        )}
        {jibun.isSan && (
          <span className="text-[11px] text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded border border-orange-200 font-medium">
            산
          </span>
        )}
        {!geometry && (
          <span className="text-[12px] text-gray-400">필지 형상 정보 없음</span>
        )}
      </div>
    </div>
  );
}

function ParcelFooter({ jibun }: { jibun: JibunInfo }) {
  return (
    <div className="pt-2 border-t border-gray-100 flex items-center gap-3 text-[12px] text-gray-400 font-mono">
      <span className="shrink-0">지번 {jibun.jibun}</span>
      <span className="truncate" title={jibun.pnu}>
        PNU {jibun.pnu}
      </span>
    </div>
  );
}

function BuildingCard({ info }: { info: BuildingTitleInfo }) {
  const purposeGrade = classifyPurpose(info.mainPurpsCdNm);
  const roofGrade = classifyRoof(info.roofCdNm, info.etcRoof);
  const strctGrade = classifyStructure(info.strctCdNm);
  const years = yearsSince(info.useAprDay);
  const isOld = years != null && years >= NOTEWORTHY_OLD_YEARS;
  const roofLabel = info.etcRoof || info.roofCdNm || "-";
  const structLabel = info.strctCdNm || "-";
  const isAttached = info.mainAtchGbCdNm === "부속건축물";
  const isSkip = purposeGrade === "skip";

  const yardSpacious =
    info.bcRat != null && info.bcRat < LAND_SOLAR_HINT_BCRAT;
  const yeoyuPct =
    info.bcRat != null ? Math.max(0, Math.round(100 - info.bcRat)) : null;
  const roofWarning = roofGrade === "poor" || strctGrade === "poor";

  const hasExtras =
    info.atchBldCnt > 0 ||
    info.oudrAutoUtcnt > 0 ||
    info.hhldCnt > 0 ||
    info.fmlyCnt > 0 ||
    info.hoCnt > 0;
  const hasSiteInfo = info.bcRat != null || info.vlRat != null;
  // 새 상세 영역은 항상 노출 가능한 정보가 있어 hasDetails 대신 buildings.length>0 만 보면 됨.
  void hasExtras;
  void hasSiteInfo;

  // 등급별 영업결론 박스 톤 — skip 은 회색·차분, go/review 는 초록·강조
  const boxBg = isSkip ? "bg-gray-50" : "bg-emerald-50/50";
  const boxLabel = isSkip ? "🏠 주거용" : "☀ 옥상 태양광";
  const boxLabelCls = isSkip ? "text-gray-700" : "text-emerald-900";
  const skipNote = isSkip ? "옥상 태양광 영업 비추천" : null;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      {/* 헤더 — 용도 + 종류 + 부속 + 건물명 + 연식 */}
      <div className="px-3 py-2 flex items-center gap-2 flex-wrap border-b border-gray-100">
        <PurposeBadge grade={purposeGrade}>
          {info.mainPurpsCdNm || "용도불명"}
        </PurposeBadge>
        {info.regstrKindCdNm && (
          <span className="text-[12px] text-gray-500">
            {info.regstrKindCdNm}
          </span>
        )}
        {isAttached && (
          <span
            className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded"
            title="부속건축물 — 영업가치 낮음"
          >
            부속
          </span>
        )}
        {info.bldNm && (
          <span className="text-[13px] text-gray-700 truncate min-w-0">
            {info.bldNm}
          </span>
        )}
        {info.useAprDay && (
          <span className="ml-auto flex items-baseline gap-1 text-[12px] tabular-nums whitespace-nowrap shrink-0">
            <span className="text-gray-500">
              {formatBldgYearMonth(info.useAprDay)}
            </span>
            {years != null && (
              <span
                className={isOld ? "text-red-600 font-bold" : "text-gray-400"}
                title={
                  isOld
                    ? "노후 건물 — 옥상 구조 안전성 별도 검토 권장"
                    : undefined
                }
              >
                {isOld && "⚠ "}
                {years}년차
              </span>
            )}
          </span>
        )}
      </div>

      {/* 영업 결론 — 등급별 톤 분기 (emerald/gray 는 영업매력도 의미, 모드색 violet 과 별개) */}
      <div className={`px-3 py-2.5 ${boxBg}`}>
        <div className="flex items-baseline gap-1.5 mb-1.5 flex-wrap">
          <span
            className={`text-[12px] font-bold tracking-wider uppercase ${boxLabelCls}`}
          >
            {boxLabel}
          </span>
          {skipNote && (
            <span className="text-[12px] text-gray-500">— {skipNote}</span>
          )}
        </div>

        <AreaLine
          arch={info.archArea}
          tot={info.totArea}
          plat={info.platArea}
          dim={isSkip}
        />

        <div className="text-[13px] text-gray-700 flex items-baseline flex-wrap gap-x-2 gap-y-0.5 mt-1.5">
          <span>
            지붕 <span className="text-gray-900 font-medium">{roofLabel}</span>
          </span>
          <span className="text-gray-300">·</span>
          <span>
            구조 <span className="text-gray-900 font-medium">{structLabel}</span>
          </span>
          {info.heit != null && (
            <>
              <span className="text-gray-300">·</span>
              <span className="tabular-nums">
                {info.heit}m / {info.grndFlrCnt}F
                {info.ugrndFlrCnt > 0 && `/B${info.ugrndFlrCnt}`}
              </span>
            </>
          )}
        </div>
        {!isSkip && roofWarning && (
          <div className="mt-1.5 text-[12px] text-amber-700 font-medium">
            ⚠ 지붕/구조 보강 검토 필요
          </div>
        )}
      </div>

      {/* 마당 여유 — go/review 만 노출 */}
      {!isSkip && yardSpacious && yeoyuPct != null && (
        <div className="px-3 py-2 border-t border-emerald-100/60 bg-emerald-50/30 text-[13px] text-emerald-800 font-medium flex items-baseline gap-1.5">
          <span aria-hidden>🌱</span>
          <span>
            마당 여유{" "}
            <span className="font-bold tabular-nums">{yeoyuPct}%</span>
            <span className="text-emerald-700 font-normal">
              {" "}
              — 노지·캐노피 추가 영업 검토
            </span>
          </span>
        </div>
      )}

      {/* 상세 — 접힘 (공매 탭 Section 패턴 미러) */}
      <details className="group border-t border-gray-100">
        <summary className="px-3 py-2 text-[13px] font-medium text-gray-600 cursor-pointer hover:bg-gray-50 select-none flex items-center gap-1.5 list-none">
          <span className="inline-block transition-transform group-open:rotate-90">
            ▸
          </span>
          상세 정보 펼치기
        </summary>
        <div className="px-3 pb-3 pt-1 bg-gray-50/40">
          <BuildingDetailSections info={info} />
        </div>
      </details>
    </div>
  );
}

/**
 * 건축물대장 상세 — 공매 탭 Section 박스 패턴 미러.
 * 카테고리 5종으로 그룹: 분류 / 면적·규모 / 구조·자재 / 시공이력 / 부속·세대 / 식별
 * 각 섹션은 데이터 있을 때만 렌더 (Row 가 모두 빈값이면 섹션 자체 미노출).
 */
function BuildingDetailSections({ info }: { info: BuildingTitleInfo }) {
  const fmtArea = (m2: number | null) => {
    if (m2 == null || !Number.isFinite(m2) || m2 <= 0) return null;
    const py = Math.round((m2 / 3.305785) * 10) / 10;
    return `${m2.toLocaleString()}㎡ (${py.toLocaleString()}평)`;
  };
  const fmtYmd = (s: string | null) => {
    if (!s || s.length < 8) return null;
    return `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}`;
  };

  const archAreaText = fmtArea(info.archArea);
  const totAreaText = info.totArea > 0 ? fmtArea(info.totArea) : null;
  const platAreaText = fmtArea(info.platArea);
  const atchAreaText = info.atchBldArea > 0 ? fmtArea(info.atchBldArea) : null;

  const hasClassification =
    info.mainPurpsCdNm || info.etcPurps || info.regstrKindCdNm || info.mainAtchGbCdNm;
  const hasArea = archAreaText || totAreaText || platAreaText || info.bcRat != null || info.vlRat != null;
  const hasStruct = info.strctCdNm || info.roofCdNm || info.etcRoof || info.heit != null || info.grndFlrCnt > 0;
  const hasHistory = info.useAprDay || info.pmsDay || info.stcnsDay;
  const hasExtras = info.atchBldCnt > 0 || info.oudrAutoUtcnt > 0 || info.hhldCnt > 0 || info.fmlyCnt > 0 || info.hoCnt > 0;

  return (
    /*
     * 자동 반응형 그리드 — 컨테이너 너비에 따라 1↔2 컬럼 자동 전환.
     * - 패널 좁음 (sidebar 기본 폭, < 460px): 1컬럼 (가독성 우선)
     * - 패널 넓음 (확대 풀스크린): 2컬럼 (빈공간 채움)
     * - Section 갯수 가변 (1~6) — 마지막 행 홀수 자동 정렬
     * - minmax(220px, 1fr) = 한 컬럼 최소 220px 보장 → 라벨+값 줄바꿈 방지
     */
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
    >
      {hasClassification && (
        <BSection title="🏷 분류">
          {info.mainPurpsCdNm && <BRow label="주용도" value={info.mainPurpsCdNm} highlight />}
          {info.etcPurps && <BRow label="기타용도" value={info.etcPurps} />}
          {info.regstrKindCdNm && <BRow label="대장종류" value={info.regstrKindCdNm} />}
          {info.mainAtchGbCdNm && (
            <BRow
              label="주부속"
              value={info.mainAtchGbCdNm}
              highlight={info.mainAtchGbCdNm === "부속건축물"}
            />
          )}
        </BSection>
      )}

      {hasArea && (
        <BSection title="📐 면적 · 규모">
          {archAreaText && <BRow label="건축면적" value={archAreaText} highlight />}
          {totAreaText && <BRow label="연면적" value={totAreaText} />}
          {platAreaText && <BRow label="대지면적" value={platAreaText} />}
          {info.bcRat != null && <BRow label="건폐율" value={`${info.bcRat}%`} />}
          {info.vlRat != null && <BRow label="용적률" value={`${info.vlRat}%`} />}
        </BSection>
      )}

      {hasStruct && (
        <BSection title="🏛 구조 · 자재">
          {info.strctCdNm && <BRow label="구조" value={info.strctCdNm} />}
          {info.roofCdNm && (
            <BRow
              label="지붕"
              value={info.etcRoof ? `${info.roofCdNm} (${info.etcRoof})` : info.roofCdNm}
            />
          )}
          {info.heit != null && <BRow label="높이" value={`${info.heit}m`} />}
          {(info.grndFlrCnt > 0 || info.ugrndFlrCnt > 0) && (
            <BRow
              label="층수"
              value={
                `지상 ${info.grndFlrCnt}F` +
                (info.ugrndFlrCnt > 0 ? ` · 지하 ${info.ugrndFlrCnt}F` : "")
              }
            />
          )}
        </BSection>
      )}

      {hasHistory && (
        <BSection title="🗓 시공 이력">
          {info.pmsDay && <BRow label="허가일" value={fmtYmd(info.pmsDay) ?? info.pmsDay} muted />}
          {info.stcnsDay && <BRow label="착공일" value={fmtYmd(info.stcnsDay) ?? info.stcnsDay} muted />}
          {info.useAprDay && <BRow label="사용승인" value={fmtYmd(info.useAprDay) ?? info.useAprDay} />}
        </BSection>
      )}

      {hasExtras && (
        <BSection title="🏘 부속 · 세대">
          {info.atchBldCnt > 0 && (
            <BRow
              label="부속건물"
              value={atchAreaText ? `${info.atchBldCnt}동 · ${atchAreaText}` : `${info.atchBldCnt}동`}
            />
          )}
          {info.oudrAutoUtcnt > 0 && <BRow label="옥외주차" value={`${info.oudrAutoUtcnt}대`} />}
          {info.hhldCnt > 0 && <BRow label="세대" value={`${info.hhldCnt}세대`} />}
          {info.fmlyCnt > 0 && <BRow label="가구" value={`${info.fmlyCnt}가구`} />}
          {info.hoCnt > 0 && <BRow label="호수" value={`${info.hoCnt}`} />}
        </BSection>
      )}

      {(info.mgmBldrgstPk || info.mainPurpsCd) && (
        <BSection title="🆔 식별 정보">
          {info.mgmBldrgstPk && <BRow label="대장PK" value={info.mgmBldrgstPk} mono muted />}
          {info.mainPurpsCd && <BRow label="용도코드" value={info.mainPurpsCd} mono muted />}
        </BSection>
      )}
    </div>
  );
}

/** 공매 OnbidTab Section 패턴 미러 — 필지 탭은 회색 톤. */
/**
 * BSection — 필지 탭 정보 그룹 컨테이너.
 *
 * 모드 색상 = violet (registry.facility 모드와 통일).
 * 다른 탭과 동일한 패턴 (헤더 strip + 박스 본문) — 시각 일관성.
 */
function BSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-violet-100 overflow-hidden">
      <div className="px-2.5 py-1.5 bg-violet-100/40 border-b border-violet-100">
        <div className="text-[12px] font-semibold text-violet-900">{title}</div>
      </div>
      <div className="px-2.5 py-2 bg-violet-50/30">{children}</div>
    </div>
  );
}

function BRow({
  label,
  value,
  highlight,
  mono,
  muted,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2 text-[13px] py-0.5">
      <span className="text-gray-500 w-16 shrink-0">{label}</span>
      <span
        className={`flex-1 min-w-0 ${
          highlight
            ? "text-gray-900 font-semibold"
            : muted
              ? "text-gray-500"
              : "text-gray-800"
        } ${mono ? "font-mono text-[11px] break-all" : ""} tabular-nums`}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * 면적 3종 표시: 건축(메인) + 연면적·대지(보조).
 *  - 건축면적 = 옥상 가용 (메인 강조).
 *  - 연면적 = 다층일 때 건축면적과 다름. 같으면 생략 (1F).
 *  - 대지면적 = 부지 전체. 마당 여유 판단 base.
 *  - dim=true (skip 등급) 면 메인도 톤다운.
 */
function AreaLine({
  arch,
  tot,
  plat,
  dim,
}: {
  arch: number | null;
  tot: number;
  plat: number | null;
  dim?: boolean;
}) {
  if (arch == null && tot <= 0 && plat == null) return null;
  const archPy = arch != null ? toPyeong(arch) : null;
  const showTot = tot > 0 && tot !== arch;

  return (
    <div>
      {arch != null && archPy != null && (
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="text-[10px] text-gray-500">건축</span>
          <span
            className={`text-lg font-bold tabular-nums leading-none ${
              dim ? "text-gray-700" : "text-gray-900"
            }`}
          >
            {archPy.toLocaleString()}
            <span className="text-xs font-semibold text-gray-500 ml-0.5">평</span>
          </span>
          <span className="text-[11px] text-gray-500 tabular-nums">
            ({Math.round(arch).toLocaleString()}㎡)
          </span>
        </div>
      )}
      {(showTot || plat != null) && (
        <div className="flex items-baseline flex-wrap gap-x-2 gap-y-0 text-[10px] text-gray-500 tabular-nums mt-0.5">
          {showTot && (
            <span>
              연면적 {toPyeong(tot).toLocaleString()}평 (
              {Math.round(tot).toLocaleString()}㎡)
            </span>
          )}
          {plat != null && (
            <span>
              대지 {toPyeong(plat).toLocaleString()}평 (
              {Math.round(plat).toLocaleString()}㎡)
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function PurposeBadge({
  grade,
  children,
}: {
  grade: PurposeGrade;
  children: React.ReactNode;
}) {
  const cls =
    grade === "go"
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : grade === "skip"
        ? "bg-gray-100 text-gray-600 border-gray-200"
        : "bg-amber-100 text-amber-800 border-amber-200";
  return (
    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${cls}`}>
      {children}
    </span>
  );
}

function RefreshArrowIcon({
  spinning,
  className,
}: {
  spinning?: boolean;
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className={`${className ?? ""} ${spinning ? "animate-spin" : ""}`}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.023 9.348h4.992V4.356M2.985 19.644v-4.992h4.992m0 0l-3.181-3.183a8.25 8.25 0 0113.803-3.7L19.5 7.5m-15 7.5l4.5-4.5m11.336 1.5a8.25 8.25 0 01-13.803 3.7L4.5 16.5m4.5-4.5h-5"
      />
    </svg>
  );
}

/**
 * 전기 탭 — PNU 만 받아 자체 fetch.
 *
 * 데이터 흐름:
 *   1. 탭 활성 시점 useEffect → fetchKepcoByPnu(pnu) → /api/capa/by-jibun (모듈 캐시)
 *   2. 응답: capa rows + AddrMeta (지번 단위 매칭)
 *   3. 새로고침 — 캐시 비우고 재요청 (KEPCO 크롤 갱신 반영)
 *
 * 진입 모드 무관(전기/공매/견적) — PNU 만 있으면 어디서든 동일하게 작동.
 */
/**
 * 전기 탭 — 2섹터 고정 노출 (2026-05-05 의뢰자 요청 재구성).
 *
 *   ┌─ 해당 지번 ─────────[↻] ─┐
 *   │ 클릭한 지번의 row 표시    │
 *   │ 또는 미수집 → [수집] 버튼  │
 *   ├─ 주변 지번 ─────────[↻] ─┤
 *   │ 같은 마을 가까운 N건       │
 *   │ 또는 미수집 → [목록 불러오기] (TODO) │
 *   │           [전체 수집 →] (TODO) │
 *   └────────────────────────────┘
 *
 * 데이터:
 *   - GET /api/capa/by-pnu 1번 호출. 응답 = 같은 마을 top 10 (자기 포함).
 *   - 클라이언트가 buildPnuFromBjdAndJibun(row) === pnu 비교로 자기/주변 분기.
 *
 * 새로고침:
 *   - 해당 지번: KEPCO live 호출 (refreshKepcoByPnu) → 캐시 invalidate → 재조회
 *   - 주변 지번: 캐시 invalidate → 재조회 (KEPCO 호출 X)
 */
function ElectricTab({
  pnu,
  clickedJibun,
  onPnuChange,
}: {
  pnu: string;
  clickedJibun: string;
  /** 주변 지번 행의 📍 클릭 → 그 지번 PNU 로 패널 자체를 갈아끼움 */
  onPnuChange?: (pnu: string) => void;
}) {
  const [rows, setRows] = useState<KepcoDataRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshingExact, setRefreshingExact] = useState(false);
  const [refreshingNearby, setRefreshingNearby] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  useEffect(() => {
    if (!/^\d{19}$/.test(pnu)) return;
    let alive = true;
    setLoading(true);
    setError(null);
    fetchKepcoByPnu(pnu)
      .then((res) => {
        if (alive) setRows(res.rows);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [pnu]);

  // 자기 / 주변 분기 — buildPnuFromBjdAndJibun 으로 PNU 조립 후 입력 PNU 와 비교.
  // "100-1" / "100-01" 같은 표기 차이도 동일 PNU 로 정규화돼 안전.
  const { exactRows, nearbyRows } = useMemo(() => {
    const exact: KepcoDataRow[] = [];
    const nearby: KepcoDataRow[] = [];
    for (const r of rows) {
      const rowPnu = r.bjd_code
        ? buildPnuFromBjdAndJibun(r.bjd_code, r.addr_jibun)
        : null;
      if (rowPnu && rowPnu === pnu) {
        exact.push(r);
      } else {
        nearby.push(r);
      }
    }
    return { exactRows: exact, nearbyRows: nearby };
  }, [rows, pnu]);

  // 해당 지번 새로고침 = KEPCO live 호출 + DB upsert + 캐시 invalidate.
  const handleRefreshExact = useCallback(async () => {
    if (!/^\d{19}$/.test(pnu)) return;
    setRefreshingExact(true);
    setRefreshError(null);
    try {
      const r = await refreshKepcoByPnu(pnu);
      // refresh 가 캐시 invalidate 했으니, 같은 마을 top N 다시 받아옴.
      const fresh = await fetchKepcoByPnu(pnu);
      setRows(fresh.rows);
      if (r.source === "not_found") {
        setRefreshError("KEPCO 에 데이터 없음");
      }
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshingExact(false);
    }
  }, [pnu]);

  // 주변 지번 새로고침 = 캐시 invalidate + DB 재조회 (KEPCO 호출 X — 안전).
  const handleRefreshNearby = useCallback(async () => {
    if (!/^\d{19}$/.test(pnu)) return;
    setRefreshingNearby(true);
    setError(null);
    clearKepcoByPnuCache(pnu);
    try {
      const res = await fetchKepcoByPnu(pnu);
      setRows(res.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshingNearby(false);
    }
  }, [pnu]);

  // TODO: 마을 전체 지번 목록 불러오기 (KEPCO retrieveAddrGbn) — 별도 phase
  const handleListJibun = useCallback(() => {
    alert("준비 중 — 마을 전체 지번 목록 불러오기");
  }, []);

  // TODO: 마을 전체 일괄 수집 — 오래 걸리므로 별도 phase
  const handleCollectAll = useCallback(() => {
    alert("준비 중 — 마을 전체 일괄 수집");
  }, []);

  // updated_at max — 해당 지번 row 중 가장 최근 확인 시각
  let lastUpdatedIso: string | null = null;
  let lastUpdatedMs = -Infinity;
  for (const row of exactRows) {
    if (!row.updated_at) continue;
    const ms = new Date(row.updated_at).getTime();
    if (Number.isNaN(ms)) continue;
    if (ms > lastUpdatedMs) {
      lastUpdatedMs = ms;
      lastUpdatedIso = row.updated_at;
    }
  }
  const relative = formatRelativeKst(lastUpdatedIso);
  const absolute = formatAbsoluteKst(lastUpdatedIso);

  if (error) {
    return (
      <div className="text-center py-8 text-xs text-red-600">
        조회 실패: {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── 섹터 1: 해당 지번 ────────────────────── */}
      <section className="border border-gray-200 rounded-lg bg-white">
        <SectionHeader
          title="해당 지번"
          subtitle={clickedJibun}
          onRefresh={handleRefreshExact}
          refreshing={refreshingExact}
          refreshTitle="KEPCO 에서 최신 데이터 가져오기"
        />
        <div className="px-3 pb-3">
          {loading ? (
            <div className="flex items-center justify-center py-6 gap-2">
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <div className="text-xs text-gray-500">조회 중...</div>
            </div>
          ) : exactRows.length === 0 ? (
            <div className="py-4 text-center space-y-2">
              <div className="text-xs text-gray-500">
                아직 수집되지 않은 지번입니다.
              </div>
              <button
                type="button"
                onClick={handleRefreshExact}
                disabled={refreshingExact}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs
                           bg-blue-50 text-blue-700 rounded border border-blue-200
                           hover:bg-blue-100 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <RefreshArrowIcon spinning={refreshingExact} className="w-3 h-3" />
                {refreshingExact ? "수집 중..." : "이 지번 수집"}
              </button>
              {refreshError && (
                <div className="text-[11px] text-red-500">{refreshError}</div>
              )}
            </div>
          ) : (
            <>
              <div className="-mx-3">
                <LocationDetailGrouped rows={exactRows} compact />
              </div>
              {relative && (
                <div
                  className="pt-2 text-right text-[10px] text-gray-400"
                  title={absolute || undefined}
                >
                  KEPCO 마지막 확인: {relative}
                </div>
              )}
              {refreshError && (
                <div className="text-[10px] text-red-500 text-right">
                  {refreshError}
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* ── 섹터 2: 주변 지번 ────────────────────── */}
      <section className="border border-gray-200 rounded-lg bg-white">
        <SectionHeader
          title="주변 지번"
          subtitle={nearbyRows.length > 0 ? `${nearbyRows.length}건` : undefined}
          onRefresh={handleRefreshNearby}
          refreshing={refreshingNearby}
          refreshTitle="DB 에서 다시 조회"
        />
        <div className="px-3 pb-3">
          {loading ? (
            <div className="flex items-center justify-center py-6 gap-2">
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <div className="text-xs text-gray-500">조회 중...</div>
            </div>
          ) : nearbyRows.length === 0 ? (
            <div className="py-4 text-center space-y-2">
              <div className="text-xs text-gray-500">
                주변 지번에 수집된 정보가 없습니다.
              </div>
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={handleListJibun}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs
                             bg-blue-50 text-blue-700 rounded border border-blue-200
                             hover:bg-blue-100"
                >
                  지번 목록 불러오기
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="-mx-3 max-h-[55vh] overflow-y-auto">
                <LocationDetailGrouped
                  rows={nearbyRows}
                  compact
                  onJibunPin={(row) => {
                    if (!onPnuChange || !row.addr_jibun || !row.bjd_code) return;
                    const newPnu = buildPnuFromBjdAndJibun(
                      row.bjd_code,
                      row.addr_jibun,
                    );
                    if (newPnu) onPnuChange(newPnu);
                  }}
                />
              </div>
              <div className="pt-2 text-right">
                <button
                  type="button"
                  onClick={handleCollectAll}
                  className="text-[11px] text-gray-500 hover:text-blue-600 underline-offset-2 hover:underline"
                  title="이 마을의 모든 지번을 KEPCO 에서 일괄 수집 (시간 소요)"
                >
                  전체 수집
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

/** 섹터 헤더 — 제목 + 부제(지번/건수) + 새로고침 버튼 */
function SectionHeader({
  title,
  subtitle,
  onRefresh,
  refreshing,
  refreshTitle,
}: {
  title: string;
  subtitle?: string;
  onRefresh: () => void;
  refreshing: boolean;
  refreshTitle: string;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50/60 rounded-t-lg">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-gray-800">{title}</span>
        {subtitle && (
          <span className="text-[11px] text-gray-500">{subtitle}</span>
        )}
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className="text-gray-500 hover:text-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
        title={refreshTitle}
        aria-label="새로고침"
      >
        <RefreshArrowIcon spinning={refreshing} className="w-4 h-4" />
      </button>
    </div>
  );
}

/**
 * 가격 탭 — 영업담당자 시점, 공매탭 카드 패턴 미러 (파랑/회색 분리).
 *
 * 흐름 (위 → 아래):
 *   1. 토지/건물 KindTabs        (영업 가장 먼저 선택)
 *   2. 🔍 필터 (지역/지목·용도)   — 좁히면 모든 카드 동기 갱신
 *   3. 💰 시세 요약 KPI           — 평당가/YoY/추정매매가/건수
 *   4. 📈 가격·거래량 추이 차트    — 라인+IQR+막대 통합
 *   5. 📊 시세 비교 표             — 시군구 / 유사면적⭐ / 최저~최고
 *   6. 📋 거래 사례 리스트         — 직접거래 빨강 + 카드 + 더보기
 *   7. ⚠️ 공시지가 (회색)          — 협상 floor 참고용 (보조)
 *
 * 데이터 흐름:
 *   - 탭 활성 시점 lazy fetch (1 atomic = 클라이언트→서버 1회)
 *   - 서버는 월별 fan-out, 부분 실패 허용
 *   - 필터 변경 시 클라에서 즉시 stats 재계산 (추가 API 호출 0)
 *   - 0건/부분 월 0건 모두 안전 (EmptyTrades 폴백)
 *
 * 토지(land)  default 자동 fetch — 시군구 평당가 시세 (부지 매수 영업)
 * 건물(nrg)   사용자 클릭 시 lazy fetch — 빌딩/오피스 (집합건축물 = 정확 지번)
 */
function PriceTab({
  jibun,
  geometry,
  clickedJibun,
  meta,
}: {
  jibun: JibunInfo;
  geometry: ParcelGeometry | null;
  clickedJibun: string;
  meta: AddrMeta | null;
}) {
  const [kind, setKind] = useState<"land" | "nrg">("land");

  // 클릭한 지번의 읍면동/리 — 드롭다운 자동 선택용.
  // VWorld jibun 우선 (parcel API 가 가장 정확), KEPCO meta 는 보조.
  // 시군구 이름과 같으면 무효 처리 (KEPCO bjd_master 일부 노이즈 방어).
  const rawEmd = (jibun.emd_nm || meta?.sep_3 || "").trim();
  const rawRi = (jibun.li_nm || meta?.sep_4 || "").trim();
  const myEmd = rawEmd && rawEmd !== jibun.sig_nm ? rawEmd : null;
  const myRi = rawRi || null;

  // 지역 필터는 토지/건물 sub-tab 공유 (영업담당자 시점에 같은 개념).
  // 카테고리(지목/용도)는 의미 달라 자식에서 각자 관리.
  const [emdOverride, setEmdOverride] = useState<string | null | undefined>(
    undefined,
  );
  const [riOverride, setRiOverride] = useState<string | null | undefined>(
    undefined,
  );
  const selectedEmd = emdOverride === undefined ? myEmd : emdOverride;
  const selectedRi = riOverride === undefined ? myRi : riOverride;

  const sharedFilter = {
    myEmd,
    myRi,
    selectedEmd,
    selectedRi,
    onEmdChange: (v: string | null) => {
      setEmdOverride(v);
      setRiOverride(null);
    },
    onRiChange: (v: string | null) => setRiOverride(v),
  };

  return (
    <div className="space-y-2.5">
      {/* 토지/건물 탭 — 가격 탭 진입 시 가장 먼저 보이는 분기 */}
      <KindTabs kind={kind} onChange={setKind} />

      {kind === "land" ? (
        <LandSection
          key={`land:${jibun.pnu}`}
          pnu={jibun.pnu}
          jibun={jibun}
          geometry={geometry}
          clickedJibun={clickedJibun}
          shared={sharedFilter}
        />
      ) : (
        <NrgSection
          key={`nrg:${jibun.pnu}`}
          pnu={jibun.pnu}
          jibun={jibun}
          clickedJibun={clickedJibun}
          shared={sharedFilter}
        />
      )}

      {/* 공시지가 — 토지/건물 공통 보조 정보. 회색 카드로 시각 분리 (맨 아래) */}
      {geometry && <JibunInfoSection geometry={geometry} />}
    </div>
  );
}

interface SharedRegionFilter {
  myEmd: string | null;
  myRi: string | null;
  selectedEmd: string | null;
  selectedRi: string | null;
  onEmdChange: (v: string | null) => void;
  onRiChange: (v: string | null) => void;
}

function KindTabs({
  kind,
  onChange,
}: {
  kind: "land" | "nrg";
  onChange: (k: "land" | "nrg") => void;
}) {
  const tabs = [
    { k: "land" as const, label: "토지" },
    { k: "nrg" as const, label: "건물(상업·업무)" },
  ];
  return (
    <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
      {tabs.map((t) => (
        <button
          key={t.k}
          onClick={() => onChange(t.k)}
          className={`flex-1 py-2 text-xs font-bold rounded-md transition-colors ${
            kind === t.k
              ? "bg-white text-blue-700 shadow ring-1 ring-blue-200"
              : "text-gray-600 hover:text-gray-800 hover:bg-white/60"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function LandSection({
  pnu,
  jibun,
  geometry,
  clickedJibun,
  shared,
}: {
  pnu: string;
  jibun: JibunInfo;
  geometry: ParcelGeometry | null;
  clickedJibun: string;
  shared: SharedRegionFilter;
}) {
  const { myEmd, myRi, selectedEmd, selectedRi, onEmdChange, onRiChange } =
    shared;
  const [data, setData] = useState<LandTransactionsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [months, setMonths] = useState(12);
  const [categoryOverride, setCategoryOverride] = useState<
    string | null | undefined
  >(undefined);
  const [visibleCount, setVisibleCount] = useState(5);
  const selectedCategory =
    categoryOverride === undefined ? null : categoryOverride;

  useEffect(() => {
    if (!/^\d{19}$/.test(pnu)) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchLandTransactionsByPnu(pnu, months, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [pnu, months]);

  const myJibun = clickedJibun || jibun.jibun;
  const myArea = geometry?.area_m2 ?? 0;
  const isSimilarArea = (a: number) =>
    myArea > 0 && a >= myArea * 0.5 && a <= myArea * 1.5;
  const sggLabel = `${jibun.ctp_nm} ${jibun.sig_nm}`;

  // 지역만 적용 — 지목 칩 옵션 노출용 (칩 클릭은 자체적으로 더 좁히기)
  const regionFilteredRows = useMemo(() => {
    if (!data) return [];
    return data.rows.filter((r) => {
      const { emd, ri } = splitUmdNm(r.umdNm);
      if (selectedEmd && emd !== selectedEmd) return false;
      if (selectedRi && ri !== selectedRi) return false;
      return true;
    });
  }, [data, selectedEmd, selectedRi]);

  // 모든 필터 적용 — 통계·차트·카드 모두 동기화
  const fullyFilteredRows = useMemo(() => {
    if (selectedCategory == null) return regionFilteredRows;
    return regionFilteredRows.filter(
      (r) => (r.jimok || "(미상)") === selectedCategory,
    );
  }, [regionFilteredRows, selectedCategory]);

  const regionStats = useMemo(
    () => computeLandStats(regionFilteredRows, months),
    [regionFilteredRows, months],
  );
  const displayStats = useMemo(
    () => computeLandStats(fullyFilteredRows, months),
    [fullyFilteredRows, months],
  );

  if (loading && !data) {
    return (
      <div className="text-xs text-gray-500 py-4 text-center">
        토지 실거래가 불러오는 중... (최근 {months}개월)
      </div>
    );
  }
  if (error) {
    return <div className="text-xs text-red-600 py-2">조회 실패: {error}</div>;
  }
  if (!data) return null;

  const directMatches = data.rows.filter((r) => r.jibun === myJibun);
  const { emdOptions, riOptions } = collectUmdRiOptions(
    data.rows,
    selectedEmd,
  );
  const visible = fullyFilteredRows.slice(0, visibleCount);
  const filterLabelParts: string[] = [];
  if (selectedEmd) filterLabelParts.push(selectedEmd);
  if (selectedRi) filterLabelParts.push(selectedRi);
  if (selectedCategory) filterLabelParts.push(selectedCategory);
  const filterLabel =
    filterLabelParts.length > 0 ? filterLabelParts.join(" · ") : null;

  return (
    <div className="space-y-2.5">
      {/* 카드 1 — 필터 (지역/지목). 의뢰자 1번 영업 도구. */}
      <PriceCard title="🔍 필터" subtitle="좁히면 시세·차트·리스트 모두 갱신">
        <FilterPanel
          sggLabel={sggLabel}
          emdOptions={emdOptions}
          riOptions={riOptions}
          selectedEmd={selectedEmd}
          selectedRi={selectedRi}
          myEmd={myEmd}
          myRi={myRi}
          onEmdChange={(v) => {
            onEmdChange(v);
            setVisibleCount(5);
          }}
          onRiChange={(v) => {
            onRiChange(v);
            setVisibleCount(5);
          }}
          categoryItems={regionStats.byCategory}
          selectedCategory={selectedCategory}
          myCategory={geometry?.jimok ?? ""}
          onCategoryChange={(v) => {
            setCategoryOverride(v);
            setVisibleCount(5);
          }}
          categoryLabel="지목"
        />
      </PriceCard>

      {displayStats.total === 0 ? (
        <PriceCard title="💰 시세 요약" subtitle={filterLabel ?? jibun.sig_nm}>
          <EmptyTrades
            months={months}
            kindLabel={filterLabel ? `${filterLabel} 토지` : "토지"}
            canExpand={months < 24}
            onExpand={() => setMonths(24)}
          />
        </PriceCard>
      ) : (
        <>
          {/* 카드 2 — 시세 요약 KPI */}
          <PriceCard
            title="💰 시세 요약"
            subtitle={filterLabel ?? jibun.sig_nm}
          >
            <PriceKpiBar
              stats={displayStats}
              months={months}
              area_m2={geometry?.area_m2 ?? 0}
              kindLabel="토지"
            />
          </PriceCard>

          {/* 카드 3 — 가격·거래량 추이 차트 */}
          <PriceCard
            title="📈 가격·거래량 추이"
            subtitle={`최근 ${months}개월`}
          >
            <PriceTrendChart
              monthly={displayStats.monthly}
              formatYm={formatYmShort}
            />
          </PriceCard>

          {/* 카드 4 — 시세 비교 (협상 근거) */}
          <PriceCard title="📊 시세 비교" subtitle="협상 근거">
            <PriceComparisonTable
              stats={displayStats}
              area_m2={geometry?.area_m2 ?? 0}
              rowsForSimilar={fullyFilteredRows.map((r) => ({
                pricePerPyeong: r.pricePerPyeong,
                area_m2: r.area_m2,
              }))}
            />
          </PriceCard>

          {/* 카드 5 — 거래 사례 */}
          <PriceCard
            title="📋 거래 사례"
            subtitle={filterLabel ?? jibun.sig_nm}
            rightSlot={
              <span className="text-[10px] text-gray-500 tabular-nums font-semibold">
                {visible.length} / {fullyFilteredRows.length}
              </span>
            }
          >
            {directMatches.length > 0 && (
              <div className="mb-2">
                <DirectMatchCardLand rows={directMatches} />
              </div>
            )}
            <div className="space-y-1.5">
              {visible.map((row, i) => (
                <LandTradeRow
                  key={`${row.dealYmd}-${row.jibun}-${i}`}
                  row={row}
                  isMyJibun={row.jibun === myJibun}
                  isSimilarArea={isSimilarArea(row.area_m2)}
                />
              ))}
            </div>
            {fullyFilteredRows.length > visibleCount && (
              <button
                onClick={() => setVisibleCount((v) => v + 5)}
                className="mt-2 w-full py-1.5 text-[11px] text-blue-700 hover:bg-blue-50 rounded border border-blue-200 font-semibold"
              >
                더보기 (+
                {Math.min(5, fullyFilteredRows.length - visibleCount)}건)
              </button>
            )}
            {months < 24 && (
              <button
                onClick={() => setMonths(24)}
                className="mt-1 w-full py-1 text-[10px] text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded"
              >
                24개월로 확장 조회
              </button>
            )}
          </PriceCard>
        </>
      )}
      <div className="text-[10px] text-gray-400 leading-snug px-1">
        출처: 국토부 토지 매매 실거래가 · 평당가 = 거래금액 ÷ (면적×0.3025)
        <br />※ 지번 끝자리는 개인정보 보호로 마스킹(예: <code>3*</code>) —
        시군구 시세 비교 용도
      </div>
    </div>
  );
}

function NrgSection({
  pnu,
  jibun,
  clickedJibun,
  shared,
}: {
  pnu: string;
  jibun: JibunInfo;
  clickedJibun: string;
  shared: SharedRegionFilter;
}) {
  const { myEmd, myRi, selectedEmd, selectedRi, onEmdChange, onRiChange } =
    shared;
  const [data, setData] = useState<NrgTransactionsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [months, setMonths] = useState(12);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(5);

  useEffect(() => {
    if (!/^\d{19}$/.test(pnu)) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchNrgTransactionsByPnu(pnu, months, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [pnu, months]);

  const myJibun = clickedJibun || jibun.jibun;
  const sggLabel = `${jibun.ctp_nm} ${jibun.sig_nm}`;

  const regionFilteredRows = useMemo(() => {
    if (!data) return [];
    return data.rows.filter((r) => {
      const { emd, ri } = splitUmdNm(r.umdNm);
      if (selectedEmd && emd !== selectedEmd) return false;
      if (selectedRi && ri !== selectedRi) return false;
      return true;
    });
  }, [data, selectedEmd, selectedRi]);

  const fullyFilteredRows = useMemo(() => {
    if (selectedCategory == null) return regionFilteredRows;
    return regionFilteredRows.filter(
      (r) => (r.buildingUse || "(미상)") === selectedCategory,
    );
  }, [regionFilteredRows, selectedCategory]);

  const regionStats = useMemo(
    () => computeNrgStats(regionFilteredRows, months),
    [regionFilteredRows, months],
  );
  const displayStats = useMemo(
    () => computeNrgStats(fullyFilteredRows, months),
    [fullyFilteredRows, months],
  );

  if (loading && !data) {
    return (
      <div className="text-xs text-gray-500 py-4 text-center">
        상업·업무용 실거래가 불러오는 중... (최근 {months}개월)
      </div>
    );
  }
  if (error) {
    return <div className="text-xs text-red-600 py-2">조회 실패: {error}</div>;
  }
  if (!data) return null;

  const directMatches = data.rows.filter(
    (r) => r.buildingType === "집합" && r.jibun === myJibun,
  );
  const { emdOptions, riOptions } = collectUmdRiOptions(
    data.rows,
    selectedEmd,
  );
  const visible = fullyFilteredRows.slice(0, visibleCount);
  const filterLabelParts: string[] = [];
  if (selectedEmd) filterLabelParts.push(selectedEmd);
  if (selectedRi) filterLabelParts.push(selectedRi);
  if (selectedCategory) filterLabelParts.push(selectedCategory);
  const filterLabel =
    filterLabelParts.length > 0 ? filterLabelParts.join(" · ") : null;

  return (
    <div className="space-y-2.5">
      {/* 카드 1 — 필터 (지역/용도) */}
      <PriceCard title="🔍 필터" subtitle="좁히면 시세·차트·리스트 모두 갱신">
        <FilterPanel
          sggLabel={sggLabel}
          emdOptions={emdOptions}
          riOptions={riOptions}
          selectedEmd={selectedEmd}
          selectedRi={selectedRi}
          myEmd={myEmd}
          myRi={myRi}
          onEmdChange={(v) => {
            onEmdChange(v);
            setVisibleCount(5);
          }}
          onRiChange={(v) => {
            onRiChange(v);
            setVisibleCount(5);
          }}
          categoryItems={regionStats.byCategory}
          selectedCategory={selectedCategory}
          myCategory=""
          onCategoryChange={(v) => {
            setSelectedCategory(v);
            setVisibleCount(5);
          }}
          categoryLabel="용도"
        />
      </PriceCard>

      {displayStats.total === 0 ? (
        <PriceCard title="💰 시세 요약" subtitle={filterLabel ?? jibun.sig_nm}>
          <EmptyTrades
            months={months}
            kindLabel={filterLabel ? `${filterLabel} 건물` : "건물"}
            canExpand={months < 24}
            onExpand={() => setMonths(24)}
          />
        </PriceCard>
      ) : (
        <>
          {/* 카드 2 — 시세 요약 KPI */}
          <PriceCard
            title="💰 시세 요약"
            subtitle={filterLabel ?? jibun.sig_nm}
          >
            <PriceKpiBar
              stats={displayStats}
              months={months}
              area_m2={0}
              kindLabel="건물"
            />
          </PriceCard>

          {/* 카드 3 — 가격·거래량 추이 차트 */}
          <PriceCard
            title="📈 가격·거래량 추이"
            subtitle={`최근 ${months}개월`}
          >
            <PriceTrendChart
              monthly={displayStats.monthly}
              formatYm={formatYmShort}
            />
          </PriceCard>

          {/* 카드 4 — 시세 비교 */}
          <PriceCard title="📊 시세 비교" subtitle="협상 근거">
            <PriceComparisonTable
              stats={displayStats}
              area_m2={0}
              rowsForSimilar={[]}
            />
          </PriceCard>

          {/* 카드 5 — 거래 사례 */}
          <PriceCard
            title="📋 거래 사례"
            subtitle={filterLabel ?? jibun.sig_nm}
            rightSlot={
              <span className="text-[10px] text-gray-500 tabular-nums font-semibold">
                {visible.length} / {fullyFilteredRows.length}
              </span>
            }
          >
            {directMatches.length > 0 && (
              <div className="mb-2">
                <DirectMatchCardNrg rows={directMatches} />
              </div>
            )}
            <div className="space-y-1.5">
              {visible.map((row, i) => (
                <NrgTradeRow
                  key={`${row.dealYmd}-${row.jibun}-${i}`}
                  row={row}
                  isMyJibun={
                    row.buildingType === "집합" && row.jibun === myJibun
                  }
                />
              ))}
            </div>
            {fullyFilteredRows.length > visibleCount && (
              <button
                onClick={() => setVisibleCount((v) => v + 5)}
                className="mt-2 w-full py-1.5 text-[11px] text-blue-700 hover:bg-blue-50 rounded border border-blue-200 font-semibold"
              >
                더보기 (+
                {Math.min(5, fullyFilteredRows.length - visibleCount)}건)
              </button>
            )}
            {months < 24 && (
              <button
                onClick={() => setMonths(24)}
                className="mt-1 w-full py-1 text-[10px] text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded"
              >
                24개월로 확장 조회
              </button>
            )}
          </PriceCard>
        </>
      )}
      <div className="text-[10px] text-gray-400 leading-snug px-1">
        출처: 국토부 상업·업무용 부동산 매매 · 평당가 = 거래금액 ÷
        (건물면적×0.3025)
        <br />※ <b>집합건축물</b>(빌딩/오피스) = 지번 정확 ·{" "}
        <b>일반건축물</b>(단독상가) = 끝자리 마스킹
        <br />※ 공장/창고는 이 데이터에 미포함 — 토지매매 &ldquo;공장용지&rdquo; 지목 참조
      </div>
    </div>
  );
}

/**
 * 공시지가 카드 — 회색 톤으로 실거래 정보(파랑)와 시각 분리.
 * 정부 발표값 — 협상 floor 참고용 (실거래 시세보다 후순위).
 */
function JibunInfoSection({ geometry }: { geometry: ParcelGeometry }) {
  const hasJiga = geometry.jiga != null && geometry.jiga > 0;
  const pyeongPrice =
    hasJiga && geometry.jiga != null
      ? Math.round(geometry.jiga / M2_TO_PYEONG)
      : null;
  return (
    <PriceCard
      title="⚠️ 공시지가"
      subtitle="정부 발표값 · 협상 floor 참고용"
      accent="gray"
    >
      {!hasJiga || geometry.jiga == null ? (
        <div className="text-xs text-gray-500">공시지가 데이터 없음</div>
      ) : (
        <dl className="space-y-1.5">
          <div className="flex items-baseline gap-2">
            <dt className="text-[11px] w-24 shrink-0 text-gray-600 font-medium">
              공시지가
            </dt>
            <dd className="flex-1 text-xs font-semibold text-gray-800 tabular-nums">
              {geometry.jiga.toLocaleString()}
              <span className="text-[10px] text-gray-500 font-normal ml-0.5">
                원/㎡
              </span>
            </dd>
          </div>
          {pyeongPrice != null && (
            <div className="flex items-baseline gap-2">
              <dt className="text-[11px] w-24 shrink-0 text-gray-600 font-medium">
                평당 환산
              </dt>
              <dd className="flex-1 text-xs font-semibold text-gray-800 tabular-nums">
                ₩{Math.round(pyeongPrice / 10000).toLocaleString()}
                <span className="text-[10px] text-gray-500 font-normal ml-0.5">
                  만/평
                </span>
              </dd>
            </div>
          )}
          <div className="flex items-baseline gap-2">
            <dt className="text-[11px] w-24 shrink-0 text-gray-600 font-medium">
              참고 추정가
            </dt>
            <dd className="flex-1 text-xs font-semibold text-gray-800 tabular-nums">
              ₩
              {Math.round(
                (geometry.jiga * geometry.area_m2) / 10000,
              ).toLocaleString()}
              <span className="text-[10px] text-gray-500 font-normal ml-0.5">
                만 (공시지가 × 면적)
              </span>
            </dd>
          </div>
        </dl>
      )}
    </PriceCard>
  );
}

/**
 * 시세 요약 KPI 띠 — 가격 탭 카드 2 컨텐츠.
 *
 * 영업담당자가 5초 안에 파악:
 *   - 시세 (평당가 중앙값) — 메인 큰 숫자
 *   - YoY 변화율 — "지금 진입할까?" 직답
 *   - 추정 매매가 (시세 × 면적) — 의뢰자가 진짜 알고 싶은 숫자
 *   - 신뢰도: 거래 건수 + 기간
 */
function PriceKpiBar({
  stats,
  months,
  area_m2,
  kindLabel,
}: {
  stats: TradeStats;
  months: number;
  /** 클릭 필지 면적 (㎡) — 추정 매매가 = 시세 × 면적. 0 이면 추정가 안 표시. */
  area_m2: number;
  kindLabel: string;
}) {
  const pricePerPyeong = stats.medianPricePerPyeong;
  const estimatedTotal =
    pricePerPyeong != null && area_m2 > 0
      ? Math.round((pricePerPyeong * area_m2 * M2_TO_PYEONG) / 10000)
      : null;

  return (
    <div className="space-y-2">
      {/* 메인: 시세 평당가 + YoY */}
      {pricePerPyeong != null ? (
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-2xl font-extrabold text-blue-700 tabular-nums leading-tight">
            ₩{Math.round(pricePerPyeong / 10000).toLocaleString()}
            <span className="text-sm font-bold text-blue-700 ml-0.5">
              만/평
            </span>
          </span>
          <span className="text-[11px] text-gray-500 font-medium">
            {kindLabel} 중앙값
          </span>
          {stats.yoy && <YoyBadge yoy={stats.yoy} />}
        </div>
      ) : (
        <div className="text-xs text-gray-500">시세 데이터 없음</div>
      )}

      {/* 보조: 추정 매매가 + 신뢰도 */}
      <div className="flex items-baseline gap-2 flex-wrap text-[11px] text-gray-600 border-t border-gray-100 pt-2">
        {estimatedTotal != null && (
          <>
            <span className="font-medium">추정 매매가</span>
            <span className="text-sm font-bold text-gray-900 tabular-nums">
              ₩{estimatedTotal.toLocaleString()}
              <span className="text-[10px] font-semibold ml-0.5">만</span>
            </span>
            <span className="text-[10px] text-gray-400">(시세 × 면적)</span>
            <span className="text-gray-300">·</span>
          </>
        )}
        <span className="ml-auto text-gray-500 tabular-nums">
          <span className="font-bold text-gray-700">{stats.total}건</span> ·{" "}
          {months}개월
        </span>
      </div>
    </div>
  );
}

/** 전년 동기 대비 (YoY) 배지 — 추세 ▲▼━ */
function YoyBadge({ yoy }: { yoy: NonNullable<TradeStats["yoy"]> }) {
  if (yoy.direction === "flat") {
    return (
      <span
        className="text-[10px] text-gray-500 font-bold tabular-nums px-1.5 py-0.5 bg-gray-100 rounded border border-gray-200"
        title="전년 동기 대비 평당가 거의 변화 없음"
      >
        ━ YoY {Math.abs(yoy.pct)}%
      </span>
    );
  }
  const isUp = yoy.direction === "up";
  const cls = isUp
    ? "text-red-700 bg-red-50 border-red-200"
    : "text-blue-700 bg-blue-50 border-blue-200";
  return (
    <span
      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border tabular-nums ${cls}`}
      title={
        isUp
          ? "전년 동기 대비 ↑ — 토지주 협상력 우위"
          : "전년 동기 대비 ↓ — 매수자 우위"
      }
    >
      {isUp ? "▲" : "▼"} YoY {Math.abs(yoy.pct)}%
    </span>
  );
}

/**
 * 시세 비교 표 — 가격 탭 카드 4 컨텐츠.
 * 영업담당자가 협상 근거로 쓸 4가지 평당가 비교:
 *   - 시군구 중앙값 (필터 적용 후 전체)
 *   - 유사 면적 (±50%) ⭐ 가장 영업적
 *   - 최저~최고 (협상 룸)
 */
function PriceComparisonTable({
  stats,
  area_m2,
  rowsForSimilar,
}: {
  stats: TradeStats;
  area_m2: number;
  rowsForSimilar: ReadonlyArray<{ pricePerPyeong: number; area_m2: number }>;
}) {
  const similarMedian =
    area_m2 > 0
      ? computeSimilarAreaMedian(rowsForSimilar, area_m2)
      : null;

  const fmt = (v: number | null) =>
    v == null
      ? "—"
      : `₩${Math.round(v / 10000).toLocaleString()}만/평`;

  const rows: Array<{
    label: string;
    value: string;
    highlight?: boolean;
    note?: string;
  }> = [
    {
      label: "시군구 중앙값",
      value: fmt(stats.medianPricePerPyeong),
    },
  ];
  if (area_m2 > 0) {
    rows.push({
      label: "⭐ 유사 면적(±50%)",
      value: fmt(similarMedian),
      highlight: true,
      note: "내 필지와 비슷한 면적 거래만",
    });
  }
  if (stats.priceMin != null && stats.priceMax != null) {
    rows.push({
      label: "최저 ~ 최고",
      value: `${fmt(stats.priceMin)} ~ ${fmt(stats.priceMax)}`,
      note: "협상 룸",
    });
  }

  return (
    <dl className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline gap-2">
          <dt
            className={`text-[11px] w-32 shrink-0 ${
              r.highlight
                ? "text-amber-700 font-bold"
                : "text-gray-600 font-medium"
            }`}
          >
            {r.label}
          </dt>
          <dd
            className={`flex-1 min-w-0 text-xs tabular-nums ${
              r.highlight ? "font-bold text-gray-900" : "font-semibold text-gray-800"
            }`}
          >
            {r.value}
            {r.note && (
              <span className="text-[10px] text-gray-400 font-normal ml-1.5">
                ({r.note})
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function EmptyTrades({
  months,
  kindLabel,
  canExpand,
  onExpand,
}: {
  months: number;
  kindLabel: string;
  canExpand: boolean;
  onExpand: () => void;
}) {
  return (
    <div className="py-4 text-center space-y-2">
      <div className="text-xs text-gray-500">
        최근 {months}개월 {kindLabel} 거래 없음
      </div>
      {canExpand && (
        <button
          onClick={onExpand}
          className="text-[11px] px-3 py-1 bg-blue-50 text-blue-700 rounded border border-blue-200 hover:bg-blue-100"
        >
          24개월로 확장
        </button>
      )}
    </div>
  );
}

function DirectMatchCardLand({ rows }: { rows: LandTransaction[] }) {
  return (
    <div className="border border-red-200 bg-red-50/50 rounded-lg p-2.5">
      <div className="text-[10px] font-bold text-red-700 mb-1.5 flex items-center gap-1 flex-wrap">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
        이 지번 직접 거래 {rows.length}건
        <span className="text-red-500 font-normal text-[10px] ml-0.5">
          (협상 근거)
        </span>
      </div>
      <div className="space-y-1">
        {rows.map((r, i) => (
          <div
            key={i}
            className="text-[11px] flex items-baseline gap-1.5 tabular-nums flex-wrap"
          >
            <span className="text-gray-700 font-semibold">
              {formatYmShort(r.dealYmd)}
            </span>
            <span className="text-gray-600">
              {r.area_m2.toLocaleString()}㎡
            </span>
            <span className="text-gray-900 font-semibold ml-auto">
              ₩{(r.price_won / 10000).toLocaleString()}만
            </span>
            <span className="text-red-700 font-bold">
              ₩{Math.round(r.pricePerPyeong / 10000).toLocaleString()}/평
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DirectMatchCardNrg({ rows }: { rows: NrgTransaction[] }) {
  return (
    <div className="border border-red-200 bg-red-50/50 rounded-lg p-2.5">
      <div className="text-[10px] font-bold text-red-700 mb-1.5 flex items-center gap-1 flex-wrap">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
        이 지번 직접 거래 {rows.length}건 (집합건축물)
        <span className="text-red-500 font-normal text-[10px] ml-0.5">
          (협상 근거)
        </span>
      </div>
      <div className="space-y-1">
        {rows.map((r, i) => (
          <div key={i} className="text-[11px] tabular-nums">
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span className="text-gray-700 font-semibold">
                {formatYmShort(r.dealYmd)}
              </span>
              {r.buildingUse && (
                <span className="text-[9px] px-1 py-0.5 bg-white border border-red-200 text-red-700 rounded">
                  {r.buildingUse}
                </span>
              )}
              {r.floor && <span className="text-gray-500">{r.floor}층</span>}
              <span className="ml-auto text-gray-900 font-semibold">
                ₩{(r.price_won / 10000).toLocaleString()}만
              </span>
              <span className="text-red-700 font-bold">
                ₩{Math.round(r.pricePerPyeong / 10000).toLocaleString()}/평
              </span>
            </div>
            <div className="text-[10px] text-gray-500">
              건물 {r.buildingAr.toLocaleString()}㎡
              {r.buildYear && ` · ${r.buildYear}년 준공`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CategoryChips({
  items,
  selected,
  mine,
  onSelect,
}: {
  items: CategoryStats[];
  selected: string | null;
  mine: string;
  onSelect: (category: string | null) => void;
}) {
  return (
    <div className="overflow-x-auto -mx-1 px-1 -my-1 py-1">
      <div className="flex gap-1.5 min-w-min">
        <button
          onClick={() => onSelect(null)}
          className={`text-[10px] px-2 py-1 rounded-full border whitespace-nowrap shrink-0 ${
            selected === null
              ? "bg-gray-900 text-white border-gray-900"
              : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
          }`}
        >
          전체
        </button>
        {items.map((it) => {
          const isSelected = it.category === selected;
          const isMine = mine !== "" && it.category === mine;
          return (
            <button
              key={it.category}
              onClick={() => onSelect(isSelected ? null : it.category)}
              className={`text-[10px] px-2 py-1 rounded-full border whitespace-nowrap shrink-0 tabular-nums ${
                isSelected
                  ? "bg-blue-600 text-white border-blue-600"
                  : isMine
                    ? "bg-amber-50 text-amber-800 border-amber-300 font-semibold"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
              }`}
              title={isMine ? "클릭한 지번과 같은 분류" : undefined}
            >
              {isMine && "⭐"}
              {it.category} ₩
              {Math.round(it.medianPricePerPyeong / 10000).toLocaleString()}/평
              ({it.count})
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LandTradeRow({
  row,
  isMyJibun,
  isSimilarArea,
}: {
  row: LandTransaction;
  isMyJibun: boolean;
  isSimilarArea: boolean;
}) {
  const isCancelled = !!row.cdealDay;
  return (
    <div
      className={`p-2.5 rounded-md border ${
        isMyJibun
          ? "border-red-300 bg-red-50/40"
          : isCancelled
            ? "border-gray-200 bg-gray-50 opacity-70"
            : "border-gray-200 bg-white hover:border-gray-300"
      }`}
    >
      {/* 윗줄: 메타 (날짜/지번/지목/뱃지) ↔ 거래총액 (큼) */}
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="text-xs font-bold text-gray-900 tabular-nums">
          {formatYmShort(row.dealYmd)}
        </span>
        {row.dealDate && (
          <span className="text-[10px] text-gray-500 tabular-nums">
            {row.dealDate.slice(8)}일
          </span>
        )}
        <span className="text-xs text-gray-700 font-mono">
          {row.jibun || "-"}
        </span>
        {row.jimok && (
          <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded font-semibold">
            {row.jimok}
          </span>
        )}
        {isSimilarArea && (
          <span
            className="text-xs text-amber-600 font-bold"
            title="이 필지와 면적 ±50% 이내 — 가격 비교에 가장 유효"
          >
            ⭐
          </span>
        )}
        {isCancelled && (
          <span
            className="text-[10px] px-1 py-0.5 bg-red-100 text-red-700 rounded font-bold"
            title={`${row.cdealType ?? "정정"} ${row.cdealDay}`}
          >
            정정
          </span>
        )}
        {row.shareDealingType && (
          <span
            className="text-[10px] px-1 py-0.5 bg-amber-100 text-amber-700 rounded font-bold"
            title="공유 지분 거래 — 평당가 왜곡 가능"
          >
            공유
          </span>
        )}
        <span className="ml-auto text-sm font-bold text-gray-900 tabular-nums">
          ₩{(row.price_won / 10000).toLocaleString()}
          <span className="text-[11px] font-semibold ml-0.5">만</span>
        </span>
      </div>
      {/* 아랫줄: 면적 ↔ 평당가 (강조) */}
      <div className="flex items-baseline gap-2 mt-1 text-[11px] text-gray-600 tabular-nums">
        <span className="font-medium">
          {row.area_m2.toLocaleString()}㎡{" "}
          <span className="text-gray-500">
            ({Math.round(row.area_m2 * M2_TO_PYEONG).toLocaleString()}평)
          </span>
        </span>
        <span className="ml-auto text-blue-700 font-bold text-xs">
          ₩{Math.round(row.pricePerPyeong / 10000).toLocaleString()}
          <span className="text-[10px] font-semibold ml-0.5">만/평</span>
        </span>
      </div>
      {(row.zoning || row.dealType || row.estateAgentSggNm) && (
        <div className="mt-0.5 text-[10px] text-gray-400 flex flex-wrap gap-x-2">
          {row.zoning && <span>{row.zoning}</span>}
          {row.dealType && <span>{row.dealType}</span>}
          {row.estateAgentSggNm && <span>중개: {row.estateAgentSggNm}</span>}
        </div>
      )}
    </div>
  );
}

function NrgTradeRow({
  row,
  isMyJibun,
}: {
  row: NrgTransaction;
  isMyJibun: boolean;
}) {
  const isCancelled = !!row.cdealDay;
  const ageYears = row.buildYear
    ? new Date().getFullYear() - row.buildYear
    : null;
  return (
    <div
      className={`p-2 rounded border ${
        isMyJibun
          ? "border-red-300 bg-red-50/30"
          : isCancelled
            ? "border-gray-200 bg-gray-50 opacity-70"
            : "border-gray-200 bg-white"
      }`}
    >
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="text-[11px] font-semibold text-gray-800 tabular-nums">
          {formatYmShort(row.dealYmd)}
        </span>
        {row.dealDate && (
          <span className="text-[9px] text-gray-400 tabular-nums">
            {row.dealDate.slice(8)}일
          </span>
        )}
        <span className="text-[11px] text-gray-700 font-mono">
          {row.jibun || "-"}
        </span>
        {row.buildingType === "집합" ? (
          <span
            className="text-[9px] px-1 py-0.5 bg-emerald-100 text-emerald-700 rounded font-semibold"
            title="집합건축물 — 지번 정확"
          >
            집합
          </span>
        ) : (
          <span
            className="text-[9px] px-1 py-0.5 bg-gray-100 text-gray-600 rounded"
            title="일반건축물 — 지번 마스킹"
          >
            일반
          </span>
        )}
        {row.buildingUse && (
          <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded">
            {row.buildingUse}
          </span>
        )}
        {isCancelled && (
          <span
            className="text-[9px] px-1 py-0.5 bg-red-100 text-red-700 rounded font-semibold"
            title={`${row.cdealType ?? "정정"} ${row.cdealDay}`}
          >
            정정
          </span>
        )}
        {row.shareDealingType && (
          <span
            className="text-[9px] px-1 py-0.5 bg-amber-100 text-amber-700 rounded font-semibold"
            title="공유 지분 거래 — 평당가 왜곡 가능"
          >
            공유
          </span>
        )}
        <span className="ml-auto text-[11px] text-gray-900 font-semibold tabular-nums">
          ₩{(row.price_won / 10000).toLocaleString()}만
        </span>
      </div>
      <div className="flex items-baseline gap-2 mt-0.5 text-[10px] text-gray-500 tabular-nums">
        <span>
          건물 {row.buildingAr.toLocaleString()}㎡ (
          {Math.round(row.buildingAr * M2_TO_PYEONG).toLocaleString()}평)
          {row.floor && ` · ${row.floor}층`}
        </span>
        <span className="ml-auto text-gray-700 font-semibold">
          ₩{Math.round(row.pricePerPyeong / 10000).toLocaleString()}만/평
        </span>
      </div>
      <div className="mt-0.5 text-[10px] text-gray-400 flex flex-wrap gap-x-2">
        {row.buildYear && (
          <span
            className={
              ageYears != null && ageYears >= NOTEWORTHY_OLD_YEARS
                ? "text-red-600 font-medium"
                : ""
            }
            title={
              ageYears != null && ageYears >= NOTEWORTHY_OLD_YEARS
                ? "노후 — 옥상 구조 안전성 별도 검토"
                : undefined
            }
          >
            {row.buildYear}년 준공{ageYears != null && ` (${ageYears}년차)`}
          </span>
        )}
        {row.plottageAr && (
          <span>대지 {row.plottageAr.toLocaleString()}㎡</span>
        )}
        {row.zoning && <span>{row.zoning}</span>}
      </div>
      {(row.dealType ||
        row.buyerGbn ||
        row.slerGbn ||
        row.estateAgentSggNm) && (
        <div className="mt-0.5 text-[10px] text-gray-400 flex flex-wrap gap-x-2">
          {row.dealType && <span>{row.dealType}</span>}
          {(row.buyerGbn || row.slerGbn) && (
            <span>
              매수 {row.buyerGbn ?? "-"} ← 매도 {row.slerGbn ?? "-"}
            </span>
          )}
          {row.estateAgentSggNm && <span>중개: {row.estateAgentSggNm}</span>}
        </div>
      )}
    </div>
  );
}

/** "2025-07" → "25.07" (좁은 패널 가독성) */
function formatYmShort(ym: string): string {
  return ym.length >= 7 ? `${ym.slice(2, 4)}.${ym.slice(5, 7)}` : ym;
}

/**
 * RTMS umdNm 분리 — "쌍림면 매촌리" → { emd: "쌍림면", ri: "매촌리" }
 *                  "역삼동"        → { emd: "역삼동", ri: null }
 */
function splitUmdNm(umdNm: string): { emd: string; ri: string | null } {
  const parts = (umdNm || "").trim().split(/\s+/);
  return { emd: parts[0] || "", ri: parts[1] ?? null };
}

/** 응답 rows 에서 읍면 옵션 + (선택된 읍면 한정) 리 옵션 추출 */
function collectUmdRiOptions(
  rows: { umdNm: string }[],
  selectedEmd: string | null,
): { emdOptions: string[]; riOptions: string[] } {
  const emds = new Set<string>();
  const ris = new Set<string>();
  for (const r of rows) {
    const { emd, ri } = splitUmdNm(r.umdNm);
    if (emd) emds.add(emd);
    if (ri && (!selectedEmd || emd === selectedEmd)) ris.add(ri);
  }
  return {
    emdOptions: Array.from(emds).sort(),
    riOptions: Array.from(ris).sort(),
  };
}

/**
 * 읍면/리 드롭다운 필터 — 클라이언트 사이드 필터 (추가 API 호출 0).
 *
 * 도시(공백 0) 시군구는 riOptions 가 자동 0 → 리 드롭다운 자동 숨김.
 * 클릭 지번 sep_3/sep_4 가 옵션에 있으면 ⭐ 표시.
 */
/**
 * 필터 박스 — 시군구(고정) / 읍면동 / 리 드롭다운 3개 한 줄 + 지목·용도 칩.
 * 모든 통계·차트·카드가 이 필터 결과에 동기화.
 */
function FilterPanel({
  sggLabel,
  emdOptions,
  riOptions,
  selectedEmd,
  selectedRi,
  myEmd,
  myRi,
  onEmdChange,
  onRiChange,
  categoryItems,
  selectedCategory,
  myCategory,
  onCategoryChange,
  categoryLabel,
}: {
  sggLabel: string;
  emdOptions: string[];
  riOptions: string[];
  selectedEmd: string | null;
  selectedRi: string | null;
  myEmd: string | null;
  myRi: string | null;
  onEmdChange: (v: string | null) => void;
  onRiChange: (v: string | null) => void;
  categoryItems: CategoryStats[];
  selectedCategory: string | null;
  myCategory: string;
  onCategoryChange: (v: string | null) => void;
  categoryLabel: string;
}) {
  // 응답에 없어도 자동 기본값/사용자 선택값을 옵션에 강제 포함 (select 매칭 보장)
  const emdOptionsDisplay = ensureOption(emdOptions, [myEmd, selectedEmd]);
  const riOptionsDisplay = ensureOption(riOptions, [myRi, selectedRi]);
  const selectCls =
    "text-[11px] px-1.5 py-1 border border-gray-300 rounded bg-white text-gray-700 tabular-nums flex-1 min-w-0";

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-2 space-y-2">
      <div className="flex items-baseline gap-1">
        <span className="text-[10px] font-bold text-gray-600">필터</span>
        <span className="text-[9px] text-gray-400">
          좁힐수록 통계·차트·카드 모두 갱신
        </span>
      </div>
      {/* 드롭다운 3개 — 한 줄 가로 배치 */}
      <div className="flex gap-1.5 items-center">
        <select
          value={sggLabel}
          disabled
          title="시군구는 RTMS API 호출 단위 — 변경 불가"
          className={`${selectCls} disabled:opacity-100 disabled:cursor-not-allowed disabled:text-gray-700 disabled:bg-gray-100`}
        >
          <option value={sggLabel}>{sggLabel}</option>
        </select>
        <select
          value={selectedEmd ?? ""}
          onChange={(e) => onEmdChange(e.target.value || null)}
          className={selectCls}
          title="읍면동"
        >
          <option value="">전체 읍면동</option>
          {emdOptionsDisplay.map((emd) => (
            <option key={emd} value={emd}>
              {emd === myEmd ? "⭐ " : ""}
              {emd}
            </option>
          ))}
        </select>
        <select
          value={selectedRi ?? ""}
          onChange={(e) => onRiChange(e.target.value || null)}
          disabled={!selectedEmd}
          className={`${selectCls} disabled:opacity-50 disabled:cursor-not-allowed disabled:text-gray-400`}
          title={!selectedEmd ? "읍면동을 먼저 선택" : "리"}
        >
          <option value="">전체 리</option>
          {riOptionsDisplay.map((ri) => (
            <option key={ri} value={ri}>
              {ri === myRi ? "⭐ " : ""}
              {ri}
            </option>
          ))}
        </select>
      </div>
      {categoryItems.length > 0 && (
        <div className="flex gap-1.5 items-start">
          <span className="text-[10px] text-gray-500 shrink-0 w-12 mt-1">
            {categoryLabel}
          </span>
          <div className="flex-1 min-w-0">
            <CategoryChips
              items={categoryItems}
              selected={selectedCategory}
              mine={myCategory}
              onSelect={onCategoryChange}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** 옵션 배열에 강제 포함시킬 값 (자동 기본값/사용자 선택값) 추가 */
function ensureOption(
  base: string[],
  extras: (string | null)[],
): string[] {
  const set = new Set(base);
  for (const v of extras) if (v) set.add(v);
  return Array.from(set).sort();
}

function LocationTab({
  pnu,
  areaLabel,
  onSolarMarkers,
  onPnuClick,
}: {
  pnu: string;
  areaLabel: string;
  onSolarMarkers: (markers: SolarMarker[]) => void;
  onPnuClick?: (pnu: string) => void;
}) {
  // 입지 = 지리적 / 주변 정보 (참고용). 인허가 가능성 자체는 RegulationTab.
  return (
    <div className="space-y-4 py-1">
      {/* 1차 — 태양광 발전소 (Storage 'solar-permits' bucket) */}
      <SolarSection
        pnu={pnu}
        areaLabel={areaLabel}
        onMarkers={onSolarMarkers}
        onPnuClick={onPnuClick}
      />

      {/* 향후 — 2차 개발 예정 항목 */}
      <div className="pt-2 border-t border-gray-100">
        <div className="text-[11px] text-gray-400 mb-1.5">2차 개발 예정</div>
        <ul className="text-[11px] text-gray-500 space-y-0.5 pl-3 list-disc">
          <li>취락지구 포함 여부</li>
          <li>주변 도로 거리 (도로 SHP)</li>
        </ul>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────
// 공용 컴포넌트
// ───────────────────────────────────────────

