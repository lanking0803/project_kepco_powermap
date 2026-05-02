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
import { hasCapacity } from "@/lib/types";
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
  type CapaFallback,
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
  type CategoryStats,
  type MonthlyCount,
} from "@/lib/rtms/trade-stats";
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
import { FacilityCard } from "./FacilityCard";
import SolarSection from "./SolarSection";
import type { SolarMarker } from "@/lib/api/solar-permits";
import OnbidTab from "./onbid/OnbidTab";
import RegulationsCard from "@/components/quote/RegulationsCard";

type TabKey = "parcel" | "electric" | "onbid" | "price" | "location" | "regulation";

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
      ? "fixed inset-0 md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[80vw] md:h-[85vh] md:max-w-[1400px] bg-white md:rounded-xl shadow-2xl border border-gray-200 overflow-hidden z-20 flex flex-col transition-all duration-200"
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
              className="text-gray-400 hover:text-gray-600 text-base leading-none w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100"
              aria-label={expanded ? "축소" : "확대"}
              title={expanded ? "원래 크기로" : "크게 보기"}
            >
              {expanded ? "⤣" : "⤢"}
            </button>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-xl leading-none w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100"
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

      <div>
        <div className="text-[10px] md:text-[11px] font-bold text-gray-500 mb-1.5 tracking-wider uppercase">
          건축물대장
        </div>
        {bldgLoading ? (
          <div className="text-xs text-gray-500 py-1">건축물 정보 불러오는 중...</div>
        ) : bldgError ? (
          <div className="text-xs text-red-600 py-1">조회 실패: {bldgError}</div>
        ) : buildings.length === 0 ? (
          <div className="text-xs text-gray-500 py-3 text-center bg-gray-50 rounded border border-dashed border-gray-200">
            등록된 건축물 없음 <span className="text-gray-400">(빈 땅)</span>
          </div>
        ) : (
          <div className="space-y-2">
            {/* 견적 모드 한정: 대장은 있지만 폴리곤 0건 → 도로명주소 미부여 의심 */}
            {polygonCount === 0 && (
              <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-300 rounded px-2 py-1.5 leading-snug">
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
      </div>

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
    <div className="pb-3 border-b border-gray-100">
      <div className="flex items-baseline gap-x-2 gap-y-1 flex-wrap">
        {jimokFull && (
          <span className="text-base md:text-lg font-bold text-gray-900">
            {jimokFull}
          </span>
        )}
        {pyeong != null && geometry && (
          <>
            {jimokFull && <span className="text-gray-300">·</span>}
            <span className="text-xl md:text-2xl font-bold text-gray-900 tabular-nums leading-none">
              {pyeong.toLocaleString()}
              <span className="text-sm font-semibold text-gray-500 ml-0.5">평</span>
            </span>
            <span className="text-[11px] text-gray-500 tabular-nums">
              ({Math.round(geometry.area_m2).toLocaleString()}㎡)
            </span>
          </>
        )}
        {jibun.isSan && (
          <span className="text-[10px] text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded border border-orange-200 font-medium">
            산
          </span>
        )}
        {!geometry && (
          <span className="text-xs text-gray-400">필지 형상 정보 없음</span>
        )}
      </div>
    </div>
  );
}

function ParcelFooter({ jibun }: { jibun: JibunInfo }) {
  return (
    <div className="pt-2 border-t border-gray-100 flex items-center gap-3 text-[10px] text-gray-400 font-mono">
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
  const hasDetails = hasExtras || hasSiteInfo;

  // 등급별 영업결론 박스 톤 — skip 은 회색·차분, go/review 는 초록·강조
  const boxBg = isSkip ? "bg-gray-50" : "bg-emerald-50/50";
  const boxLabel = isSkip ? "🏠 주거용" : "☀ 옥상 태양광";
  const boxLabelCls = isSkip ? "text-gray-700" : "text-emerald-900";
  const skipNote = isSkip ? "옥상 태양광 영업 비추천" : null;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      {/* 헤더 — 용도 + 종류 + 부속 + 건물명 + 연식 */}
      <div className="px-3 py-2 flex items-center gap-1.5 flex-wrap border-b border-gray-100">
        <PurposeBadge grade={purposeGrade}>
          {info.mainPurpsCdNm || "용도불명"}
        </PurposeBadge>
        {info.regstrKindCdNm && (
          <span className="text-[10px] text-gray-500">
            {info.regstrKindCdNm}
          </span>
        )}
        {isAttached && (
          <span
            className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded"
            title="부속건축물 — 영업가치 낮음"
          >
            부속
          </span>
        )}
        {info.bldNm && (
          <span className="text-xs text-gray-700 truncate min-w-0">
            {info.bldNm}
          </span>
        )}
        {info.useAprDay && (
          <span className="ml-auto flex items-baseline gap-1 text-[11px] tabular-nums whitespace-nowrap shrink-0">
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

      {/* 영업 결론 — 등급별 톤 분기 */}
      <div className={`px-3 py-2.5 ${boxBg}`}>
        <div className="flex items-baseline gap-1.5 mb-1.5 flex-wrap">
          <span
            className={`text-[10px] font-bold tracking-wider uppercase ${boxLabelCls}`}
          >
            {boxLabel}
          </span>
          {skipNote && (
            <span className="text-[10px] text-gray-500">— {skipNote}</span>
          )}
        </div>

        <AreaLine
          arch={info.archArea}
          tot={info.totArea}
          plat={info.platArea}
          dim={isSkip}
        />

        <div className="text-[11px] text-gray-700 flex items-baseline flex-wrap gap-x-1.5 gap-y-0.5 mt-1.5">
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
          <div className="mt-1.5 text-[10px] text-amber-700 font-medium">
            ⚠ 지붕/구조 보강 검토 필요
          </div>
        )}
      </div>

      {/* 마당 여유 — go/review 만 노출 */}
      {!isSkip && yardSpacious && yeoyuPct != null && (
        <div className="px-3 py-2 border-t border-emerald-100/60 bg-emerald-50/30 text-[11px] text-emerald-800 font-medium flex items-baseline gap-1.5">
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

      {/* 상세 — 접힘 */}
      {hasDetails && (
        <details className="group border-t border-gray-100">
          <summary className="px-3 py-1.5 text-[11px] text-gray-500 cursor-pointer hover:bg-gray-50 select-none flex items-center gap-1 list-none">
            <span className="inline-block transition-transform group-open:rotate-90">
              ▸
            </span>
            상세
          </summary>
          <dl className="px-3 pb-2 pt-1 space-y-1 text-[11px] bg-gray-50/40">
            {info.bcRat != null && (
              <DetailRow label="건폐율">
                <span className="text-gray-900 tabular-nums">
                  {info.bcRat}%
                </span>
                {info.vlRat != null && info.vlRat !== info.bcRat && (
                  <span className="text-gray-500 tabular-nums">
                    · 용적률 {info.vlRat}%
                  </span>
                )}
              </DetailRow>
            )}
            {info.atchBldCnt > 0 && (
              <DetailRow label="부속건물">
                <span className="text-gray-900 tabular-nums">
                  {info.atchBldCnt}동 (
                  {Math.round(info.atchBldArea).toLocaleString()}㎡)
                </span>
              </DetailRow>
            )}
            {info.oudrAutoUtcnt > 0 && (
              <DetailRow label="옥외주차">
                <span className="text-gray-900 tabular-nums">
                  {info.oudrAutoUtcnt}대
                </span>
              </DetailRow>
            )}
            {(info.hhldCnt > 0 || info.fmlyCnt > 0) && (
              <DetailRow label="세대·가구">
                <span className="text-gray-900 tabular-nums">
                  {info.hhldCnt > 0 && `${info.hhldCnt}세대`}
                  {info.hhldCnt > 0 && info.fmlyCnt > 0 && " · "}
                  {info.fmlyCnt > 0 && `${info.fmlyCnt}가구`}
                </span>
              </DetailRow>
            )}
            {info.hoCnt > 0 && (
              <DetailRow label="호수">
                <span className="text-gray-900 tabular-nums">
                  {info.hoCnt}
                </span>
              </DetailRow>
            )}
          </dl>
        </details>
      )}
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

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-1.5 flex-wrap">
      <dt className="text-gray-500 w-16 shrink-0">{label}</dt>
      <dd className="flex-1 min-w-0 flex items-baseline flex-wrap gap-x-1.5">
        {children}
      </dd>
    </div>
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
function ElectricTab({
  pnu,
  clickedJibun,
  onPnuChange,
}: {
  pnu: string;
  clickedJibun: string;
  /** fallback 결과 행의 📍 클릭 → 그 지번 PNU 로 패널 자체를 갈아끼움 */
  onPnuChange?: (pnu: string) => void;
}) {
  const [capa, setCapa] = useState<KepcoDataRow[]>([]);
  const [fallback, setFallback] = useState<CapaFallback>({ used: false });
  // villageEmpty = 같은 마을(bjd_code) 전체에 한전 데이터 0건 — fallback 도 못 만드는 케이스.
  // exact 매칭 0건 + fallback 도 0건일 때만 true.
  const [villageEmpty, setVillageEmpty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  // 같은 PNU 재방문 시 모듈 캐시 hit 으로 즉시 표시. 첫 진입에만 스피너.
  useEffect(() => {
    if (!/^\d{19}$/.test(pnu)) return;
    let alive = true;
    setLoading(true);
    setError(null);
    fetchKepcoByPnu(pnu)
      .then((res) => {
        if (alive) {
          setCapa(res.rows);
          setFallback(res.fallback);
          setVillageEmpty(res.villageEmpty);
        }
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

  // 새로고침 = KEPCO live 호출 + DB upsert (POST /api/capa/refresh-by-pnu).
  // 단순 캐시 비우고 DB 재조회가 아니라, 외부 KEPCO 시스템에서 최신 데이터를 끌어옴.
  // 응답이 모듈 캐시에 반영되어 이후 다른 곳의 fetchKepcoByPnu 도 즉시 새 데이터 hit.
  const handleRefresh = useCallback(async () => {
    if (!/^\d{19}$/.test(pnu)) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const r = await refreshKepcoByPnu(pnu);
      setCapa(r.rows);
      // refresh = KEPCO live 호출이라 exact 매칭 결과만 — fallback/villageEmpty 해제
      setFallback({ used: false });
      setVillageEmpty(false);
      if (r.source === "not_found") {
        setRefreshError("KEPCO 에 데이터 없음");
      }
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, [pnu]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <div className="text-xs text-gray-500">전기 정보 조회 중...</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-center py-8 text-xs text-red-600">
        조회 실패: {error}
      </div>
    );
  }

  if (capa.length === 0) {
    // villageEmpty = 같은 마을 전체에 한전 데이터 0건 → fallback 도 못 만드는 케이스.
    // 사용자가 "왜 주변 지번 정보도 안 뜨지?" 헷갈리지 않도록 별도 멘트.
    if (villageEmpty) {
      return (
        <div className="py-6 px-4 space-y-3">
          <div className="bg-gray-50 border border-gray-200 rounded-md px-3 py-3 text-xs text-gray-700 leading-relaxed space-y-1.5">
            <div className="font-semibold text-gray-900">
              이 마을 전체에 한전 용량 정보가 없습니다
            </div>
            <div>
              한전이 이 마을(리)에 대한 데이터를 보유하고 있지 않아
              <br />
              주변 지번의 참고 정보도 표시할 수 없습니다.
            </div>
            <div className="text-[11px] text-gray-500 pt-1">
              산악·해안 변두리 지역에서 종종 발생합니다. 정확한 용량은
              아래 한전 시스템에서 직접 확인해 주세요.
            </div>
          </div>
          <div className="text-center">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs
                         bg-blue-50 text-blue-700 rounded border border-blue-200
                         hover:bg-blue-100 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <RefreshArrowIcon spinning={refreshing} className="w-3 h-3" />
              {refreshing ? "KEPCO 조회 중..." : "KEPCO 에서 지금 확인"}
            </button>
            {refreshError && (
              <div className="text-[11px] text-red-500 mt-2">{refreshError}</div>
            )}
          </div>
        </div>
      );
    }

    // exact 0건 + RPC 도 호출 못 했거나 예외 (jibun 추출 실패 등) — 기존 멘트 유지
    return (
      <div className="py-6 text-center space-y-3">
        <div className="text-sm text-gray-500">
          이 지번({clickedJibun})에 매칭된 KEPCO 용량 정보가 없습니다.
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs
                     bg-blue-50 text-blue-700 rounded border border-blue-200
                     hover:bg-blue-100 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <RefreshArrowIcon spinning={refreshing} className="w-3 h-3" />
          {refreshing ? "KEPCO 조회 중..." : "KEPCO 에서 지금 확인"}
        </button>
        {refreshError && (
          <div className="text-[11px] text-red-500">{refreshError}</div>
        )}
      </div>
    );
  }

  // ── fallback 응답 = 같은 마을의 가까운 지번 top N (의뢰자 결정 2026-05-01)
  // 마을검색 모달의 LocationDetailGrouped 컴포넌트 그대로 재사용 —
  // 변전소/주변압기/배전선로 그룹화 + 번지 + 시설별 잔여 용량 칼럼 한 줄 표시 + 펼침.
  // 정렬/검색/필터/펼침 등 모든 동작이 이미 완성됨.
  if (fallback.used) {
    return (
      <div className="space-y-2">
        <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-900 leading-relaxed">
          이 지번(<b>{fallback.target_jibun}</b>)은 매칭 정보가 없어
          같은 마을의 가까운 지번 <b>{capa.length}건</b>을 표시합니다.
        </div>
        {/* 길어질 경우 자동 스크롤 — 화면 절반 정도까지만 노출 */}
        <div className="-mx-4 max-h-[55vh] overflow-y-auto">
          <LocationDetailGrouped
            rows={capa}
            compact
            onJibunPin={(row) => {
              if (!onPnuChange || !row.addr_jibun || !row.bjd_code) return;
              const newPnu = buildPnuFromBjdAndJibun(row.bjd_code, row.addr_jibun);
              if (newPnu) onPnuChange(newPnu);
            }}
          />
        </div>
      </div>
    );
  }

  // capa row 별로 updated_at 이 갈라질 수 있음 (분할 저장 경계).
  // "이 데이터셋에서 가장 최근 확인 시각" 의미로 max 를 사용.
  // ISO 사전식 비교 대신 Date 변환 비교 (offset 차이에도 안전).
  let lastUpdatedIso: string | null = null;
  let lastUpdatedMs = -Infinity;
  for (const row of capa) {
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

  return (
    <div className="space-y-3">
      {capa.map((row, i) => (
        <div key={row.id ?? i} className="space-y-1.5">
          {capa.length > 1 && (
            <div className="text-[11px] text-gray-500 font-medium">
              세트 {i + 1} / {capa.length}
            </div>
          )}
          <FacilityCard
            title="변전소"
            name={row.subst_nm ?? "-"}
            ok={hasCapacity(row.subst_capa, row.subst_pwr, row.g_subst_capa)}
            base={row.subst_capa}
            received={row.subst_pwr}
            planned={row.g_subst_capa}
          />
          <FacilityCard
            title="주변압기"
            name={`#${row.mtr_no ?? "-"}`}
            ok={hasCapacity(row.mtr_capa, row.mtr_pwr, row.g_mtr_capa)}
            base={row.mtr_capa}
            received={row.mtr_pwr}
            planned={row.g_mtr_capa}
          />
          <FacilityCard
            title="배전선로"
            name={row.dl_nm ?? "-"}
            ok={hasCapacity(row.dl_capa, row.dl_pwr, row.g_dl_capa)}
            base={row.dl_capa}
            received={row.dl_pwr}
            planned={row.g_dl_capa}
          />
        </div>
      ))}
      {relative && (
        <div
          className="pt-1.5 text-right text-[10px] text-gray-400 flex items-center justify-end gap-1.5"
          title={absolute || undefined}
        >
          <span>KEPCO 마지막 확인: {relative}</span>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-gray-500 hover:text-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            title="KEPCO 에서 최신 데이터 가져오기"
            aria-label="새로고침"
          >
            <RefreshArrowIcon spinning={refreshing} className="w-4 h-4" />
          </button>
        </div>
      )}
      {refreshError && (
        <div className="text-[10px] text-red-500 text-right">{refreshError}</div>
      )}
    </div>
  );
}

/**
 * 가격탭 — 영업담당자 시점.
 *
 * 정보 흐름:
 *   1. 공시지가 + 추정가 (parcel API 에서 받은 값)
 *   2. TL;DR — 시군구 단위 최근 N개월 거래 건수 + 평당가 중앙값 + 추세 ▲▼
 *   3. Sparkline — 월별 거래 건수 (시장 활성도)
 *   4. 같은 지번 직접 거래 (있을 때만, 빨강 강조 — 협상 근거)
 *   5. 지목별 칩 — 클릭한 지번 지목 자동 강조 + 필터
 *   6. 거래 카드 리스트 — 면적 유사(±50%) ⭐ 표시 + 더보기
 *
 * 데이터 흐름:
 *   - 탭 활성 시점 lazy fetch (1 atomic = 클라이언트→서버 1회)
 *   - 서버는 12회 fan-out (월별), 부분 실패 허용 (월별 catch)
 *   - 0건/일부 월 0건 모두 안전 (UI 폴백)
 */
/**
 * 가격탭 — 토지/건물 sub-tab 분리 (영업담당자 시점).
 *
 * 정보 단위 시각 구분:
 *   📍 이 지번 단위  — 공시지가/추정가 (parcel/by-pnu, VWorld)
 *   📊 시군구 단위    — 실거래가 시세 (transactions/by-bjd, RTMS)
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
    <div className="space-y-3">
      {/* 📍 이 지번 단위 정보 */}
      {geometry && <JibunInfoSection geometry={geometry} />}

      {/* 📊 시군구 단위 시세 */}
      <div className="border-t border-gray-200 pt-3 space-y-3">
        <SectionHeader
          icon="📊"
          title="시군구 단위 시세"
          subtitle={`${jibun.sig_nm} 전체 거래 비교`}
        />
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
      </div>
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

function SectionHeader({
  icon,
  title,
  subtitle,
}: {
  icon: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[12px]">{icon}</span>
      <span className="text-[11px] font-bold text-gray-700">{title}</span>
      {subtitle && (
        <span className="text-[10px] text-gray-400 truncate">— {subtitle}</span>
      )}
    </div>
  );
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
    <div className="flex gap-1 p-0.5 bg-gray-100 rounded-lg">
      {tabs.map((t) => (
        <button
          key={t.k}
          onClick={() => onChange(t.k)}
          className={`flex-1 py-1.5 text-[11px] font-semibold rounded-md transition-colors ${
            kind === t.k
              ? "bg-white text-blue-700 shadow-sm"
              : "text-gray-500 hover:text-gray-700"
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
    <div className="space-y-3">
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

      <PriceTLDR
        region={filterLabel ?? jibun.sig_nm}
        months={months}
        stats={displayStats}
        kindLabel="토지 거래"
      />

      {displayStats.total === 0 ? (
        <EmptyTrades
          months={months}
          kindLabel={filterLabel ? `${filterLabel} 토지` : "토지"}
          canExpand={months < 24}
          onExpand={() => setMonths(24)}
        />
      ) : (
        <>
          <Sparkline data={displayStats.monthly} />
          {directMatches.length > 0 && (
            <DirectMatchCardLand rows={directMatches} />
          )}
          <TradeListHeader
            label="최근 거래"
            filterLabel={filterLabel}
            visibleCount={visible.length}
            totalCount={fullyFilteredRows.length}
          />
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
              className="w-full py-1.5 text-[11px] text-blue-600 hover:bg-blue-50 rounded border border-blue-200"
            >
              더보기 (+
              {Math.min(5, fullyFilteredRows.length - visibleCount)}건)
            </button>
          )}
          {months < 24 && (
            <button
              onClick={() => setMonths(24)}
              className="w-full py-1 text-[10px] text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded"
            >
              24개월로 확장 조회
            </button>
          )}
        </>
      )}
      <div className="text-[10px] text-gray-400 leading-snug">
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
    <div className="space-y-3">
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

      <PriceTLDR
        region={filterLabel ?? jibun.sig_nm}
        months={months}
        stats={displayStats}
        kindLabel="건물 거래"
      />

      {displayStats.total === 0 ? (
        <EmptyTrades
          months={months}
          kindLabel={filterLabel ? `${filterLabel} 건물` : "건물"}
          canExpand={months < 24}
          onExpand={() => setMonths(24)}
        />
      ) : (
        <>
          <Sparkline data={displayStats.monthly} />
          {directMatches.length > 0 && (
            <DirectMatchCardNrg rows={directMatches} />
          )}
          <TradeListHeader
            label="최근 거래"
            filterLabel={filterLabel}
            visibleCount={visible.length}
            totalCount={fullyFilteredRows.length}
          />
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
              className="w-full py-1.5 text-[11px] text-blue-600 hover:bg-blue-50 rounded border border-blue-200"
            >
              더보기 (+
              {Math.min(5, fullyFilteredRows.length - visibleCount)}건)
            </button>
          )}
          {months < 24 && (
            <button
              onClick={() => setMonths(24)}
              className="w-full py-1 text-[10px] text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded"
            >
              24개월로 확장 조회
            </button>
          )}
        </>
      )}
      <div className="text-[10px] text-gray-400 leading-snug">
        출처: 국토부 상업·업무용 부동산 매매 · 평당가 = 거래금액 ÷
        (건물면적×0.3025)
        <br />※ <b>집합건축물</b>(빌딩/오피스) = 지번 정확 ·{" "}
        <b>일반건축물</b>(단독상가) = 끝자리 마스킹
        <br />※ 공장/창고는 이 데이터에 미포함 — 토지매매 "공장용지" 지목 참조
      </div>
    </div>
  );
}

function TradeListHeader({
  label,
  filterLabel,
  visibleCount,
  totalCount,
}: {
  label: string;
  filterLabel: string | null;
  visibleCount: number;
  totalCount: number;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <div className="text-[11px] font-semibold text-gray-700">
        {label}
        {filterLabel && (
          <span className="text-gray-500 font-normal ml-1">
            ({filterLabel}만)
          </span>
        )}
      </div>
      <div className="text-[10px] text-gray-400 tabular-nums">
        {visibleCount} / {totalCount}
      </div>
    </div>
  );
}

function JibunInfoSection({ geometry }: { geometry: ParcelGeometry }) {
  const hasJiga = geometry.jiga != null && geometry.jiga > 0;
  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-2.5">
      <SectionHeader
        icon="📍"
        title="이 지번 정보"
        subtitle="공시지가 (개별, 원/㎡)"
      />
      {!hasJiga || geometry.jiga == null ? (
        <div className="text-[11px] text-gray-500 mt-1.5">
          공시지가 데이터 없음
        </div>
      ) : (
        <dl className="space-y-1 mt-1.5">
          <Row label="공시지가">
            <span className="text-gray-900 tabular-nums text-xs font-semibold">
              {geometry.jiga.toLocaleString()}원/㎡
            </span>
          </Row>
          <Row label="추정가">
            <span className="text-gray-900 tabular-nums text-xs">
              {Math.round(
                (geometry.jiga * geometry.area_m2) / 10000,
              ).toLocaleString()}
              만원
            </span>
            <span className="text-gray-400 text-[10px] ml-1.5">
              (공시지가×면적)
            </span>
          </Row>
        </dl>
      )}
    </div>
  );
}

function PriceTLDR({
  region,
  months,
  stats,
  kindLabel,
}: {
  region: string;
  months: number;
  stats: TradeStats;
  kindLabel: string;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="text-[10px] text-gray-500">최근 {months}개월</span>
        <span className="text-[10px] text-gray-400">·</span>
        <span className="text-[11px] text-gray-700 font-medium truncate">
          {region}
        </span>
        <span className="text-[10px] text-gray-400">시군구 단위</span>
        <span className="ml-auto text-sm font-bold text-blue-700 tabular-nums">
          {stats.total}건
        </span>
      </div>
      {stats.medianPricePerPyeong != null ? (
        <div className="mt-1 flex items-baseline gap-2 flex-wrap">
          <span className="text-base font-bold text-gray-900 tabular-nums">
            ₩{Math.round(stats.medianPricePerPyeong / 10000).toLocaleString()}만/평
          </span>
          <span className="text-[10px] text-gray-500">{kindLabel} 중앙값</span>
          {stats.trend && <TrendBadge trend={stats.trend} />}
        </div>
      ) : null}
    </div>
  );
}

function TrendBadge({
  trend,
}: {
  trend: NonNullable<TradeStats["trend"]>;
}) {
  if (trend.direction === "flat") {
    return (
      <span
        className="text-[10px] text-gray-500 font-medium tabular-nums"
        title="최근 6개월 vs 그 전 6개월 평당가 변화"
      >
        ━ {Math.abs(trend.pct)}%
      </span>
    );
  }
  const isUp = trend.direction === "up";
  const cls = isUp
    ? "text-red-600 bg-red-50 border-red-200"
    : "text-blue-600 bg-blue-50 border-blue-200";
  return (
    <span
      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border tabular-nums ${cls}`}
      title={
        isUp
          ? "최근 6개월 vs 그 전 6개월 — 오름세 (토지주 협상력 ↑)"
          : "최근 6개월 vs 그 전 6개월 — 내림세 (매수자 우위)"
      }
    >
      {isUp ? "▲" : "▼"} {Math.abs(trend.pct)}%
    </span>
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

function Sparkline({ data }: { data: MonthlyCount[] }) {
  if (data.length === 0) return null;
  const max = Math.max(1, ...data.map((d) => d.count));
  const W = 100;
  const H = 24;
  const gap = 0.6;
  const barW = (W - gap * (data.length - 1)) / data.length;

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-12 block"
        preserveAspectRatio="none"
      >
        {data.map((d, i) => {
          const h = d.count === 0 ? 0.6 : (d.count / max) * H;
          const x = i * (barW + gap);
          const y = H - h;
          const isLast = i === data.length - 1;
          return (
            <rect
              key={d.ym}
              x={x}
              y={y}
              width={barW}
              height={h}
              fill={
                d.count === 0 ? "#e5e7eb" : isLast ? "#2563eb" : "#93c5fd"
              }
            />
          );
        })}
      </svg>
      <div className="flex justify-between text-[9px] text-gray-400 mt-0.5 tabular-nums">
        <span>{formatYmShort(data[0].ym)}</span>
        <span>월별 거래 건수</span>
        <span>{formatYmShort(data[data.length - 1].ym)}</span>
      </div>
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
        {row.jimok && (
          <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
            {row.jimok}
          </span>
        )}
        {isSimilarArea && (
          <span
            className="text-[10px] text-amber-700 font-bold"
            title="이 필지와 면적 ±50% 이내 — 가격 비교에 가장 유효"
          >
            ⭐
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
          {row.area_m2.toLocaleString()}㎡ (
          {Math.round(row.area_m2 * M2_TO_PYEONG).toLocaleString()}평)
        </span>
        <span className="ml-auto text-gray-700 font-semibold">
          ₩{Math.round(row.pricePerPyeong / 10000).toLocaleString()}만/평
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="text-gray-500 text-xs w-16 shrink-0 mt-0.5">{label}</dt>
      <dd className="flex-1 min-w-0">{children}</dd>
    </div>
  );
}

function ComingSoon() {
  return (
    <div className="text-sm text-gray-500 py-6 text-center">
      2차 개발 예정 기능입니다.
    </div>
  );
}
