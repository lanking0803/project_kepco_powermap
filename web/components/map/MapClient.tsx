"use client";

/**
 * MapClient — 지도 base.
 *
 * 책임:
 *   - 마커 데이터 로딩 (/api/map-summary)
 *   - 지도/검색/필터/측정/GPS/로드뷰/지적도/새로고침/공유 등 base 기능
 *
 * 인터랙션 흐름 (마을 마커 클릭 / 지번 클릭 / 좌표 클릭 → 패널) 은
 * atomic endpoints (/api/capa/by-bjd, /api/capa/by-jibun, /api/parcel/by-pnu,
 * /api/parcel/by-latlng, /api/polygon/by-bjd) 로 새로 채울 자리.
 * 본 파일에서는 callback stub 만 둔다.
 */

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useIsMobile } from "@/lib/useIsMobile";
import KakaoMap from "./KakaoMap";
import Sidebar from "./Sidebar";
import MapToolbar from "./MapToolbar";
import DistanceTool from "./DistanceTool";
import type { SearchPick } from "./SearchResultList";
import Toast from "./Toast";
import TopRemainingList from "./TopRemainingList";
import GpsTracker from "./GpsTracker";
import RoadviewPanel from "./RoadviewPanel";
import type { OnbidListItem } from "@/lib/onbid/types";
import {
  groupOnbidItemsByVillage,
  type OnbidVillageGroup,
} from "@/lib/onbid/group";
import OnbidVillageCard from "./onbid/OnbidVillageCard";
import OnbidVillageModal from "./onbid/OnbidVillageModal";
import LocationSummaryCard from "./LocationSummaryCard";
import LocationDetailModal from "./LocationDetailModal";
import ParcelInfoPanel from "./ParcelInfoPanel";
import type { SolarMarker } from "@/lib/api/solar-permits";
import PatentWatermark from "./PatentWatermark";
import type { JibunInfo, ParcelGeometry } from "@/lib/vworld/parcel";
import { buildPnuFromBjdAndJibun } from "@/lib/geo/pnu";
import {
  fetchKepcoSummaryByBjdCode,
  fetchKepcoCapaByBjdCode,
  fetchKepcoCapaByJibun,
  clearKepcoCapaCache,
} from "@/lib/api/kepco";
import {
  fetchVworldParcelByPnu,
  fetchVworldParcelByLatLng,
  fetchVworldAdminPolygonByBjdCode,
} from "@/lib/api/vworld";
import { enrichKepcoCapaRowsWithVillageInfo } from "@/lib/api/enrich";
import { refreshKepcoCapaByJibun } from "@/lib/kepco-live/refresh-by-jibun";
import {
  emptyFilters,
  type ColumnFilters,
  type MapSummaryRow,
  type MarkerColor,
  type KepcoDataRow,
  type KepcoCapaSummary,
  type AddrMeta,
} from "@/lib/types";

interface Props {
  isAdmin: boolean;
  email: string;
}

// 새로고침 (refreshParcelCapa) 관련 — 같은 지번 연속 갱신 / 토스트 표시 시간
const REFRESH_COOLDOWN_SEC = 60;
const REFRESH_ERROR_TOAST_MS = 3000;

export default function MapClient({ isAdmin, email }: Props) {
  // ───────────────────────────── 데이터 ─────────────────────────────
  const [allRows, setAllRows] = useState<MapSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch("/api/map-summary", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setAllRows(d.rows ?? []))
      .catch(() => setError("지도 데이터를 불러오지 못했어요."))
      .finally(() => setLoading(false));
  }, []);

  // ─────────────────── 새로고침 (MV refresh → map-summary) ───────────────────
  const [refreshing, setRefreshing] = useState(false);
  const [refreshPhase, setRefreshPhase] = useState("");
  const [simpleToast, setSimpleToast] = useState<string | null>(null);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setRefreshPhase("데이터 집계 중...");
      const mv = await fetch("/api/refresh-mv", { method: "POST" });
      if (!mv.ok) throw new Error("MV 갱신 실패");
      const mvJson = (await mv.json()) as { skipped?: boolean };

      setRefreshPhase("지도 데이터 불러오는 중...");
      const r = await fetch(`/api/map-summary?_t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error("새로고침 실패");
      const data = await r.json();
      setAllRows(data.rows ?? []);
      // KEPCO 용량 캐시 비움 (크롤이 갱신했으므로). VWorld 필지/폴리곤은 그대로 유지.
      clearKepcoCapaCache();
      setSimpleToast(
        mvJson.skipped
          ? "최근에 갱신된 데이터를 불러왔습니다."
          : "최신 데이터로 갱신되었습니다."
      );
    } catch {
      setSimpleToast("새로고침에 실패했습니다.");
    } finally {
      setRefreshing(false);
      setRefreshPhase("");
    }
  }, []);

  // ───────────────────────────── 필터 ─────────────────────────────
  const [filters, setFilters] = useState<ColumnFilters>(emptyFilters());
  const [colorFilter] = useState<Set<MarkerColor>>(
    new Set(["red", "yellow", "green", "blue"])
  );
  const [mapFilteredAddrs, setMapFilteredAddrs] = useState<Set<string> | null>(
    null
  );
  const [mapFilterSource, setMapFilterSource] = useState<
    "search" | "filter" | "compare" | null
  >(null);
  const [panelResetKey, setPanelResetKey] = useState(0);
  const [toast, setToast] = useState<{
    message: string;
    snapshot: ColumnFilters;
  } | null>(null);

  const clearMapFilter = useCallback(() => {
    setMapFilteredAddrs(null);
    setMapFilterSource(null);
    setPanelResetKey((k) => k + 1);
  }, []);
  const applyMapFilter = useCallback(
    (addrs: Set<string>, source: "search" | "filter" | "compare") => {
      setMapFilteredAddrs(addrs);
      setMapFilterSource(source);
    },
    []
  );

  // ───────────────────────────── 지도 ─────────────────────────────
  const [mapInstance, setMapInstance] = useState<any>(null);
  const [mapType, setMapType] = useState<"roadmap" | "skyview" | "hybrid">(
    "roadmap"
  );
  const [zoomLevel, setZoomLevel] = useState<number | undefined>(undefined);
  const [fitBoundsKey] = useState(0);
  const [centerMessage, setCenterMessage] = useState<string | null>(null);

  // 카카오맵 줌 변경 → MapToolbar 의 줌 레벨 숫자 표시 동기화
  useEffect(() => {
    if (!mapInstance) return;
    setZoomLevel(mapInstance.getLevel());
    const handler = () => setZoomLevel(mapInstance.getLevel());
    window.kakao.maps.event.addListener(mapInstance, "zoom_changed", handler);
    return () => {
      window.kakao.maps.event.removeListener(mapInstance, "zoom_changed", handler);
    };
  }, [mapInstance]);

  // ─────────────────────────── UI / 모바일 ───────────────────────────
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [topListOpen, setTopListOpen] = useState(false);

  const mobileInitRef = useRef(false);
  useEffect(() => {
    if (isMobile && !mobileInitRef.current) {
      setSidebarOpen(false);
      mobileInitRef.current = true;
    }
  }, [isMobile]);

  // ─────────────────── 도구: 측정 / GPS / 지적도 / 로드뷰 ───────────────────
  const [measureActive, setMeasureActive] = useState(false);
  const measureAddPointRef = useRef<((latlng: any) => void) | null>(null);
  const registerMeasureAddPoint = useCallback(
    (fn: ((latlng: any) => void) | null) => {
      measureAddPointRef.current = fn;
    },
    []
  );

  const [gpsActive, setGpsActive] = useState(false);
  const [gpsAutoFollow, setGpsAutoFollow] = useState(true);

  const [cadastralActive, setCadastralActive] = useState(false);
  const handleToggleCadastral = useCallback(() => {
    setCadastralActive((v) => !v);
    const level = mapInstance?.getLevel?.();
    if (!cadastralActive && level != null && level > 5) {
      setSimpleToast("지적편집도는 지도를 더 확대해야 잘 보입니다");
    }
  }, [mapInstance, cadastralActive]);

  // 데이터 모드 (전기 ↔ 공매, 상호 전환). 디폴트 = 전기 (onbidActive=false).
  const [onbidActive, setOnbidActive] = useState(false);
  /** 검색 결과 매물. 사이드바 검색폼이 /api/onbid/search 호출로 채움. */
  const [onbidItems, setOnbidItems] = useState<OnbidListItem[]>([]);
  /** 빨간 마을 마커 클릭으로 선택된 그룹 — OnbidVillageCard 표시 출처 */
  const [selectedOnbidVillage, setSelectedOnbidVillage] =
    useState<OnbidVillageGroup | null>(null);
  /** [매물 N건 보기] 클릭 시 OnbidVillageModal 표시 토글 */
  const [onbidModalOpen, setOnbidModalOpen] = useState(false);
  /** 매물 → 마을 그룹화 결과. 지도 마커 표시 + Card/Modal 데이터 출처. */
  const onbidVillages = useMemo(
    () => groupOnbidItemsByVillage(onbidItems),
    [onbidItems],
  );
  const setOnbidMode = useCallback((next: boolean) => {
    setOnbidActive(next);
    // 모드 전환 시 결과 비움 — 사용자가 검색 버튼 눌러서 채우는 흐름
    if (!next) setOnbidItems([]);
    setSelectedOnbidVillage(null);
    setOnbidModalOpen(false);
  }, []);

  const [roadviewActive, setRoadviewActive] = useState(false);
  const [roadviewPosition, setRoadviewPosition] = useState<{
    lat: number;
    lng: number;
    pan?: number;
  } | null>(null);
  const handleToggleRoadview = useCallback(() => {
    setRoadviewActive((v) => {
      const next = !v;
      if (!next) setRoadviewPosition(null);
      return next;
    });
  }, []);
  const handleRoadviewClick = useCallback((lat: number, lng: number) => {
    setRoadviewPosition({ lat, lng });
  }, []);
  const handleRoadviewClose = useCallback(() => {
    setRoadviewActive(false);
    setRoadviewPosition(null);
  }, []);

  const desktopRoadviewSplit = !!roadviewPosition && !isMobile;
  useEffect(() => {
    if (!mapInstance) return;
    const t = setTimeout(() => mapInstance.relayout(), 350);
    return () => clearTimeout(t);
  }, [sidebarOpen, mapInstance, desktopRoadviewSplit]);

  // ─────────────── 마을 클릭 → /api/capa/summary-by-bjd ───────────────
  // 카드는 시설별 여유/부족 집계만 필요 → summary 만 받음 (~80B, raw rows 30KB 대비 99% 절감).
  // 모달용 raw rows 는 "상세 목록 보기" 클릭 시 lazy fetch (rows / rowsLoading / rowsError).
  // 주소/좌표는 MapSummaryRow (markerRow) 에 이미 있으므로 그것을 통째로 보관.
  interface SelectedVillage {
    bjdCode: string;
    markerRow: MapSummaryRow;          // 카드 헤더 주소 (addr_do/si/.../li) + 좌표
    summary: KepcoCapaSummary | null;  // 시설별 여유/부족 집계
    loading: boolean;                  // summary 로딩 상태
    error: string | null;
    rows: KepcoDataRow[] | null;       // 모달 raw rows (null = 아직 fetch 안 함)
    rowsLoading: boolean;
    rowsError: string | null;
  }
  const [selectedVillage, setSelectedVillage] = useState<SelectedVillage | null>(
    null,
  );
  const [villagePolygon, setVillagePolygon] = useState<number[][][] | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const villageReqSeqRef = useRef(0);
  const villageAbortRef = useRef<AbortController | null>(null);
  // 지번 상세 패널 close 핸들러 — 마을 클릭 시 우선 닫기 위해 ref 로 forward.
  const closeParcelPanelRef = useRef<(() => void) | null>(null);

  const openVillagePanelOnMarkerClick = useCallback(
    async (row: MapSummaryRow) => {
      // 지번 상세 패널이 떠있으면 닫고 마을 카드로 전환 (UI 액션 우선순위: 새 마을 > 기존 지번)
      closeParcelPanelRef.current?.();
      // 이전 in-flight fetch 취소 (연타 시 네트워크 비용 절약)
      villageAbortRef.current?.abort();
      const controller = new AbortController();
      villageAbortRef.current = controller;
      const seq = ++villageReqSeqRef.current;
      setSelectedVillage({
        bjdCode: row.bjd_code,
        markerRow: row,
        summary: null,
        loading: true,
        error: null,
        rows: null,
        rowsLoading: false,
        rowsError: null,
      });
      // KEPCO 카드 집계 + VWorld 행정구역 폴리곤 병렬. allSettled — 폴리곤 실패해도 카드는 표시.
      const [summaryResult, polygonResult] = await Promise.allSettled([
        fetchKepcoSummaryByBjdCode(row.bjd_code, { signal: controller.signal }),
        fetchVworldAdminPolygonByBjdCode(row.bjd_code, {
          signal: controller.signal,
        }),
      ]);
      if (seq !== villageReqSeqRef.current) return;

      // summary 처리
      if (summaryResult.status === "fulfilled") {
        setSelectedVillage({
          bjdCode: row.bjd_code,
          markerRow: row,
          summary: summaryResult.value,
          loading: false,
          error: null,
          rows: null,
          rowsLoading: false,
          rowsError: null,
        });
      } else {
        const err = summaryResult.reason as Error;
        if (err.name === "AbortError") return; // 새 클릭으로 취소
        setSelectedVillage({
          bjdCode: row.bjd_code,
          markerRow: row,
          summary: null,
          loading: false,
          error: String(err.message ?? err),
          rows: null,
          rowsLoading: false,
          rowsError: null,
        });
      }

      // polygon 처리 — 실패는 시각 보조라 조용히 (음영만 안 그려짐)
      if (polygonResult.status === "fulfilled") {
        setVillagePolygon(
          (polygonResult.value?.polygon as number[][][] | undefined) ?? null,
        );
      } else {
        setVillagePolygon(null);
      }
    },
    [],
  );

  // "상세 목록 보기" 클릭 — 모달 즉시 열고 raw rows lazy fetch.
  // 같은 마을 재오픈 시 lib/api/kepco 모듈 캐시 hit → 네트워크 0회.
  const openVillageDetailModal = useCallback(async () => {
    setDetailModalOpen(true);
    // 현재 selectedVillage 스냅샷 — 비동기 중 다른 마을로 바뀌면 stale 결과 반영 X
    const target = selectedVillage;
    if (!target || target.rows !== null || target.rowsLoading) return;

    setSelectedVillage((prev) =>
      prev && prev.bjdCode === target.bjdCode
        ? { ...prev, rowsLoading: true, rowsError: null }
        : prev,
    );

    try {
      const raw = await fetchKepcoCapaByBjdCode(target.bjdCode);
      const enriched = enrichKepcoCapaRowsWithVillageInfo(raw, [target.markerRow]);
      setSelectedVillage((prev) =>
        prev && prev.bjdCode === target.bjdCode
          ? { ...prev, rows: enriched, rowsLoading: false }
          : prev,
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setSelectedVillage((prev) =>
        prev && prev.bjdCode === target.bjdCode
          ? {
              ...prev,
              rowsLoading: false,
              rowsError: String((err as Error).message ?? err),
            }
          : prev,
      );
    }
  }, [selectedVillage]);

  const closeVillagePanel = useCallback(() => {
    villageReqSeqRef.current++;
    villageAbortRef.current?.abort();
    setSelectedVillage(null);
    setVillagePolygon(null);
    setDetailModalOpen(false);
  }, []);

  // ─────────────── 지번 클릭 → /api/parcel/by-pnu + /api/capa/by-jibun ───────────────
  // PNU 직접 구성 (lib/geo/pnu) → VWorld + KEPCO 병렬 조회. exact-only.
  const [selectedJibun, setSelectedJibun] = useState<JibunInfo | null>(null);
  // 입지 탭 활성 시 SolarSection 이 응답에서 추출한 좌표 보유 발전소 리스트.
  // 패널 닫힘/탭 이동 시 [] 로 리셋 → KakaoMap 가 마커 정리.
  const [solarMarkers, setSolarMarkers] = useState<SolarMarker[]>([]);
  const [selectedGeometry, setSelectedGeometry] = useState<ParcelGeometry | null>(
    null,
  );
  const [parcelCapa, setParcelCapa] = useState<KepcoDataRow[]>([]);
  const [parcelMeta, setParcelMeta] = useState<AddrMeta | null>(null);
  const [parcelClickedJibun, setParcelClickedJibun] = useState<string>("");
  const [parcelLoading, setParcelLoading] = useState(false);
  /** 공매 모드에서 진입했는지 — ParcelInfoPanel [공매] 탭 디폴트 활성 여부 */
  const [parcelOpenedFromOnbid, setParcelOpenedFromOnbid] = useState(false);
  const parcelReqSeqRef = useRef(0);
  const parcelAbortRef = useRef<AbortController | null>(null);
  // 새로고침 상태 — 사용자가 ElectricTab 의 새로고침 아이콘 클릭 시
  const [refreshingCapa, setRefreshingCapa] = useState(false);
  const [refreshCapaError, setRefreshCapaError] = useState<string | null>(null);
  const refreshErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openParcelPanelOnJibunClick = useCallback(
    async (row: KepcoDataRow) => {
      const pnu = buildPnuFromBjdAndJibun(row.bjd_code, row.addr_jibun);
      if (!pnu) {
        setSimpleToast("지번 정보가 부족해 PNU 를 만들 수 없어요.");
        return;
      }
      setDetailModalOpen(false);
      // 이전 in-flight fetch 취소 (연타 시 절약)
      parcelAbortRef.current?.abort();
      const controller = new AbortController();
      parcelAbortRef.current = controller;
      const seq = ++parcelReqSeqRef.current;
      setParcelLoading(true);
      setSelectedJibun(null);
      setSelectedGeometry(null);
      setParcelCapa([]);
      setParcelMeta(null);
      setParcelClickedJibun(row.addr_jibun ?? "");
      // 이전 카드의 새로고침 잔재 정리 (영구 disabled 방지)
      setRefreshingCapa(false);
      setRefreshCapaError(null);
      try {
        // 마을 폴리곤 — 같은 BJD 의 행정구역 테두리. 마을 마커 흐름과 동일 함수 재사용.
        // fire-and-forget: 폴리곤 실패는 시각 보조라 조용히 무시. lib 캐시 (BJD 키) 가 있어
        // 이미 그려진 마을이면 추가 API 호출 0 — 새 BJD 첫 방문 시에만 1회 호출.
        fetchVworldAdminPolygonByBjdCode(row.bjd_code, {
          signal: controller.signal,
        })
          .then((r) => {
            if (seq !== parcelReqSeqRef.current) return;
            setVillagePolygon(
              (r?.polygon as number[][][] | undefined) ?? null,
            );
          })
          .catch(() => {});

        const [parcelResult, capaResult] = await Promise.all([
          fetchVworldParcelByPnu(pnu, { signal: controller.signal }),
          fetchKepcoCapaByJibun(row.bjd_code, row.addr_jibun ?? "", {
            signal: controller.signal,
          }),
        ]);
        if (seq !== parcelReqSeqRef.current) return;
        if (!parcelResult) {
          setSimpleToast(`⚠️ ${row.addr_jibun} 필지 정보를 찾을 수 없어요`);
          return;
        }
        setSelectedJibun(parcelResult.jibun);
        setSelectedGeometry(parcelResult.geometry);
        setParcelCapa(capaResult.rows);
        setParcelMeta(capaResult.meta);
        const c = parcelResult.geometry.center;
        if (c?.lat != null) moveMapToRef.current?.(c.lat, c.lng);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        if (seq === parcelReqSeqRef.current) {
          setSimpleToast(`⚠️ ${row.addr_jibun} 조회 중 오류가 발생했어요`);
        }
      } finally {
        if (seq === parcelReqSeqRef.current) setParcelLoading(false);
      }
    },
    [],
  );

  const closeParcelPanel = useCallback(() => {
    parcelReqSeqRef.current++;
    parcelAbortRef.current?.abort();
    setSelectedJibun(null);
    setSelectedGeometry(null);
    setParcelCapa([]);
    setParcelMeta(null);
    setParcelClickedJibun("");
    setParcelLoading(false);
    setParcelOpenedFromOnbid(false);
    setSolarMarkers([]);
    if (refreshErrorTimerRef.current) {
      clearTimeout(refreshErrorTimerRef.current);
      refreshErrorTimerRef.current = null;
    }
    setRefreshCapaError(null);
    setRefreshingCapa(false);
  }, []);

  /** 빨간 inline 메시지 3초 페이드 (cooldown / not_found / error 공용). */
  const flashRefreshError = useCallback((msg: string) => {
    if (refreshErrorTimerRef.current) clearTimeout(refreshErrorTimerRef.current);
    setRefreshCapaError(msg);
    refreshErrorTimerRef.current = setTimeout(
      () => setRefreshCapaError(null),
      REFRESH_ERROR_TOAST_MS,
    );
  }, []);

  /** 새로고침 — 현재 카드의 bjd_code+jibun 으로 KEPCO live 호출 + kepco_capa upsert. */
  const refreshParcelCapa = useCallback(async () => {
    if (refreshingCapa) return;
    const bjdCode =
      parcelCapa[0]?.bjd_code ??
      (selectedJibun?.pnu ? selectedJibun.pnu.slice(0, 10) : null);
    const jibun = parcelClickedJibun;
    const addr = parcelMeta
      ? [parcelMeta.sep_1, parcelMeta.sep_2, parcelMeta.sep_3, parcelMeta.sep_4, parcelMeta.sep_5, jibun]
          .filter(Boolean)
          .join(" ")
      : undefined;
    if (!jibun || (!bjdCode && !addr)) {
      flashRefreshError("새로고침 정보 부족");
      return;
    }

    // 쿨다운 — 최근 갱신된 데이터면 KEPCO 호출 무시 (불필요 부하 방지)
    const lastUpdated = parcelCapa[0]?.updated_at;
    if (lastUpdated) {
      const ageSec = (Date.now() - new Date(lastUpdated).getTime()) / 1000;
      if (ageSec < REFRESH_COOLDOWN_SEC) {
        const remain = Math.max(1, Math.ceil(REFRESH_COOLDOWN_SEC - ageSec));
        flashRefreshError(`방금 갱신됨 — ${remain}초 후 다시 시도`);
        return;
      }
    }

    if (refreshErrorTimerRef.current) {
      clearTimeout(refreshErrorTimerRef.current);
      refreshErrorTimerRef.current = null;
    }
    const mySeq = parcelReqSeqRef.current;
    setRefreshingCapa(true);
    setRefreshCapaError(null);

    const r = await refreshKepcoCapaByJibun({
      addr,
      bjd_code: bjdCode ?? undefined,
      jibun,
    });

    // 카드가 닫혔거나 다른 지번으로 바뀌었으면 응답 폐기 (state 변경 X)
    if (mySeq !== parcelReqSeqRef.current) return;

    setRefreshingCapa(false);
    if (r.ok) {
      setParcelCapa(r.rows ?? []);
      if (r.source === "not_found") flashRefreshError("KEPCO 에 데이터 없음");
    } else {
      flashRefreshError(r.error ?? "조회 실패");
    }
  }, [
    refreshingCapa,
    parcelCapa,
    parcelMeta,
    parcelClickedJibun,
    selectedJibun,
    flashRefreshError,
  ]);

  useEffect(() => {
    closeParcelPanelRef.current = closeParcelPanel;
  }, [closeParcelPanel]);

  // moveMapTo 가 아래에 정의되므로 ref 우회 (forward use)
  const moveMapToRef = useRef<((lat: number, lng: number) => void) | null>(
    null,
  );
  // 공통 지도 이동 — 줌은 사용자가 더 가까이 본 상태면 유지 (강제로 멀어지지 않음)
  const DETAIL_ZOOM_LEVEL = 7;
  const moveMapTo = useCallback(
    (lat: number, lng: number, level: number = DETAIL_ZOOM_LEVEL) => {
      if (!mapInstance) return;
      const pos = new window.kakao.maps.LatLng(lat, lng);
      const currentLevel = mapInstance.getLevel();
      if (currentLevel > level) {
        mapInstance.setLevel(level);
        requestAnimationFrame(() => mapInstance.panTo(pos));
      } else {
        mapInstance.panTo(pos);
      }
    },
    [mapInstance],
  );
  // 위에서 정의한 openParcelPanelOnJibunClick 가 useRef 로 참조 (forward use)
  useEffect(() => {
    moveMapToRef.current = moveMapTo;
  }, [moveMapTo]);

  // 검색 결과 클릭 — ri (마을) → 마을 흐름, ji (지번) → 지번 흐름 으로 분기
  const handleSearchResultPick = useCallback(
    async (pick: SearchPick) => {
      if (pick.kind === "ri") {
        // SearchRiResult 에 bjd_code 가 없어 allRows (MapSummaryRow) 에서 매칭
        const village = allRows.find(
          (v) => v.geocode_address === pick.row.geocode_address,
        );
        if (!village) {
          setSimpleToast("이 마을 위치를 지도에서 찾을 수 없어요.");
          return;
        }
        if (mapFilteredAddrs && !mapFilteredAddrs.has(village.geocode_address)) {
          clearMapFilter();
        }
        if (gpsActive && gpsAutoFollow) setGpsAutoFollow(false);
        if (village.lat != null && village.lng != null) {
          moveMapTo(village.lat, village.lng);
        }
        await openVillagePanelOnMarkerClick(village);
      } else {
        // ji — KepcoDataRow (Sidebar 가 enrich 한 상태). 지번 흐름으로
        if (pick.row.lat != null && pick.row.lng != null) {
          moveMapTo(pick.row.lat, pick.row.lng);
        }
        await openParcelPanelOnJibunClick(pick.row);
      }
    },
    [
      allRows,
      mapFilteredAddrs,
      clearMapFilter,
      gpsActive,
      gpsAutoFollow,
      moveMapTo,
      openVillagePanelOnMarkerClick,
      openParcelPanelOnJibunClick,
    ],
  );

  // TOP 유망부지 클릭 — MapSummaryRow 이므로 마커 클릭과 동일
  const handleTopRankingPick = useCallback(
    async (row: MapSummaryRow) => {
      if (row.lat != null && row.lng != null) moveMapTo(row.lat, row.lng);
      await openVillagePanelOnMarkerClick(row);
    },
    [moveMapTo, openVillagePanelOnMarkerClick],
  );

  // 공매 매물 카드 클릭 (Modal) — 매물의 PNU 로 VWorld + KEPCO 병렬 조회.
  // 결과는 ParcelInfoPanel 로 흘러가 [공매] 탭이 디폴트 활성됨 (defaultOnbidTab).
  const openParcelPanelOnOnbidItemClick = useCallback(
    async (onbid: OnbidListItem) => {
      const pnu = onbid.ltnoPnu;
      if (!pnu || !/^\d{19}$/.test(pnu)) {
        setSimpleToast("이 매물의 PNU 가 유효하지 않습니다.");
        return;
      }
      // 모달/카드 정리
      setOnbidModalOpen(false);
      setSelectedOnbidVillage(null);
      // 마을 패널/모달 정리
      villageReqSeqRef.current++;
      villageAbortRef.current?.abort();
      setSelectedVillage(null);
      setVillagePolygon(null);
      setDetailModalOpen(false);

      parcelAbortRef.current?.abort();
      const controller = new AbortController();
      parcelAbortRef.current = controller;
      const seq = ++parcelReqSeqRef.current;
      setParcelLoading(true);
      setSelectedJibun(null);
      setSelectedGeometry(null);
      setParcelCapa([]);
      setParcelMeta(null);
      setParcelClickedJibun("");
      setParcelOpenedFromOnbid(true);
      setRefreshingCapa(false);
      setRefreshCapaError(null);
      try {
        const bjdCode = pnu.slice(0, 10);
        const [parcelResult, capaResult] = await Promise.all([
          fetchVworldParcelByPnu(pnu, { signal: controller.signal }),
          fetchKepcoCapaByBjdCode(bjdCode, { signal: controller.signal }).catch(
            () => [] as KepcoDataRow[],
          ),
        ]);
        if (seq !== parcelReqSeqRef.current) return;
        if (!parcelResult) {
          setSimpleToast(`⚠️ 매물 필지 정보를 찾을 수 없어요`);
          return;
        }
        setSelectedJibun(parcelResult.jibun);
        setSelectedGeometry(parcelResult.geometry);
        setParcelCapa(Array.isArray(capaResult) ? capaResult : []);
        setParcelClickedJibun(parcelResult.jibun.jibun);
        const c = parcelResult.geometry.center;
        if (c?.lat != null) moveMapToRef.current?.(c.lat, c.lng);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        if (seq === parcelReqSeqRef.current) {
          setSimpleToast("매물 조회 중 오류가 발생했어요");
        }
      } finally {
        if (seq === parcelReqSeqRef.current) setParcelLoading(false);
      }
    },
    [],
  );

  // 공매 마을 마커 클릭 — 동 폴리곤 음영 + OnbidVillageCard 표시.
  // 전기와 동일한 폴리곤 호출 재활용. 매물 데이터는 이미 그룹에 있음 (별도 fetch 없음).
  const openOnbidVillage = useCallback(
    async (key: string) => {
      const group = onbidVillages.find((g) => g.key === key);
      if (!group) return;

      // 다른 패널들 정리
      villageReqSeqRef.current++;
      villageAbortRef.current?.abort();
      setSelectedVillage(null);
      setDetailModalOpen(false);
      // 지번 패널 닫기 (열려있으면)
      closeParcelPanelRef.current?.();

      setSelectedOnbidVillage(group);
      moveMapToRef.current?.(group.lat, group.lng);

      // 동 폴리곤 — 매물 PNU 앞 10자리 (모두 동일 동이라 첫 매물 사용).
      const firstPnu = group.items[0]?.ltnoPnu;
      if (firstPnu && /^\d{19}$/.test(firstPnu)) {
        const bjdCode = firstPnu.slice(0, 10);
        try {
          const polyRes = await fetchVworldAdminPolygonByBjdCode(bjdCode);
          setVillagePolygon(
            (polyRes?.polygon as number[][][] | undefined) ?? null,
          );
        } catch {
          setVillagePolygon(null);
        }
      }
    },
    [onbidVillages],
  );

  const closeOnbidVillage = useCallback(() => {
    setSelectedOnbidVillage(null);
    setOnbidModalOpen(false);
    setVillagePolygon(null);
  }, []);

  // 지도 좌표 클릭 (좌표 → 필지). VWorld 가 BBOX → point-in-polygon 으로 정확 1필지 선별.
  // 응답 jibun.pnu 의 앞 10자리가 bjd_code → 그것으로 KEPCO 용량 추가 호출 (직렬, PNU dependency).
  // 지번 클릭과 parcelAbortRef/parcelReqSeqRef 공유 (지번 패널이 한 개라 동일 race 가드).
  const openParcelPanelOnMapClick = useCallback(
    async (lat: number, lng: number) => {
      parcelAbortRef.current?.abort();
      const controller = new AbortController();
      parcelAbortRef.current = controller;
      const seq = ++parcelReqSeqRef.current;
      setParcelLoading(true);
      setSelectedJibun(null);
      setSelectedGeometry(null);
      setParcelCapa([]);
      setParcelMeta(null);
      setParcelClickedJibun("");
      try {
        const parcel = await fetchVworldParcelByLatLng(lat, lng, {
          signal: controller.signal,
        });
        if (seq !== parcelReqSeqRef.current) return;
        if (!parcel) {
          setSimpleToast("이 위치에 필지가 없습니다 (바다/산 등)");
          return;
        }
        const bjdCode = parcel.jibun.pnu.slice(0, 10);
        setParcelClickedJibun(parcel.jibun.jibun);
        const capaResult = await fetchKepcoCapaByJibun(
          bjdCode,
          parcel.jibun.jibun,
          { signal: controller.signal },
        );
        if (seq !== parcelReqSeqRef.current) return;
        setSelectedJibun(parcel.jibun);
        setSelectedGeometry(parcel.geometry);
        setParcelCapa(capaResult.rows);
        setParcelMeta(capaResult.meta);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        if (seq === parcelReqSeqRef.current) {
          setSimpleToast("필지 조회 중 오류가 발생했어요");
        }
      } finally {
        if (seq === parcelReqSeqRef.current) setParcelLoading(false);
      }
    },
    [],
  );

  // ─────────────────────── 공유 / 줌 ───────────────────────
  const handleShare = useCallback(() => {
    if (!mapInstance) return;
    const center = mapInstance.getCenter();
    const params = new URLSearchParams();
    params.set("lat", center.getLat().toFixed(6));
    params.set("lng", center.getLng().toFixed(6));
    params.set("zoom", String(mapInstance.getLevel()));
    const filterKeys: (keyof ColumnFilters)[] = [
      "addr_do",
      "addr_gu",
      "addr_dong",
      "addr_li",
      "subst_nm",
      "dl_nm",
      "cap_subst",
      "cap_mtr",
      "cap_dl",
    ];
    for (const k of filterKeys) {
      const s = filters[k];
      if (s.size > 0) params.set(k, [...s].join(","));
    }
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    navigator.clipboard
      .writeText(url)
      .then(() => setSimpleToast("링크가 복사되었습니다"))
      .catch(() => setSimpleToast("링크 복사에 실패했어요"));
  }, [mapInstance, filters]);

  // ─────────────────────────── render ───────────────────────────
  return (
    <div className="flex h-dvh overflow-hidden relative">
      {/* Sidebar — 헤더/푸터 공통, 콘텐츠만 모드별 분기 (전기 = 탭 / 공매 = 검색폼) */}
      <Sidebar
        isAdmin={isAdmin}
        email={email}
        totalRows={allRows}
        filters={filters}
        onFiltersChange={setFilters}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        onSearchPick={handleSearchResultPick}
        onJibunPin={openParcelPanelOnJibunClick}
        onSearchFocus={() => {
          /* TODO: 검색 포커스 시 선택 마을 해제 */
        }}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        selectedAddr={null}
        onMapFilter={applyMapFilter}
        onClearMapFilter={clearMapFilter}
        panelResetKey={panelResetKey}
        onbidActive={onbidActive}
        onOnbidResults={setOnbidItems}
        onOnbidItemClick={openParcelPanelOnOnbidItemClick}
      />

      <main className="flex-1 flex min-w-0">
        <div
          className={`relative min-w-0 ${
            desktopRoadviewSplit ? "w-1/2" : "w-full"
          }`}
        >
          {loading && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/70">
              <div className="bg-white rounded-lg shadow-lg px-6 py-4 border border-gray-200">
                <div className="text-sm text-gray-700">지도를 불러오는 중...</div>
              </div>
            </div>
          )}

          {refreshing && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/20 backdrop-blur-[1px]">
              <div className="bg-white rounded-2xl shadow-2xl px-8 py-6 border border-gray-100 flex flex-col items-center gap-3 min-w-[220px]">
                <div className="relative w-10 h-10">
                  <div className="absolute inset-0 rounded-full border-[3px] border-gray-200" />
                  <div className="absolute inset-0 rounded-full border-[3px] border-t-blue-500 animate-spin" />
                </div>
                <div className="text-sm font-semibold text-gray-800">
                  데이터 갱신 중
                </div>
                <div className="text-xs text-gray-500">
                  {refreshPhase || "잠시만 기다려주세요..."}
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1 overflow-hidden mt-1">
                  <div
                    className="h-full bg-blue-500 rounded-full animate-pulse"
                    style={{ width: "60%" }}
                  />
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-2.5 rounded-lg shadow-md flex items-center gap-2 max-w-md">
              <span className="text-base">⚠️</span>
              <span className="flex-1">{error}</span>
              <button
                onClick={() => setError(null)}
                className="text-red-400 hover:text-red-700 leading-none text-base ml-2"
                aria-label="닫기"
              >
                ✕
              </button>
            </div>
          )}

          <KakaoMap
            rows={allRows}
            colorFilter={colorFilter}
            onMarkerClick={openVillagePanelOnMarkerClick}
            fitBoundsKey={fitBoundsKey}
            onMapReady={setMapInstance}
            measureMode={measureActive}
            measureAddPointRef={measureAddPointRef}
            selectedAddr={selectedVillage?.markerRow.geocode_address ?? null}
            mapType={mapType}
            onRenderingChange={(rendering) =>
              setCenterMessage(rendering ? "지도 마커 준비 중..." : null)
            }
            visibleAddrs={mapFilteredAddrs}
            roadviewActive={roadviewActive}
            roadviewPosition={roadviewPosition}
            onRoadviewClick={handleRoadviewClick}
            cadastralActive={cadastralActive}
            onParcelClick={openParcelPanelOnMapClick}
            highlightedParcel={selectedGeometry?.polygon ?? null}
            villagePolygon={villagePolygon}
            onbidActive={onbidActive}
            onbidVillages={onbidVillages.map((g) => ({
              key: g.key,
              lat: g.lat,
              lng: g.lng,
              count: g.items.length,
              hasUrgent: g.hasUrgent,
              emdName: g.emd,
              minDaysLeft: g.minDaysLeft,
            }))}
            onOnbidVillageClick={openOnbidVillage}
            solarMarkers={solarMarkers}
            onSolarMarkerClick={(marker) => {
              // 기존 Sidebar 지번 클릭 흐름 그대로 재사용 — marker.pnu 직접 사용 (좌표 변환 X)
              openParcelPanelOnJibunClick({
                bjd_code: marker.pnu.slice(0, 10),
                addr_jibun: marker.jibun,
                lat: marker.lat,
                lng: marker.lng,
              } as KepcoDataRow);
            }}
          />

          {/* 지도 상태 바 */}
          {allRows.length > 0 &&
            (() => {
              const isFiltered = mapFilteredAddrs != null;
              const visibleCount = isFiltered
                ? mapFilteredAddrs.size
                : allRows.length;
              const visibleJibun = isFiltered
                ? allRows
                    .filter((r) => mapFilteredAddrs.has(r.geocode_address))
                    .reduce((s, r) => s + r.total, 0)
                : allRows.reduce((s, r) => s + r.total, 0);
              const sourceLabel =
                mapFilterSource === "search"
                  ? "주소검색"
                  : mapFilterSource === "filter"
                    ? "마을검색"
                    : mapFilterSource === "compare"
                      ? "변화추적"
                      : "전체 보기";
              const dotColor =
                mapFilterSource === "compare"
                  ? "bg-orange-500"
                  : mapFilterSource === "search"
                    ? "bg-green-500"
                    : mapFilterSource === "filter"
                      ? "bg-blue-500"
                      : "bg-gray-400";
              return (
                <div className="absolute z-20 left-1/2 -translate-x-1/2 bottom-4 md:bottom-auto md:top-2">
                  <div className="flex items-center gap-1.5 md:gap-2 bg-white/95 backdrop-blur border border-gray-200 shadow-lg rounded-full px-3 py-1.5 md:px-4 md:py-2 text-[11px] md:text-xs whitespace-nowrap">
                    {isFiltered ? (
                      <button
                        type="button"
                        onClick={clearMapFilter}
                        className={`flex items-center gap-1 px-1.5 py-0.5 md:px-2 md:py-1 rounded-full text-[10px] md:text-[11px] font-bold text-white shrink-0 hover:opacity-80 active:opacity-60 transition-opacity ${dotColor}`}
                      >
                        {sourceLabel}
                        <span className="text-white/70 text-[9px] ml-0.5">✕</span>
                      </button>
                    ) : (
                      <span
                        className={`px-1.5 py-0.5 md:px-2 md:py-1 rounded-full text-[10px] md:text-[11px] font-bold text-white shrink-0 ${dotColor}`}
                      >
                        {sourceLabel}
                      </span>
                    )}
                    <span className="text-gray-800 font-bold tabular-nums">
                      {visibleCount.toLocaleString()}
                    </span>
                    <span className="text-gray-400 text-[10px] md:text-[11px]">
                      마을
                    </span>
                    <span className="text-gray-300">·</span>
                    <span className="text-gray-800 font-bold tabular-nums">
                      {visibleJibun.toLocaleString()}
                    </span>
                    <span className="text-gray-400 text-[10px] md:text-[11px]">
                      지번
                    </span>
                  </div>
                </div>
              );
            })()}

          {/* 우상단 도구 패널 */}
          <MapToolbar
            measureActive={measureActive}
            onToggleMeasure={() => {
              setMeasureActive((v) => {
                if (!v) setSimpleToast("거리재기 모드 — 지도를 클릭하세요");
                return !v;
              });
            }}
            topListActive={topListOpen}
            onToggleTopList={() => setTopListOpen((v) => !v)}
            gpsActive={gpsActive}
            gpsAutoFollow={gpsAutoFollow}
            onToggleGps={() => {
              if (gpsActive) {
                setGpsActive(false);
              } else {
                setGpsActive(true);
                setGpsAutoFollow(true);
                setSimpleToast("GPS 추적 시작");
              }
            }}
            onGpsRecenter={() => setGpsAutoFollow(true)}
            zoomLevel={zoomLevel}
            mapType={mapType}
            onMapTypeChange={setMapType}
            roadviewActive={roadviewActive}
            onToggleRoadview={handleToggleRoadview}
            cadastralActive={cadastralActive}
            onToggleCadastral={handleToggleCadastral}
            onbidActive={onbidActive}
            onSetOnbid={setOnbidMode}
            onZoomIn={() => mapInstance?.setLevel(mapInstance.getLevel() - 1)}
            onZoomOut={() => mapInstance?.setLevel(mapInstance.getLevel() + 1)}
            onShare={handleShare}
          />

          {topListOpen && (
            <TopRemainingList
              rows={allRows}
              onPick={handleTopRankingPick}
              onClose={() => setTopListOpen(false)}
              topN={10}
            />
          )}


          <DistanceTool
            map={mapInstance}
            active={measureActive}
            onClose={() => setMeasureActive(false)}
            registerAddPoint={registerMeasureAddPoint}
          />

          <GpsTracker
            map={mapInstance}
            active={gpsActive}
            autoFollow={gpsAutoFollow}
            onAutoFollowChange={setGpsAutoFollow}
            onError={(msg) => setError(msg)}
          />

          {toast && (
            <Toast
              message={toast.message}
              actionLabel="되돌리기"
              onAction={() => setFilters(toast.snapshot)}
              onClose={() => setToast(null)}
            />
          )}

          {simpleToast && (
            <Toast
              message={simpleToast}
              onClose={() => setSimpleToast(null)}
              duration={3000}
            />
          )}

          {centerMessage && (
            <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
              <div className="bg-white/90 rounded-xl px-5 py-4 shadow-lg flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-gray-600">{centerMessage}</span>
              </div>
            </div>
          )}

          {/* 마을 요약 카드 (마커 클릭, 단 지번 패널이 열려있으면 숨김) */}
          {selectedVillage && !detailModalOpen && !selectedJibun && !parcelLoading && (
            <LocationSummaryCard
              key={selectedVillage.bjdCode}
              markerRow={selectedVillage.markerRow}
              summary={selectedVillage.summary}
              loading={selectedVillage.loading}
              onShowDetail={openVillageDetailModal}
              onClose={closeVillagePanel}
            />
          )}

          {/* 마을 상세 모달 — raw rows lazy fetch (rowsLoading 시 spinner) */}
          {detailModalOpen && selectedVillage && (
            <LocationDetailModal
              rows={selectedVillage.rows ?? []}
              loading={selectedVillage.rowsLoading}
              error={selectedVillage.rowsError}
              onClose={() => setDetailModalOpen(false)}
              onJibunPin={openParcelPanelOnJibunClick}
              initialSearch=""
            />
          )}

          {/* 지번 클릭 — 필지 정보 패널 */}
          {(parcelLoading || selectedJibun) && (
            <ParcelInfoPanel
              jibun={selectedJibun}
              geometry={selectedGeometry}
              capa={parcelCapa}
              meta={parcelMeta}
              clickedJibun={parcelClickedJibun}
              matchMode={parcelCapa.length > 0 ? "exact" : null}
              nearestJibun={null}
              loading={parcelLoading}
              onClose={closeParcelPanel}
              onRefreshCapa={refreshParcelCapa}
              refreshingCapa={refreshingCapa}
              refreshCapaError={refreshCapaError}
              defaultOnbidTab={parcelOpenedFromOnbid}
              onSolarMarkers={setSolarMarkers}
            />
          )}

          {/* 공매 마을 요약 카드 — 빨간 마커 클릭, 지번 패널 떠있으면 숨김 */}
          {selectedOnbidVillage &&
            !onbidModalOpen &&
            !selectedJibun &&
            !parcelLoading && (
              <OnbidVillageCard
                key={selectedOnbidVillage.key}
                group={selectedOnbidVillage}
                onShowDetail={() => setOnbidModalOpen(true)}
                onClose={closeOnbidVillage}
              />
            )}

          {/* 공매 마을 매물 리스트 모달 */}
          {onbidModalOpen && selectedOnbidVillage && (
            <OnbidVillageModal
              group={selectedOnbidVillage}
              onClose={() => setOnbidModalOpen(false)}
              onItemClick={openParcelPanelOnOnbidItemClick}
            />
          )}

          {/* 빈 데이터 안내 */}
          {!loading && allRows.length === 0 && !error && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-white rounded-xl shadow-lg px-8 py-6 border border-gray-200 text-center pointer-events-auto max-w-md">
                <div className="text-4xl mb-3">📭</div>
                <div className="text-base font-semibold text-gray-900 mb-2">
                  아직 보여드릴 데이터가 없어요
                </div>
                {isAdmin ? (
                  <>
                    <div className="text-xs text-gray-600 leading-relaxed mb-4">
                      관리자 메뉴에서 크롤을 실행하시면<br />
                      바로 지도에 표시됩니다.
                    </div>
                    <Link
                      href="/admin/crawl"
                      className="inline-block bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium px-4 py-2 rounded-md transition-colors"
                    >
                      📥 크롤 시작하기
                    </Link>
                  </>
                ) : (
                  <div className="text-xs text-gray-600 leading-relaxed">
                    관리자가 데이터를 수집하면<br />
                    이 화면에서 바로 확인하실 수 있어요.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 로드뷰 패널 — 데스크톱 분할 (우측 절반) */}
        {desktopRoadviewSplit && roadviewPosition && (
          <div className="w-1/2 relative border-l border-gray-300">
            <RoadviewPanel
              position={roadviewPosition}
              onClose={handleRoadviewClose}
              onPositionChange={(lat, lng, pan) =>
                setRoadviewPosition({ lat, lng, pan })
              }
            />
          </div>
        )}
      </main>

      {/* 로드뷰 패널 — 모바일 전체화면 모달 */}
      {isMobile && roadviewPosition && (
        <RoadviewPanel
          position={roadviewPosition}
          onClose={handleRoadviewClose}
          onPositionChange={(lat, lng) => setRoadviewPosition({ lat, lng })}
          isMobile
        />
      )}

      <PatentWatermark />
    </div>
  );
}
