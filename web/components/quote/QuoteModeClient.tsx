"use client";

/* eslint-disable react-hooks/set-state-in-effect --
 * fetch 시작 시 loading=true 로 외부 비동기 상태와 동기화 — 의도된 effect.
 */

/**
 * 견적 모드 풀스크린 클라이언트 — /quote/[pnu] 라우트 본체.
 *
 * 1차 푸시 범위 (이번):
 *   - PNU 받아 필지 + 건물 폴리곤 atomic endpoint 호출
 *   - 풀스크린 3-pane 레이아웃 (좌 도구 / 중앙 지도 / 우 결과)
 *   - 1섹션(영역 정의) — 건물 N동/합계 면적 자동 표시 (선택 X, 표시만)
 *   - 2~5섹션(시설견적/패널/PDF/수지분석) placeholder
 *
 * 다음 푸시:
 *   - 영역 클릭 선택 + 다중 선택
 *   - 시설 종류 자동 추천 + 변경
 *   - 면적 → kW → 시공비 산출
 *   - 수지분석/PDF
 *
 * 모바일: 폰(<768) 은 읽기 전용 안내. 태블릿(768~) 부터 풀 기능.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchVworldParcelByPnu } from "@/lib/api/vworld";
import {
  fetchBuildingPolygonsByPnu,
  fetchBuildingsByPnu,
  type BuildingTitleInfo,
} from "@/lib/api/buildings";
import { fetchKepcoByPnu } from "@/lib/kepco/by-pnu";
import type { JibunInfo, ParcelGeometry } from "@/lib/vworld/parcel";
import type { BuildingPolygon } from "@/lib/vworld/buildings";
import type { KepcoDataRow } from "@/lib/types";
import type { Position } from "geojson";
import {
  createDefaultRect,
  calcAreaM2,
  polygonCenter,
  addVertex,
  removeVertex,
  findLongestEdge,
  findFlattestVertex,
} from "@/lib/geometry/polygon-edit";
import {
  FACILITY_KINDS,
  FACILITY_LABEL,
  FACILITY_SPEC,
  calcCost,
  formatCost,
  formatKw,
  recommendFacility,
  type FacilityKind,
  type FacilitySpec,
} from "@/lib/quote/facility";
import {
  DEFAULT_MODULE,
  FACILITY_PLACEMENT,
  calcInstalledKw,
  type PanelModule,
  type PlacementSpec,
} from "@/lib/quote/panel";
import {
  fillPanelGrid,
  calcAutoRotation,
  calcAreaDimensions,
} from "@/lib/quote/grid";
import {
  calcFinance,
  DEFAULT_FINANCE_INPUT,
  type FinanceInput,
  type LoanScenario,
} from "@/lib/quote/finance";
import {
  saveBlueprintData,
  saveFinanceData,
  type BlueprintPrintData,
  type FinancePrintData,
  type PrintBuilding,
} from "@/lib/quote/print-data";
import { getRepayMonths } from "@/lib/quote/finance";
import ParcelInfoPanel from "@/components/map/ParcelInfoPanel";
import QuoteMap, { type EditableBuilding } from "./QuoteMap";
import FinanceTable from "./FinanceTable";

const M2_TO_PYEONG = 0.3025;

/**
 * 편집 상태가 추가된 건물 — VWorld 원본 + 사용자 수정 폴리곤/면적.
 * source = "vworld" 자동 감지 / "user_added" 사용자가 [+ 영역 추가] 로 만든 것.
 * 원본은 변경 안 함 → "원래대로" 복원 가능 (다음 푸시에서 UI 추가).
 */
interface EditedBuilding extends BuildingPolygon {
  edited_polygon: Position[][];
  edited_area_m2: number;
  is_edited: boolean;
  source: "vworld" | "user_added";
  /** 사용자 추가 동의 안정적 ID (pk 가 비어있으니 별도 부여) */
  local_id?: string;
}

function toEdited(b: BuildingPolygon): EditedBuilding {
  return {
    ...b,
    edited_polygon: b.polygon,
    edited_area_m2: b.area_m2,
    is_edited: false,
    source: "vworld",
  };
}

/** KEPCO updated_at(ISO) → 봉남리 양식 "X월 Y일 인터넷 조회기준" */
function formatKepcoCheckedAt(iso: string | null | undefined): string {
  if (!iso) return "조회 일자 미상";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "조회 일자 미상";
  return `${d.getMonth() + 1}월 ${d.getDate()}일 인터넷 조회기준`;
}

/** QuoteMap 에 넘길 안정적 식별자 — VWorld pk 우선, 사용자 추가는 local_id */
function makeBuildingId(b: EditedBuilding): string {
  if (b.source === "user_added" && b.local_id) return b.local_id;
  return b.pk || b.bd_mgt_sn || `${b.pnu}-${b.buld_no}`;
}

interface Props {
  pnu: string;
}

export default function QuoteModeClient({ pnu }: Props) {
  const [jibun, setJibun] = useState<JibunInfo | null>(null);
  const [geometry, setGeometry] = useState<ParcelGeometry | null>(null);
  const [buildings, setBuildings] = useState<EditedBuilding[]>([]);
  // 건축물대장 표제부 — 도로명주소건물(폴리곤) 과는 별개 데이터셋.
  // 동·식물관련시설은 대장 등록은 되지만 도로명주소 미부여로 폴리곤 0건 케이스가 흔함.
  const [bldgRegister, setBldgRegister] = useState<BuildingTitleInfo[]>([]);
  // 견적 PDF/수지 계산용 — KEPCO 용량 (capa[0] 의 변전소/주변압기/배전선로 여유 MW)
  const [capa, setCapa] = useState<KepcoDataRow[]>([]);
  const [loadingParcel, setLoadingParcel] = useState(true);
  const [loadingBuildings, setLoadingBuildings] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 데이터 fetch — 세 endpoint 병렬 (필지 + 건물 폴리곤 + 건축물대장)
  useEffect(() => {
    const ctl = new AbortController();
    setLoadingParcel(true);
    setLoadingBuildings(true);
    setError(null);

    fetchVworldParcelByPnu(pnu, { signal: ctl.signal })
      .then((res) => {
        if (!res) {
          setError("필지 정보를 찾을 수 없습니다.");
          return;
        }
        setJibun(res.jibun);
        setGeometry(res.geometry);
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "필지 조회 실패");
      })
      .finally(() => setLoadingParcel(false));

    fetchBuildingPolygonsByPnu(pnu, { signal: ctl.signal })
      .then((rows) => setBuildings(rows.map(toEdited)))
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        // 건물 0건은 정상 (가설건축물 등) — 에러로 막지 않고 빈배열 유지
        console.error("건물 폴리곤 조회 실패:", e);
      })
      .finally(() => setLoadingBuildings(false));

    fetchBuildingsByPnu(pnu, { signal: ctl.signal })
      .then(setBldgRegister)
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        console.error("건축물대장 조회 실패:", e);
      });

    return () => ctl.abort();
  }, [pnu]);

  // KEPCO 용량 별도 fetch — 견적 PDF/수지 계산에 필요 (capa[0]).
  // PNU 단일 입력. ParcelInfoPanel [전기] 탭과 동일 endpoint(/api/capa/by-pnu)+모듈 캐시 공유 →
  // 실제 외부 호출은 1회.
  useEffect(() => {
    if (!/^\d{19}$/.test(pnu)) return;
    const ctl = new AbortController();
    fetchKepcoByPnu(pnu, { signal: ctl.signal })
      .then((res) => {
        setCapa(res.rows);
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        console.error("KEPCO 용량 조회 실패:", e);
      });
    return () => ctl.abort();
  }, [pnu]);

  /** QuoteMap 의 dragend → 해당 동만 폴리곤/면적 갱신 */
  const handleBuildingChange = useCallback(
    (id: string, newPolygon: Position[][], newAreaM2: number) => {
      setBuildings((prev) =>
        prev.map((b) =>
          makeBuildingId(b) === id
            ? {
                ...b,
                edited_polygon: newPolygon,
                edited_area_m2: newAreaM2,
                is_edited: true,
              }
            : b,
        ),
      );
    },
    [],
  );

  /** 동 이름(buld_nm) 직접 수정 — 우측 카드 ✎ 편집. 빈 이름 거부 */
  const handleBuildingRename = useCallback((id: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setBuildings((prev) =>
      prev.map((b) =>
        makeBuildingId(b) === id ? { ...b, buld_nm: trimmed } : b,
      ),
    );
  }, []);

  /**
   * [+ 영역 추가] — 부지 중심에 기본 15m × 15m 사각형 생성.
   * 사용자가 꼭지점 드래그로 위치/크기 조정.
   */
  const handleAddBuilding = useCallback(() => {
    if (!geometry) return; // 부지 없으면 추가 불가 (현재로선 발생 X)
    // 부지 폴리곤 centroid 를 기본 위치로 — 폴리곤 안에 등장
    const center = polygonCenter(geometry.polygon) ?? geometry.center;
    const polygon = createDefaultRect(center, 15);
    const area_m2 = calcAreaM2(polygon);

    setBuildings((prev) => {
      // 기본 이름 = 전체 동의 다음 번호 (자동 + 사용자 추가 합쳐서). 견적서까지
      // 그대로 노출되므로 자연스러운 이름. 사용자가 직접 수정 가능 (✎ 편집).
      const userCount = prev.filter((b) => b.source === "user_added").length + 1;
      const local_id = `user_${Date.now()}_${userCount}`;
      const defaultName = `${prev.length + 1}동`;
      const newBuilding: EditedBuilding = {
        // VWorld 필드는 빈 문자열/0 으로 채움
        pk: "",
        bd_mgt_sn: "",
        pnu,
        sido: "",
        sigungu: "",
        gu: "",
        rd_nm: "",
        buld_no: "",
        gro_flo_co: 1,
        und_flo_co: 0,
        buld_nm: defaultName,
        polygon,
        area_m2,
        center,
        // 편집 상태
        edited_polygon: polygon,
        edited_area_m2: area_m2,
        is_edited: false,
        source: "user_added",
        local_id,
      };
      return [...prev, newBuilding];
    });
  }, [geometry, pnu]);

  /** 동 삭제 — 우측 카드 🗑 클릭 → 빨간 모드 → [정말 삭제] 시 호출 */
  const handleDeleteBuilding = useCallback((id: string) => {
    setBuildings((prev) => prev.filter((b) => makeBuildingId(b) !== id));
  }, []);

  /**
   * 우측 카드 [+] 클릭 → 가장 긴 변 가운데에 새 꼭지점 자동 삽입.
   * 사용자는 추가된 점을 드래그로 원하는 위치로 이동.
   */
  const handleAutoAddVertex = useCallback((id: string) => {
    setBuildings((prev) =>
      prev.map((b) => {
        if (makeBuildingId(b) !== id) return b;
        const longest = findLongestEdge(b.edited_polygon);
        if (!longest) return b;
        const newPolygon = addVertex(
          b.edited_polygon,
          longest.ringIdx,
          longest.edgeIdx,
          longest.midpoint,
        );
        return {
          ...b,
          edited_polygon: newPolygon,
          edited_area_m2: calcAreaM2(newPolygon),
          is_edited: true,
        };
      }),
    );
  }, []);

  /**
   * 우측 카드 [−] 클릭 → 각도 가장 평평한 점(거의 직선상) 자동 삭제.
   * 모양 거의 안 바뀜. 최소 3점은 findFlattestVertex 가 자체 검증 (null 반환).
   */
  const handleAutoRemoveVertex = useCallback((id: string) => {
    setBuildings((prev) =>
      prev.map((b) => {
        if (makeBuildingId(b) !== id) return b;
        const flat = findFlattestVertex(b.edited_polygon);
        if (!flat) return b; // 3점 이하면 거부
        const newPolygon = removeVertex(
          b.edited_polygon,
          flat.ringIdx,
          flat.vertexIdx,
        );
        if (newPolygon === b.edited_polygon) return b;
        return {
          ...b,
          edited_polygon: newPolygon,
          edited_area_m2: calcAreaM2(newPolygon),
          is_edited: true,
        };
      }),
    );
  }, []);

  /** 꼭지점 마커 dblclick → 점 삭제. 최소 3점은 removeVertex 가 자체 검증. */
  const handleRemoveVertex = useCallback(
    (id: string, ringIdx: number, vertexIdx: number) => {
      setBuildings((prev) =>
        prev.map((b) => {
          if (makeBuildingId(b) !== id) return b;
          const newPolygon = removeVertex(b.edited_polygon, ringIdx, vertexIdx);
          if (newPolygon === b.edited_polygon) return b; // 거부됨 (3점 미만 방어)
          return {
            ...b,
            edited_polygon: newPolygon,
            edited_area_m2: calcAreaM2(newPolygon),
            is_edited: true,
          };
        }),
      );
    },
    [],
  );

  /** 우측 카드의 🗑 클릭 시 빨간 모드 진입 — id 일치하면 [정말 삭제] / [취소] 표시 */
  const [deletePendingId, setDeletePendingId] = useState<string | null>(null);
  /** [전체 삭제] 클릭 시 확인 모달 표시 */
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);

  // ── 2섹션 시설별 견적 — 사용자 변경 사항만 별도 state. 자동 추천은 derive.
  /** 동별 시설 종류 사용자 선택. 미설정이면 recommendFacility() 결과 사용. */
  const [facilityOverrides, setFacilityOverrides] = useState<
    Record<string, FacilityKind>
  >({});
  /** 동별 단가 사용자 변경. 미설정이면 FACILITY_SPEC[kind] 디폴트 사용.
   *  시설 종류가 바뀌면 자동 클리어 (새 시설의 디폴트 단가로 복귀). */
  const [specOverrides, setSpecOverrides] = useState<
    Record<string, FacilitySpec>
  >({});
  /** 동별 이격거리(행간/가장자리) 사용자 변경.
   *  미설정이면 FACILITY_PLACEMENT[kind] 디폴트 사용.
   *  시설 종류가 바뀌면 자동 클리어 (새 시설의 디폴트 이격거리로 복귀). */
  const [placementOverrides, setPlacementOverrides] = useState<
    Record<string, PlacementSpec>
  >({});
  /** 동별 회전각 사용자 변경 (degrees, 0~180).
   *  미설정이면 calcAutoRotation(시설 회전 규칙) 결과 사용.
   *  시설 종류가 바뀌면 자동 클리어. 핸들 드래그/우측 카드 ↺ 로 조작. */
  const [rotationOverrides, setRotationOverrides] = useState<
    Record<string, number>
  >({});
  /** 단가/이격거리 인라인 편집 펼친 동의 id (한 번에 한 동만 편집) */
  const [editingSpecId, setEditingSpecId] = useState<string | null>(null);

  // ── 3단계 — 패널 모듈 사용자 변경 (의뢰자 추가 요청 2026-04-27)
  /** 사용자가 변경한 모듈. null 이면 DEFAULT_MODULE (AIKO 670W) 사용 */
  const [customModule, setCustomModule] = useState<PanelModule | null>(null);
  const [isEditingModule, setIsEditingModule] = useState(false);
  const activeModule = customModule ?? DEFAULT_MODULE;
  const isCustomModule = customModule !== null;

  // ── 좌측 패널 아코디언 — 활성 1개 step 만 펼침 (기본 1: 영역 정의).
  // 활성 헤더 다시 클릭하면 null (모두 접힘).
  const [activeStep, setActiveStep] = useState<number | null>(1);
  const toggleStep = useCallback((step: number) => {
    setActiveStep((prev) => (prev === step ? null : step));
  }, []);

  // ── 동 선택 강조 — 라벨/폴리곤 클릭 시 set, 좌측 카드도 동시 강조
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(
    null,
  );
  const handleSelectBuilding = useCallback((id: string, force?: boolean) => {
    if (force) {
      setSelectedBuildingId(id);
      return;
    }
    setSelectedBuildingId((prev) => (prev === id ? null : id));
  }, []);
  const handleRequestDelete = useCallback((id: string) => {
    setDeletePendingId(id);
  }, []);

  const handleFacilityChange = useCallback(
    (id: string, kind: FacilityKind) => {
      setFacilityOverrides((prev) => ({ ...prev, [id]: kind }));
      // 시설 종류 변경 → 단가/이격거리 override 클리어 (새 시설 디폴트 적용)
      setSpecOverrides((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setPlacementOverrides((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setRotationOverrides((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [],
  );

  /** 회전 핸들 드래그 / 우측 카드 input 로 호출. degrees, 0~180 정규화는 호출자 책임. */
  const handleRotationChange = useCallback((id: string, deg: number) => {
    setRotationOverrides((prev) => ({ ...prev, [id]: deg }));
  }, []);

  /** 우측 카드 ↺ / 핸들 더블클릭 → 시설 자동 회전으로 복귀 */
  const handleResetRotation = useCallback((id: string) => {
    setRotationOverrides((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const handleSpecChange = useCallback((id: string, spec: FacilitySpec) => {
    setSpecOverrides((prev) => ({ ...prev, [id]: spec }));
  }, []);

  const handlePlacementChange = useCallback(
    (id: string, placement: PlacementSpec) => {
      setPlacementOverrides((prev) => ({ ...prev, [id]: placement }));
    },
    [],
  );

  const handleResetPlacement = useCallback((id: string) => {
    setPlacementOverrides((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const handleResetSpec = useCallback((id: string) => {
    setSpecOverrides((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const handleResetFacility = useCallback((id: string) => {
    setFacilityOverrides((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  /**
   * QuoteMap props 형태 — 편집 polygon/area + 동 이름 + 패널 격자.
   * 패널은 2단계(시설별 견적) 부터 노출 — 1단계 영역 편집 중에는 윤곽만 보이게.
   */
  const showPanels = activeStep != null && activeStep >= 2;
  const editableBuildings: EditableBuilding[] = useMemo(
    () =>
      buildings.map((b, i) => {
        const id = makeBuildingId(b);
        const facility =
          facilityOverrides[id] ??
          recommendFacility(
            b.source,
            geometry?.jimok ?? "",
            bldgRegister,
          );
        const placement =
          placementOverrides[id] ?? FACILITY_PLACEMENT[facility];
        // 사용자 회전 우선, 없으면 시설별 자동 회전 (정남 / 건물 가장 긴 변 평행)
        const autoRot = calcAutoRotation(b.edited_polygon, placement.rotation);
        const userRot = rotationOverrides[id];
        const rotation = userRot ?? autoRot;
        const isAutoRotation = userRot === undefined;
        const layout = showPanels
          ? fillPanelGrid(b.edited_polygon, activeModule, placement, rotation)
          : { panels: [], count: 0, rotation };
        // Step 3-5: 회전된 bbox 가로 × 세로 (m) — 영역 라벨 표시용
        const dims = calcAreaDimensions(b.edited_polygon, rotation);
        return {
          id,
          name: b.buld_nm || `${i + 1}동`,
          polygon: b.edited_polygon,
          area_m2: b.edited_area_m2,
          panels: layout.panels,
          widthM: dims.widthM,
          heightM: dims.heightM,
          rotation,
          isAutoRotation,
        };
      }),
    [
      buildings,
      facilityOverrides,
      placementOverrides,
      rotationOverrides,
      geometry,
      bldgRegister,
      activeModule,
      showPanels,
    ],
  );

  /** 3단계 동별 패널 카드용 — id → (count, kw) 매핑 */
  const panelLayouts = useMemo(() => {
    return editableBuildings.map((eb) => ({
      id: eb.id,
      name: eb.name,
      count: eb.panels?.length ?? 0,
      kwActual: calcInstalledKw(eb.panels?.length ?? 0, activeModule),
    }));
  }, [editableBuildings, activeModule]);

  const totalPanels = panelLayouts.reduce((s, l) => s + l.count, 0);
  const totalKwActual = panelLayouts.reduce((s, l) => s + l.kwActual, 0);

  // ESC 키 → 삭제 확인 모달 닫기
  useEffect(() => {
    if (!deletePendingId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDeletePendingId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deletePendingId]);


  /** 삭제 확인 모달용 — 현재 삭제 대기 동 정보 */
  const pendingDeleteBuilding = useMemo(() => {
    if (!deletePendingId) return null;
    const b = buildings.find((x) => makeBuildingId(x) === deletePendingId);
    if (!b) return null;
    const idx = buildings.indexOf(b);
    return {
      id: deletePendingId,
      name: b.buld_nm || `${idx + 1}동`,
      pyeong: Math.round(b.edited_area_m2 * M2_TO_PYEONG),
    };
  }, [deletePendingId, buildings]);

  /**
   * 동별 시설 종류 + 단가 + 패널 갯수 + 실제 kW + 시공비.
   * 봉남리 양식 일관 — 시공비 = 격자 기반 실제 kW × 단가.
   * 평수 기반 추정값(calcKw) 은 더 이상 사용 안 함.
   */
  const facilityRows = useMemo(() => {
    const jimok = geometry?.jimok ?? "";
    return buildings.map((b) => {
      const id = makeBuildingId(b);
      const auto = recommendFacility(b.source, jimok, bldgRegister);
      const kind = facilityOverrides[id] ?? auto;
      const spec = specOverrides[id] ?? FACILITY_SPEC[kind];
      const placement = placementOverrides[id] ?? FACILITY_PLACEMENT[kind];
      const py = b.edited_area_m2 * M2_TO_PYEONG;
      const layout = panelLayouts.find((l) => l.id === id);
      const panelCount = layout?.count ?? 0;
      const kw = layout?.kwActual ?? 0;
      const cost = calcCost(kw, spec);
      const autoRot = calcAutoRotation(b.edited_polygon, placement.rotation);
      const userRot = rotationOverrides[id];
      const rotation = userRot ?? autoRot;
      return {
        id,
        building: b,
        auto,
        kind,
        spec,
        placement,
        py,
        panelCount,
        kw,
        cost,
        rotation,
        isAutoKind: !facilityOverrides[id],
        isCustomSpec: !!specOverrides[id],
        isCustomPlacement: !!placementOverrides[id],
        isCustomRotation: userRot !== undefined,
      };
    });
  }, [
    buildings,
    geometry,
    bldgRegister,
    facilityOverrides,
    specOverrides,
    placementOverrides,
    rotationOverrides,
    panelLayouts,
  ]);

  const totalKw = facilityRows.reduce((s, r) => s + r.kw, 0);
  const totalCost = facilityRows.reduce((s, r) => s + r.cost, 0);

  // ── 5단계 수지분석 ─────────────────────────────────
  // 의뢰자 컨펌 (2026-04-27): 봉남리 양식 그대로 + 시나리오 토글 + ROI/손익분기
  // 시공비 = 2단계 합계 자동, 사용자 수정 가능. 대출액 = 총사업비의 % 입력.
  const [loanScenario, setLoanScenario] = useState<LoanScenario>("자기자본");
  const [loanRatioPct, setLoanRatioPct] = useState(100);
  const [costOverride, setCostOverride] = useState<number | null>(null);
  const [showFinanceVars, setShowFinanceVars] = useState(false);
  const [showFinanceTable, setShowFinanceTable] = useState(false);
  const [varOverrides, setVarOverrides] = useState<
    Partial<
      Pick<
        FinanceInput,
        | "dailyHours"
        | "annualDecay"
        | "smpPrice"
        | "recPrice"
        | "recWeight"
        | "maintenanceRate"
        | "vatRate"
        | "loanRate"
        | "graceMonths"
      >
    >
  >({});

  const financeInput = useMemo<FinanceInput>(() => {
    const construction = costOverride ?? totalCost;
    const vatRate = varOverrides.vatRate ?? DEFAULT_FINANCE_INPUT.vatRate;
    const totalCostEstimated = construction * (1 + vatRate);
    const loanPrincipal =
      loanScenario === "자기자본"
        ? 0
        : (totalCostEstimated * loanRatioPct) / 100;
    return {
      ...DEFAULT_FINANCE_INPUT,
      ...varOverrides,
      capacityKw: totalKw,
      constructionCost: construction,
      scenario: loanScenario,
      loanPrincipal,
    };
  }, [
    totalKw,
    totalCost,
    costOverride,
    loanScenario,
    loanRatioPct,
    varOverrides,
  ]);

  const resetFinanceVars = useCallback(() => {
    setVarOverrides({});
    setCostOverride(null);
    setLoanRatioPct(100);
  }, []);

  const isFinanceCustomized =
    costOverride != null ||
    loanRatioPct !== 100 ||
    Object.keys(varOverrides).length > 0;


  // ESC 키 → 시계열 표 모달 닫기
  useEffect(() => {
    if (!showFinanceTable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowFinanceTable(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showFinanceTable]);

  const financeResult = useMemo(
    () => calcFinance(financeInput),
    [financeInput],
  );

  const buildingArea = buildings.reduce(
    (sum, b) => sum + b.edited_area_m2,
    0,
  );
  const buildingPyeong = Math.round(buildingArea * M2_TO_PYEONG);
  const parcelPyeong = geometry
    ? Math.round(geometry.area_m2 * M2_TO_PYEONG)
    : null;

  const headerAddr = jibun
    ? [jibun.ctp_nm, jibun.sig_nm, jibun.emd_nm, jibun.li_nm, jibun.jibun]
        .filter(Boolean)
        .join(" ")
    : "필지 정보 불러오는 중…";

  /** 도면 PDF 저장 — sessionStorage 직렬화 + 인쇄 라우트 새 탭 오픈 */
  const handlePrintBlueprint = useCallback(() => {
    if (!geometry || buildings.length === 0) return;
    const printBuildings: PrintBuilding[] = buildings.map((b, i) => {
      const id = makeBuildingId(b);
      const facility =
        facilityOverrides[id] ??
        recommendFacility(b.source, geometry.jimok ?? "", bldgRegister);
      const placement = placementOverrides[id] ?? FACILITY_PLACEMENT[facility];
      const rotation =
        rotationOverrides[id] ??
        calcAutoRotation(b.edited_polygon, placement.rotation);
      const layout = fillPanelGrid(
        b.edited_polygon,
        activeModule,
        placement,
        rotation,
      );
      const dims = calcAreaDimensions(b.edited_polygon, rotation);
      return {
        id,
        name: b.buld_nm || `${i + 1}동`,
        polygon: b.edited_polygon,
        panels: layout.panels,
        panelCount: layout.panels.length,
        kwActual: calcInstalledKw(layout.panels.length, activeModule),
        rotation,
        widthM: dims.widthM,
        heightM: dims.heightM,
        area_m2: b.edited_area_m2,
      };
    });
    const kepcoRow = capa[0];
    const kepco = kepcoRow
      ? {
          substationName: kepcoRow.subst_nm ?? "-",
          substationFreeMW:
            ((kepcoRow.subst_capa ?? 0) - (kepcoRow.subst_pwr ?? 0)) / 1000,
          mtrName: `#${kepcoRow.mtr_no ?? "-"}`,
          mtrFreeMW:
            ((kepcoRow.mtr_capa ?? 0) - (kepcoRow.mtr_pwr ?? 0)) / 1000,
          dlName: kepcoRow.dl_nm ?? "-",
          dlFreeMW: ((kepcoRow.dl_capa ?? 0) - (kepcoRow.dl_pwr ?? 0)) / 1000,
          checkedAt: formatKepcoCheckedAt(kepcoRow.updated_at),
        }
      : null;
    const printData: BlueprintPrintData = {
      pnu,
      address: headerAddr,
      jimok: geometry.jimok ?? "",
      parcelM2: geometry.area_m2,
      module: activeModule,
      buildings: printBuildings,
      kepco,
      solarAltitudeDeg: 23,
      generatedAt: new Date().toISOString(),
    };
    saveBlueprintData(printData);
    window.open(`/quote/${pnu}/print`, "_blank");
  }, [
    geometry,
    buildings,
    facilityOverrides,
    placementOverrides,
    rotationOverrides,
    bldgRegister,
    activeModule,
    capa,
    pnu,
    headerAddr,
  ]);

  /** 수익 분석 PDF 저장 — 봉남리 견적서 양식 (20년 시계열 + 4박스) */
  const handlePrintFinance = useCallback(() => {
    if (totalKw <= 0) return;
    const printData: FinancePrintData = {
      pnu,
      address: headerAddr,
      module: activeModule,
      totalKw,
      totalPanels,
      buildingCount: buildings.length,
      totalPyeong: Math.round(buildingArea * M2_TO_PYEONG),
      dailyHours: financeInput.dailyHours,
      smpPrice: financeInput.smpPrice,
      recPrice: financeInput.recPrice,
      recWeight: financeInput.recWeight,
      constructionCost: financeResult.constructionCost,
      vat: financeResult.vat,
      totalCost: financeResult.totalCost,
      scenario: loanScenario,
      loanPrincipal: financeInput.loanPrincipal,
      loanRate: financeInput.loanRate,
      graceMonths: financeInput.graceMonths,
      repayMonths: getRepayMonths(loanScenario),
      rows: financeResult.rows,
      roi: financeResult.roi,
      paybackYears: financeResult.paybackYears,
      totalNetIncome: financeResult.totalNetIncome,
      totalAfterLoan: financeResult.totalAfterLoan,
      generatedAt: new Date().toISOString(),
    };
    saveFinanceData(printData);
    window.open(`/quote/${pnu}/print/finance`, "_blank");
  }, [
    pnu,
    headerAddr,
    activeModule,
    totalKw,
    totalPanels,
    buildings.length,
    buildingArea,
    financeInput,
    financeResult,
    loanScenario,
  ]);

  return (
    <div className="fixed inset-0 flex flex-col bg-gray-100">
      {/* 상단바 — 견적 모드는 새 탭으로 진입하므로 [지도로] 버튼 없음 (탭 닫기로 종료) */}
      <header className="flex items-center justify-between gap-3 h-12 px-3 md:px-4 bg-white border-b border-gray-200 shrink-0">
        <div className="flex-1 min-w-0 text-center">
          <div className="text-sm md:text-base font-bold text-gray-900 truncate">
            {headerAddr}
          </div>
          <div className="text-[10px] text-gray-400 font-mono truncate">
            PNU {pnu}
          </div>
        </div>
        <button
          disabled
          className="px-3 py-1.5 text-sm bg-gray-200 text-gray-400 rounded cursor-not-allowed"
          title="4단계 작업 예정"
        >
          PDF 출력
        </button>
      </header>

      {/* 폰 안내 — 태블릿 이상에선 숨김 */}
      <div className="md:hidden flex-1 flex items-center justify-center px-6 text-center bg-white">
        <div>
          <div className="text-3xl mb-3">📐</div>
          <div className="text-sm font-semibold text-gray-900 mb-1">
            견적 모드는 태블릿/PC에서 작업하세요
          </div>
          <div className="text-xs text-gray-500 leading-relaxed">
            영역 그리기 / 시설 변경 / 패널 배치 등 정밀 작업 화면입니다.
            <br />
            폰에서는 결과만 확인 가능 (다음 단계 작업 예정).
          </div>
        </div>
      </div>

      {/* 본문 (태블릿+) */}
      <div className="hidden md:flex flex-1 min-h-0 overflow-hidden">
        {/* 좌측 도구 패널 — 모든 견적 작업 (영역/시설/패널/PDF/수지) + 합계 + 부지정보 */}
        <aside className="w-80 lg:w-96 bg-white border-r border-gray-200 overflow-y-auto">
          {/* 0번 부지 정보 — ParcelInfoPanel 임베드 (inQuoteMode) */}
          <SectionHeader
            step={0}
            title="부지 확인"
            isExpanded={activeStep === 0}
            onClick={() => toggleStep(0)}
          />
          {activeStep === 0 && (
            <ParcelInfoPanel
              pnu={pnu}
              onClose={() => {}}
              polygonCount={loadingBuildings ? undefined : buildings.length}
              inQuoteMode
              onSolarMarkers={() => {}}
            />
          )}
          <SectionHeader
            step={1}
            title="영역 그리기"
            isExpanded={activeStep === 1}
            onClick={() => toggleStep(1)}
          />
          {activeStep === 1 && (
          <div className="px-4 py-3 space-y-3">
            {loadingBuildings ? (
              <div className="text-gray-500 text-sm">
                건물 폴리곤 불러오는 중…
              </div>
            ) : (
              <>
                {/* 요약 정보 — 읽기 전용 (상단 컬러바로 정보성 강조) */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="relative pl-2.5 pr-2 py-1.5 bg-amber-50/70 border border-amber-200 rounded overflow-hidden">
                    <span className="absolute left-0 top-0 bottom-0 w-1 bg-amber-400" />
                    <div className="text-[10px] text-amber-800 font-semibold flex items-center gap-1">
                      <span>📐</span>필지 면적
                    </div>
                    <div className="text-base font-bold text-gray-900 tabular-nums leading-tight">
                      {parcelPyeong != null
                        ? `${parcelPyeong.toLocaleString()}평`
                        : "—"}
                    </div>
                    <div className="text-[10px] text-gray-500 tabular-nums truncate">
                      {geometry
                        ? `${geometry.area_m2.toLocaleString()}㎡`
                        : ""}
                      {geometry?.jimok ? ` · ${geometry.jimok}` : ""}
                    </div>
                  </div>
                  <div className="relative pl-2.5 pr-2 py-1.5 bg-emerald-50/70 border border-emerald-200 rounded overflow-hidden">
                    <span className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-400" />
                    <div className="text-[10px] text-emerald-800 font-semibold flex items-center gap-1">
                      <span>🏢</span>자동 감지
                    </div>
                    <div className="text-base font-bold text-gray-900 tabular-nums leading-tight">
                      {buildings.length === 0
                        ? "0평"
                        : `${buildingPyeong.toLocaleString()}평`}
                    </div>
                    <div className="text-[10px] text-gray-500 tabular-nums">
                      {buildings.length}동 ·{" "}
                      {buildingArea.toLocaleString()}㎡
                    </div>
                  </div>
                </div>

                {/* 동별 영역 편집 카드 + 빈 상태 안내 */}
                {buildings.length === 0 ? (
                  <>
                    {bldgRegister.length === 0 && (
                      <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 leading-snug">
                        자동 감지된 건물도, 등록된 건축물대장도 없습니다.
                        <br />
                        노지/빈 토지 부지로 보입니다 — 위 [+ 영역 추가]
                        로 패널 깔 영역을 잡습니다.
                      </div>
                    )}
                    {bldgRegister.length > 0 && (
                      <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-300 rounded px-2 py-1.5 leading-snug">
                        ⚠️ 건축물대장에 <b>{bldgRegister.length}동</b> 등록되어
                        있지만 도로명주소가 미부여되어 자동 폴리곤 데이터가
                        없습니다.
                        <br />
                        위성 사진을 보고 위 [+ 영역 추가] 로 직접 그려주세요.
                      </div>
                    )}
                  </>
                ) : (
                  <ul className="space-y-1.5 text-xs">
                    {buildings.map((b, i) => {
                      const id = makeBuildingId(b);
                      const py = Math.round(b.edited_area_m2 * M2_TO_PYEONG);
                      const origPy = Math.round(b.area_m2 * M2_TO_PYEONG);
                      const isUserAdded = b.source === "user_added";

                      const vertexCount = b.edited_polygon[0]
                        ? Math.max(0, b.edited_polygon[0].length - 1)
                        : 0;

                      const isSelected = selectedBuildingId === id;
                      // 좌측 컬러바 — 상태별 (사용자추가 / 수정 / 자동)
                      const barColor = isUserAdded
                        ? "bg-emerald-400"
                        : b.is_edited
                          ? "bg-blue-400"
                          : "bg-orange-300";
                      return (
                        <li
                          key={id}
                          onClick={(e) => {
                            // 안 쪽 button(stepper / 🗑) 클릭은 bubble 무시
                            if ((e.target as HTMLElement).closest("button"))
                              return;
                            handleSelectBuilding(id);
                          }}
                          className={`relative flex items-center justify-between gap-1.5 pl-3 pr-2 py-1.5 bg-white border rounded group cursor-pointer transition-all overflow-hidden ${
                            isSelected
                              ? "ring-2 ring-yellow-400 border-yellow-500 bg-yellow-50 shadow-sm"
                              : "border-gray-200 hover:border-gray-400 hover:shadow-sm"
                          }`}
                        >
                          <span
                            className={`absolute left-0 top-0 bottom-0 w-1 ${barColor}`}
                          />
                          <span className="truncate flex-1 min-w-0 font-semibold text-gray-900">
                            <BuildingNameEdit
                              value={b.buld_nm || `${i + 1}동`}
                              onChange={(name) => handleBuildingRename(id, name)}
                            />
                            {!isUserAdded && (
                              <span className="text-gray-400 ml-1 font-normal">
                                {b.gro_flo_co}F
                              </span>
                            )}
                            {b.is_edited && (
                              <span className="ml-1 text-[10px] text-blue-700 font-semibold">
                                수정
                              </span>
                            )}
                          </span>
                          <span className="font-bold tabular-nums shrink-0 text-gray-900">
                            {py.toLocaleString()}평
                            {b.is_edited && !isUserAdded && (
                              <span className="text-gray-400 font-normal ml-1 line-through text-[10px]">
                                {origPy.toLocaleString()}평
                              </span>
                            )}
                          </span>
                          <div className="flex items-stretch shrink-0 border border-gray-200 rounded overflow-hidden text-[10px] font-semibold leading-none bg-white">
                            <button
                              onClick={() => handleAutoRemoveVertex(id)}
                              disabled={vertexCount <= 3}
                              className="text-gray-600 hover:bg-gray-100 disabled:bg-gray-50 disabled:text-gray-300 disabled:cursor-not-allowed px-1.5 py-1"
                              title={
                                vertexCount <= 3
                                  ? "최소 3점 — 더 줄일 수 없습니다"
                                  : "각도 가장 평평한 점 자동 삭제 (모양 거의 보존)"
                              }
                              aria-label="점 줄이기"
                            >
                              −
                            </button>
                            <span className="text-gray-700 bg-gray-50 px-1.5 py-1 tabular-nums border-x border-gray-200">
                              점 {vertexCount}
                            </span>
                            <button
                              onClick={() => handleAutoAddVertex(id)}
                              className="text-gray-600 hover:bg-gray-100 px-1.5 py-1"
                              title="가장 긴 변 가운데에 점 추가"
                              aria-label="점 늘리기"
                            >
                              +
                            </button>
                          </div>
                          <button
                            onClick={() => setDeletePendingId(id)}
                            className="text-gray-400 hover:text-red-600 hover:bg-red-50 text-sm leading-none px-1 py-0.5 rounded"
                            title="이 동 삭제"
                            aria-label="삭제"
                          >
                            🗑
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {/* + 영역 추가 / 전체 삭제 — 보조 액션 (편집 카드보다 약하게) */}
                <div className="flex gap-1.5">
                  <button
                    onClick={handleAddBuilding}
                    disabled={!geometry}
                    className="flex-1 text-[11px] font-medium py-1.5 text-gray-500 hover:text-blue-700 bg-transparent hover:bg-blue-50 disabled:text-gray-300 disabled:hover:bg-transparent disabled:cursor-not-allowed border border-dashed border-gray-300 hover:border-blue-300 rounded transition-colors"
                    title="부지 중앙에 15m × 15m 사각형이 등장합니다 — 꼭지점 드래그로 조정"
                  >
                    + 영역 추가
                  </button>
                  <button
                    onClick={() => setShowDeleteAllConfirm(true)}
                    disabled={editableBuildings.length === 0}
                    className="text-[11px] font-medium py-1.5 px-2.5 text-gray-500 hover:text-red-700 bg-transparent hover:bg-red-50 disabled:text-gray-300 disabled:hover:bg-transparent disabled:cursor-not-allowed border border-dashed border-gray-300 hover:border-red-300 rounded transition-colors"
                    title="현재 영역 전부 삭제"
                  >
                    전체 삭제
                  </button>
                </div>
              </>
            )}
          </div>
          )}
          <SectionHeader
            step={2}
            title="견적 산출"
            isExpanded={activeStep === 2}
            onClick={() => toggleStep(2)}
          />
          {activeStep === 2 && (
          <div className="px-4 py-3 space-y-2">
            {buildings.length === 0 ? (
              <div className="text-xs text-gray-400">
                먼저 1단계에서 영역을 그려주세요.
              </div>
            ) : (
              <>
                {/* 모듈 카드 — 시공비/실제 kW에 직결되는 변수라 2단계 상단에 고정 */}
                <ModuleCard
                  module={activeModule}
                  isCustom={isCustomModule}
                  isEditing={isEditingModule}
                  onToggleEdit={() => setIsEditingModule((v) => !v)}
                  onApply={(m) => {
                    setCustomModule(m);
                    setIsEditingModule(false);
                  }}
                  onReset={() => {
                    setCustomModule(null);
                    setIsEditingModule(false);
                  }}
                  onCancel={() => setIsEditingModule(false)}
                />

                {facilityRows.map((row, i) => (
                  <FacilityCard
                    key={row.id}
                    index={i + 1}
                    row={row}
                    isEditingSpec={editingSpecId === row.id}
                    isSelected={selectedBuildingId === row.id}
                    onSelect={() => handleSelectBuilding(row.id)}
                    onFacilityChange={(kind) =>
                      handleFacilityChange(row.id, kind)
                    }
                    onResetFacility={() => handleResetFacility(row.id)}
                    onSpecChange={(spec) => handleSpecChange(row.id, spec)}
                    onResetSpec={() => handleResetSpec(row.id)}
                    onPlacementChange={(placement) =>
                      handlePlacementChange(row.id, placement)
                    }
                    onResetPlacement={() => handleResetPlacement(row.id)}
                    onResetRotation={() => handleResetRotation(row.id)}
                    onRename={(name) => handleBuildingRename(row.id, name)}
                    onToggleEditSpec={() =>
                      setEditingSpecId((prev) =>
                        prev === row.id ? null : row.id,
                      )
                    }
                  />
                ))}
                {/* 합계 — 패널 N장 + 실제 kW + 시공비 (격자 기반, 봉남리 양식 일관) */}
                {totalPanels === 0 ? (
                  <div className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 leading-snug">
                    영역이 모듈 1장보다 작거나 가장자리 이격 적용 후 공간이
                    남지 않습니다. 영역을 더 크게 잡아주세요.
                  </div>
                ) : (
                  <div className="mt-3 px-3 py-2.5 bg-gradient-to-br from-emerald-50 to-blue-50 border border-emerald-200 rounded">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] text-emerald-800 font-semibold">
                        💰 합계
                      </span>
                      <span className="text-[10px] text-gray-500 tabular-nums">
                        {buildings.length}동 · 🔲{" "}
                        {totalPanels.toLocaleString()}장
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-base font-bold text-emerald-900 tabular-nums">
                        {formatKw(totalKwActual)}
                      </span>
                      <span className="text-base font-bold text-emerald-900 tabular-nums">
                        {formatCost(totalCost)}
                      </span>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          )}
          <SectionHeader
            step={3}
            title="도면 출력"
            isExpanded={activeStep === 3}
            onClick={() => toggleStep(3)}
          />
          {activeStep === 3 && (
            <div className="px-4 py-3 space-y-2">
              {buildings.length === 0 || totalPanels === 0 ? (
                <div className="text-xs text-gray-400 leading-snug">
                  먼저 영역과 시설 종류를 정해주세요.
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handlePrintBlueprint}
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg shadow-sm transition-colors"
                  >
                    📄 도면 PDF 저장 ↗
                  </button>
                  <p className="text-[10px] text-gray-500 leading-snug">
                    A3 가로 한 장 · 봉남리 양식 그대로. 새 탭에서 인쇄
                    다이얼로그가 자동으로 떠요. &quot;PDF로 저장&quot; 선택하시면
                    됩니다.
                  </p>
                </>
              )}
            </div>
          )}
          <SectionHeader
            step={4}
            title="수익 분석"
            isExpanded={activeStep === 4}
            onClick={() => toggleStep(4)}
          />
          {activeStep === 4 && (
            <div className="px-4 py-3 space-y-3">
              {totalKw <= 0 ? (
                <div className="text-xs text-gray-400 leading-snug">
                  먼저 영역과 시설 종류부터 정해주세요.
                </div>
              ) : (
                <>
                  {/* 입력 변수 박스 — 펼침/접힘 (모든 변수 관리자 조정 가능 / 의뢰자 컨펌) */}
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowFinanceVars((v) => !v)}
                      className="w-full flex items-center justify-between text-xs font-semibold py-1.5 px-2 bg-white border border-gray-200 rounded hover:bg-gray-50 text-gray-700"
                    >
                      <span className="flex items-center gap-1.5">
                        <span>⚙</span>
                        <span>입력 변수</span>
                        {isFinanceCustomized && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">
                            수정됨
                          </span>
                        )}
                      </span>
                      <span className="text-gray-400">
                        {showFinanceVars ? "▼" : "▶"}
                      </span>
                    </button>
                    {showFinanceVars && (
                      <div className="mt-1.5 px-2 py-2 bg-gray-50 border border-gray-200 rounded space-y-2.5">
                        {/* 발전 */}
                        <VarGroup label="발전">
                          <NumberField
                            label="일발전시간 (h)"
                            value={
                              varOverrides.dailyHours ??
                              DEFAULT_FINANCE_INPUT.dailyHours
                            }
                            step={0.1}
                            onChange={(n) =>
                              setVarOverrides((p) => ({ ...p, dailyHours: n }))
                            }
                          />
                          <NumberField
                            label="열화율 (%/년)"
                            value={
                              (varOverrides.annualDecay ??
                                DEFAULT_FINANCE_INPUT.annualDecay) * 100
                            }
                            step={0.1}
                            onChange={(n) =>
                              setVarOverrides((p) => ({
                                ...p,
                                annualDecay: n / 100,
                              }))
                            }
                          />
                        </VarGroup>

                        {/* 수익 */}
                        <VarGroup label="수익">
                          <NumberField
                            label="SMP (원/kWh)"
                            value={
                              varOverrides.smpPrice ??
                              DEFAULT_FINANCE_INPUT.smpPrice
                            }
                            onChange={(n) =>
                              setVarOverrides((p) => ({ ...p, smpPrice: n }))
                            }
                          />
                          <NumberField
                            label="REC (원/kWh)"
                            value={
                              varOverrides.recPrice ??
                              DEFAULT_FINANCE_INPUT.recPrice
                            }
                            onChange={(n) =>
                              setVarOverrides((p) => ({ ...p, recPrice: n }))
                            }
                          />
                          <NumberField
                            label="REC 가중치"
                            value={
                              varOverrides.recWeight ??
                              DEFAULT_FINANCE_INPUT.recWeight
                            }
                            step={0.1}
                            onChange={(n) =>
                              setVarOverrides((p) => ({ ...p, recWeight: n }))
                            }
                          />
                          <NumberField
                            label="유지보수 (매출%)"
                            value={
                              (varOverrides.maintenanceRate ??
                                DEFAULT_FINANCE_INPUT.maintenanceRate) * 100
                            }
                            step={0.1}
                            onChange={(n) =>
                              setVarOverrides((p) => ({
                                ...p,
                                maintenanceRate: n / 100,
                              }))
                            }
                          />
                        </VarGroup>

                        {/* 비용 */}
                        <VarGroup label="비용">
                          <NumberField
                            label="공사비 (만원, 부가세별도)"
                            value={Math.round(
                              (costOverride ?? totalCost) / 10_000,
                            )}
                            step={100}
                            onChange={(n) =>
                              setCostOverride(n * 10_000)
                            }
                            colSpan={2}
                          />
                          <NumberField
                            label="부가세율 (%)"
                            value={
                              (varOverrides.vatRate ??
                                DEFAULT_FINANCE_INPUT.vatRate) * 100
                            }
                            step={0.5}
                            onChange={(n) =>
                              setVarOverrides((p) => ({
                                ...p,
                                vatRate: n / 100,
                              }))
                            }
                          />
                          <div className="text-[10px] text-gray-500 leading-snug self-end pb-1">
                            2단계 합계 = {formatMoneyShort(totalCost)}
                          </div>
                        </VarGroup>

                        {/* 대출 — 대출 시나리오만 노출 */}
                        {loanScenario !== "자기자본" && (
                          <VarGroup label="대출">
                            <NumberField
                              label="대출액 (총사업비 %)"
                              value={loanRatioPct}
                              step={5}
                              onChange={(n) =>
                                setLoanRatioPct(Math.max(0, Math.min(100, n)))
                              }
                            />
                            <NumberField
                              label="금리 (%/년)"
                              value={
                                (varOverrides.loanRate ??
                                  DEFAULT_FINANCE_INPUT.loanRate) * 100
                              }
                              step={0.1}
                              onChange={(n) =>
                                setVarOverrides((p) => ({
                                  ...p,
                                  loanRate: n / 100,
                                }))
                              }
                            />
                            <NumberField
                              label="거치기간 (개월)"
                              value={
                                varOverrides.graceMonths ??
                                DEFAULT_FINANCE_INPUT.graceMonths
                              }
                              onChange={(n) =>
                                setVarOverrides((p) => ({
                                  ...p,
                                  graceMonths: Math.max(0, Math.round(n)),
                                }))
                              }
                            />
                            <div className="text-[10px] text-gray-500 leading-snug self-end pb-1 col-span-2">
                              거치 후 원리금 균등상환 ·{" "}
                              <b className="text-gray-700">
                                총{" "}
                                {Math.round(
                                  ((varOverrides.graceMonths ??
                                    DEFAULT_FINANCE_INPUT.graceMonths) +
                                    getRepayMonths(loanScenario)) /
                                    12,
                                )}
                                년
                              </b>{" "}
                              걸쳐 갚음 (봉남리 양식)
                            </div>
                          </VarGroup>
                        )}

                        {/* 리셋 */}
                        {isFinanceCustomized && (
                          <button
                            type="button"
                            onClick={resetFinanceVars}
                            className="w-full text-[11px] py-1 text-gray-500 hover:text-blue-700 border border-dashed border-gray-300 hover:border-blue-300 rounded"
                          >
                            ↺ 모든 변수 디폴트로 되돌리기
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 시나리오 토글 — 자기자본 / 10년 / 15년 / 20년 (봉남리 양식 + 15년 추가) */}
                  <div className="grid grid-cols-4 gap-1.5">
                    {(["자기자본", "10년", "15년", "20년"] as LoanScenario[]).map(
                      (s) => {
                        const active = loanScenario === s;
                        const label =
                          s === "자기자본" ? "자기자본" : `${s} 대출`;
                        return (
                          <button
                            key={s}
                            onClick={() => setLoanScenario(s)}
                            className={`text-xs font-semibold py-1.5 rounded border transition-colors ${
                              active
                                ? "bg-blue-600 text-white border-blue-700 shadow-sm"
                                : "bg-white text-gray-700 border-gray-300 hover:bg-blue-50"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      },
                    )}
                  </div>

                  {/* 결과 요약 카드 4종 */}
                  <div className="grid grid-cols-2 gap-2">
                    <FinanceSummaryCard
                      label="ROI"
                      value={`${(financeResult.roi * 100).toFixed(1)}%`}
                      sub="1년차 / 총사업비"
                      tone="amber"
                    />
                    <FinanceSummaryCard
                      label="손익분기"
                      value={
                        financeResult.paybackYears == null
                          ? "20년+"
                          : `${financeResult.paybackYears.toFixed(1)}년`
                      }
                      sub={
                        financeResult.paybackYears == null
                          ? "20년 내 회수 어려움"
                          : "투자금 회수 시점"
                      }
                      tone="emerald"
                    />
                    <FinanceSummaryCard
                      label={
                        loanScenario === "자기자본"
                          ? "20년 총수익"
                          : "20년 총수익 (대출후)"
                      }
                      value={formatMoneyShort(
                        loanScenario === "자기자본"
                          ? financeResult.totalNetIncome
                          : financeResult.totalAfterLoan,
                      )}
                      sub={`${formatMoneyShort(financeResult.totalCost)} 투자`}
                      tone="blue"
                    />
                    <FinanceSummaryCard
                      label={
                        loanScenario === "자기자본"
                          ? "평균 순수익(年)"
                          : "평균 순수익(年, 대출후)"
                      }
                      value={formatMoneyShort(
                        loanScenario === "자기자본"
                          ? financeResult.avgAnnualNet
                          : financeResult.totalAfterLoan /
                              financeInput.years,
                      )}
                      sub={`月 ${formatMoneyShort(
                        (loanScenario === "자기자본"
                          ? financeResult.avgAnnualNet
                          : financeResult.totalAfterLoan /
                            financeInput.years) / 12,
                      )}`}
                      tone="sky"
                    />
                  </div>

                  {/* 20년 시계열 표 — 모달로 (좌측 패널 좁아서 풀 사이즈로 빼냄) */}
                  <button
                    type="button"
                    onClick={() => setShowFinanceTable(true)}
                    className="w-full flex items-center justify-between text-xs font-semibold py-2 px-2.5 bg-white border border-gray-200 rounded hover:bg-blue-50 hover:border-blue-300 text-gray-700"
                  >
                    <span className="flex items-center gap-1.5">
                      <span>📊</span>
                      <span>20년 시계열 표 보기</span>
                      <span className="text-[9px] text-gray-400 font-normal">
                        (봉남리 양식)
                      </span>
                    </span>
                    <span className="text-blue-600">⤢</span>
                  </button>

                  {/* 수익 분석 PDF 저장 — 봉남리 견적서 양식 A3 1페이지 */}
                  <button
                    type="button"
                    onClick={handlePrintFinance}
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg shadow-sm transition-colors"
                  >
                    💰 수익 분석 PDF 저장 ↗
                  </button>
                  <p className="text-[10px] text-gray-500 leading-snug">
                    A3 가로 한 장 · 봉남리 견적서 양식 · 새 탭에서 인쇄
                    다이얼로그 자동. &quot;PDF로 저장&quot; 선택.
                  </p>
                </>
              )}
            </div>
          )}
        </aside>

        {/* 중앙 지도 */}
        <main className="flex-1 min-w-0 relative bg-gray-200">
          {error ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="bg-white border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            </div>
          ) : (
            <QuoteMap
              parcelPolygon={geometry?.polygon ?? null}
              buildings={editableBuildings}
              onBuildingChange={handleBuildingChange}
              onRemoveVertex={handleRemoveVertex}
              fallbackCenter={geometry?.center}
              selectedBuildingId={selectedBuildingId}
              onSelectBuilding={handleSelectBuilding}
              onRequestDelete={handleRequestDelete}
              onRotationChange={handleRotationChange}
              onResetRotation={handleResetRotation}
            />
          )}
          {(loadingParcel || loadingBuildings) && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-white/95 border border-gray-300 rounded-full px-3 py-1 text-xs text-gray-700 shadow">
              불러오는 중…
            </div>
          )}
        </main>
      </div>

      {/* 삭제 확인 중앙 모달 — 라벨 X / 좌측 카드 🗑 둘 다 트리거 가능 */}
      {pendingDeleteBuilding && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setDeletePendingId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-lg shadow-2xl border border-gray-200 px-5 py-4 w-[320px] max-w-[calc(100%-32px)]"
          >
            <div className="text-base font-bold text-gray-900 mb-1.5">
              영역 삭제
            </div>
            <div className="text-sm text-gray-700 leading-relaxed mb-4">
              <b className="text-red-600">{pendingDeleteBuilding.name}</b>{" "}
              <span className="text-gray-500 tabular-nums">
                ({pendingDeleteBuilding.pyeong.toLocaleString()}평)
              </span>{" "}
              을(를) 정말 삭제하시겠습니까?
              <br />
              <span className="text-xs text-gray-500">
                삭제하면 되돌릴 수 없습니다.
              </span>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeletePendingId(null)}
                className="px-3 py-1.5 text-sm text-gray-700 bg-white hover:bg-gray-100 border border-gray-300 rounded"
              >
                취소
              </button>
              <button
                onClick={() => {
                  handleDeleteBuilding(pendingDeleteBuilding.id);
                  setDeletePendingId(null);
                }}
                className="px-3 py-1.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded"
              >
                정말 삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 전체 삭제 확인 모달 */}
      {showDeleteAllConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setShowDeleteAllConfirm(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-lg shadow-2xl border border-gray-200 px-5 py-4 w-[320px] max-w-[calc(100%-32px)]"
          >
            <div className="text-base font-bold text-gray-900 mb-1.5">
              전체 영역 삭제
            </div>
            <div className="text-sm text-gray-700 leading-relaxed mb-4">
              현재 <b className="text-red-600">{editableBuildings.length}동</b>{" "}
              전부 삭제하시겠습니까?
              <br />
              <span className="text-xs text-gray-500">
                삭제하면 되돌릴 수 없습니다.
              </span>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowDeleteAllConfirm(false)}
                className="px-3 py-1.5 text-sm text-gray-700 bg-white hover:bg-gray-100 border border-gray-300 rounded"
              >
                취소
              </button>
              <button
                onClick={() => {
                  setBuildings([]);
                  setShowDeleteAllConfirm(false);
                }}
                className="px-3 py-1.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded"
              >
                정말 삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 20년 시계열 표 모달 — 좌측 패널 좁아 풀 사이즈 모달로 */}
      {showFinanceTable && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setShowFinanceTable(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-lg shadow-2xl border border-gray-200 max-w-6xl w-full max-h-[90vh] flex flex-col"
          >
            {/* 헤더 */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <div className="flex items-baseline gap-3">
                <h2 className="text-base font-bold text-gray-900">
                  📊 20년 수익 분석 시계열
                </h2>
                <span className="text-xs text-gray-500">
                  {loanScenario === "자기자본"
                    ? "자기자본 100%"
                    : `${loanScenario} 대출`}{" "}
                  · ROI {(financeResult.roi * 100).toFixed(1)}% · 손익분기{" "}
                  {financeResult.paybackYears == null
                    ? "20년+"
                    : `${financeResult.paybackYears.toFixed(1)}년`}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowFinanceTable(false)}
                className="text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded w-7 h-7 flex items-center justify-center text-lg"
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            {/* 본문 — 표 (가로 스크롤 + 세로 스크롤) */}
            <div className="flex-1 overflow-auto p-4">
              <FinanceTable
                result={financeResult}
                scenario={loanScenario}
              />
            </div>
            {/* 푸터 — 단위 안내 */}
            <div className="px-5 py-2 border-t border-gray-200 text-[10px] text-gray-500 bg-gray-50 rounded-b-lg">
              단위: 발전량 kWh / 그 외 원. 봉남리 양식 그대로.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 보조 컴포넌트
// ─────────────────────────────────────────────

function SectionHeader({
  step,
  title,
  isExpanded,
  onClick,
}: {
  step: number;
  title: string;
  isExpanded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative w-full flex items-center gap-2.5 pl-4 pr-3 py-3 border-b transition-colors text-left ${
        isExpanded
          ? "bg-blue-600 border-blue-700 shadow-sm"
          : "bg-white border-gray-200 hover:bg-blue-50"
      }`}
    >
      {/* 좌측 강조 바 (활성 시) */}
      {isExpanded && (
        <span
          className="absolute left-0 top-0 bottom-0 w-1 bg-blue-300"
          aria-hidden="true"
        />
      )}
      <span
        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
          isExpanded
            ? "bg-white text-blue-700"
            : "bg-gray-100 text-gray-500 border border-gray-300"
        }`}
      >
        {step}
      </span>
      <span
        className={`flex-1 text-sm font-semibold ${
          isExpanded ? "text-white" : "text-gray-800"
        }`}
      >
        {title}
      </span>
      <span
        className={`text-xs transition-transform shrink-0 ${
          isExpanded ? "text-white rotate-0" : "text-gray-400 -rotate-90"
        }`}
        aria-hidden="true"
      >
        ▼
      </span>
    </button>
  );
}

// ── 5단계 수지분석 보조 ──────────────────────────────

/** 큰 금액 → 짧게 (억/만 단위, 봉남리 영업 자료 톤) */
function formatMoneyShort(won: number): string {
  if (!Number.isFinite(won) || won === 0) return "0원";
  const sign = won < 0 ? "-" : "";
  const abs = Math.abs(won);
  if (abs >= 100_000_000) {
    const eok = abs / 100_000_000;
    return `${sign}${eok.toFixed(eok >= 10 ? 1 : 2)}억`;
  }
  if (abs >= 10_000) {
    return `${sign}${Math.round(abs / 10_000).toLocaleString()}만`;
  }
  return `${sign}${Math.round(abs).toLocaleString()}원`;
}

const SUMMARY_TONE: Record<
  "amber" | "emerald" | "blue" | "sky",
  { bar: string; bg: string; label: string }
> = {
  amber: { bar: "bg-amber-400", bg: "bg-amber-50/70", label: "text-amber-800" },
  emerald: {
    bar: "bg-emerald-400",
    bg: "bg-emerald-50/70",
    label: "text-emerald-800",
  },
  blue: { bar: "bg-blue-400", bg: "bg-blue-50/70", label: "text-blue-800" },
  sky: { bar: "bg-sky-400", bg: "bg-sky-50/70", label: "text-sky-800" },
};

function VarGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className="grid grid-cols-2 gap-1.5">{children}</div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step,
  colSpan,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
  colSpan?: 1 | 2;
}) {
  return (
    <label
      className={`block ${colSpan === 2 ? "col-span-2" : ""}`}
    >
      <span className="block text-[10px] text-gray-600 mb-0.5 truncate">
        {label}
      </span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step ?? 1}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        className="w-full px-1.5 py-1 text-xs text-gray-900 bg-white border border-gray-300 rounded tabular-nums focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
      />
    </label>
  );
}

function FinanceSummaryCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: keyof typeof SUMMARY_TONE;
}) {
  const t = SUMMARY_TONE[tone];
  return (
    <div
      className={`relative pl-2.5 pr-2 py-1.5 ${t.bg} border border-gray-200 rounded overflow-hidden`}
    >
      <span className={`absolute left-0 top-0 bottom-0 w-1 ${t.bar}`} />
      <div className={`text-[10px] font-semibold ${t.label}`}>{label}</div>
      <div className="text-base font-bold text-gray-900 tabular-nums leading-tight">
        {value}
      </div>
      {sub && (
        <div className="text-[10px] text-gray-500 tabular-nums truncate">
          {sub}
        </div>
      )}
    </div>
  );
}

interface FacilityRow {
  id: string;
  building: EditedBuilding;
  auto: FacilityKind;
  kind: FacilityKind;
  spec: FacilitySpec;
  /** 시설별 이격거리 (override 적용 후 최종값) */
  placement: PlacementSpec;
  py: number;
  /** 격자 알고리즘 결과 패널 갯수 */
  panelCount: number;
  /** 실제 kW = panelCount × 모듈 와트 (격자 기반) */
  kw: number;
  cost: number;
  /** 적용된 패널 회전각 (degrees, 0~180) */
  rotation: number;
  isAutoKind: boolean;
  isCustomSpec: boolean;
  isCustomPlacement: boolean;
  /** 사용자가 핸들로 회전 직접 조작했는지 */
  isCustomRotation: boolean;
}

interface FacilityCardProps {
  index: number;
  row: FacilityRow;
  isEditingSpec: boolean;
  onFacilityChange: (kind: FacilityKind) => void;
  onResetFacility: () => void;
  onSpecChange: (spec: FacilitySpec) => void;
  onResetSpec: () => void;
  onPlacementChange: (placement: PlacementSpec) => void;
  onResetPlacement: () => void;
  /** 회전 자동 복귀 — 핸들 dblclick 또는 카드 ↺ */
  onResetRotation: () => void;
  /** 동 이름(buld_nm) 직접 수정 — ✎ 클릭 → 인라인 input */
  onRename: (newName: string) => void;
  onToggleEditSpec: () => void;
  /** 지도/카드 양방향 동 선택 강조 */
  isSelected?: boolean;
  onSelect?: () => void;
}

/**
 * 좌측 "2 견적 산출" 동별 카드.
 * 시설 종류 셀렉트박스 + 단가 인라인 편집 + 패널/kW/시공비 표시.
 * 카드 클릭 = 지도 폴리곤 노란 강조 + 좌측 카드 노란 ring.
 */
function FacilityCard({
  index,
  row,
  isEditingSpec,
  onFacilityChange,
  onResetFacility,
  onSpecChange,
  onResetSpec,
  onPlacementChange,
  onResetPlacement,
  onResetRotation,
  onRename,
  onToggleEditSpec,
  isSelected,
  onSelect,
}: FacilityCardProps) {
  const {
    building: b,
    auto,
    kind,
    spec,
    placement,
    py,
    panelCount,
    kw,
    cost,
    rotation,
    isAutoKind,
    isCustomSpec,
    isCustomPlacement,
    isCustomRotation,
  } = row;
  const py_round = Math.round(py);
  const isCustomized = isCustomSpec || isCustomPlacement || isCustomRotation;
  // 직사각형 패널은 180° 대칭이라 표시는 0~180 정규화 (200° → 20°).
  // 핸들 좌표는 0~360 그대로 두어 사용자가 끈 위치에 머물게 함.
  const rotation_round = ((Math.round(rotation) % 180) + 180) % 180;

  // 인라인 편집 로컬 입력값 (확정 전까지 휘발)
  // 평/kW 는 격자 기반 도입 후 dead 변수 → UI 에서 제거. 단가 + 이격거리만 편집.
  const [draftCostMan, setDraftCostMan] = useState(
    (spec.costPerKw / 10000).toString(),
  );
  const [draftRowGap, setDraftRowGap] = useState(placement.rowGapM.toString());
  const [draftEdgeInset, setDraftEdgeInset] = useState(
    placement.edgeInsetM.toString(),
  );

  // 외부 변경 (시설 종류 변경/원래대로 등) 시 입력칸도 동기화
  useEffect(() => {
    setDraftCostMan((spec.costPerKw / 10000).toString());
    setDraftRowGap(placement.rowGapM.toString());
    setDraftEdgeInset(placement.edgeInsetM.toString());
  }, [spec, placement, isEditingSpec]);

  const handleApply = () => {
    const c = Number(draftCostMan);
    const r = Number(draftRowGap);
    const e = Number(draftEdgeInset);
    if (!Number.isFinite(c) || c <= 0) return;
    if (!Number.isFinite(r) || r < 0) return;
    if (!Number.isFinite(e) || e < 0) return;
    // 단가는 pyeongPerKw 디폴트 유지 (UI에선 안 쓰지만 타입 보존)
    onSpecChange({ pyeongPerKw: spec.pyeongPerKw, costPerKw: c * 10000 });
    onPlacementChange({
      rowGapM: r,
      colGapM: placement.colGapM,
      edgeInsetM: e,
      rotation: placement.rotation,
    });
    onToggleEditSpec();
  };

  const handleResetAll = () => {
    onResetSpec();
    onResetPlacement();
    onToggleEditSpec();
  };

  return (
    <div
      onClick={(e) => {
        // 안 쪽 button/select/input 등 클릭은 카드 선택 무시 (편집 차단 방지)
        const target = e.target as HTMLElement;
        if (target.closest("button, select, input, label")) return;
        onSelect?.();
      }}
      className={`px-2.5 py-2 border rounded cursor-pointer transition-all ${
        isSelected
          ? "ring-2 ring-yellow-400 border-yellow-500 bg-yellow-50 shadow-sm"
          : isCustomized || !isAutoKind
            ? "bg-blue-50/60 border-blue-200 hover:border-blue-400"
            : "bg-white border-gray-200 hover:border-gray-400 hover:shadow-sm"
      }`}
    >
      {/* 동명 + 평수 */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-xs text-gray-700 truncate">
            <BuildingNameEdit
              value={b.buld_nm || `${index}동`}
              onChange={onRename}
              className="font-bold"
            />
          </span>
          {!isAutoKind && (
            <button
              onClick={onResetFacility}
              className="text-[9px] px-1 py-px bg-amber-100 text-amber-700 rounded hover:bg-amber-200 shrink-0"
              title={`자동 추천(${FACILITY_LABEL[auto]})으로 되돌리기`}
            >
              수동
            </button>
          )}
        </div>
        <span className="text-[11px] text-gray-500 tabular-nums shrink-0">
          {py_round.toLocaleString()}평
        </span>
      </div>

      {/* 시설 종류 셀렉트 */}
      <select
        value={kind}
        onChange={(e) => onFacilityChange(e.target.value as FacilityKind)}
        className="w-full text-xs text-gray-900 px-2 py-1 border border-gray-300 rounded bg-white hover:border-gray-400 focus:border-blue-500 focus:outline-none"
      >
        {FACILITY_KINDS.map((k) => {
          const s = FACILITY_SPEC[k];
          const cost = (s.costPerKw / 10000).toLocaleString();
          return (
            <option key={k} value={k}>
              {FACILITY_LABEL[k]} — {cost}만/kW
              {k === auto ? " (자동)" : ""}
            </option>
          );
        })}
      </select>

      {/* 배치/단가 표시 또는 편집 */}
      {!isEditingSpec ? (
        <>
          <div className="flex items-center justify-between gap-2 mt-1.5 text-[10px] text-gray-500">
            <span className="truncate">
              행간 {placement.rowGapM}m · 가장자리 {placement.edgeInsetM}m ·{" "}
              {(spec.costPerKw / 10000).toLocaleString()}만/kW
              {isCustomized && (
                <span className="ml-1 text-blue-700 font-semibold">수정됨</span>
              )}
            </span>
            <button
              onClick={onToggleEditSpec}
              className="text-[10px] px-1.5 py-0.5 text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded shrink-0"
            >
              ✏ 편집
            </button>
          </div>
          {/* 패널 회전 — 지도 위 ◯ 핸들로 직접 회전. 카드는 표시 + 자동 복귀만. */}
          <div className="flex items-center justify-between gap-2 mt-1 text-[10px] text-gray-500">
            <span className="truncate">
              <span title="지도의 ◯ 핸들을 끌어 패널 방향 조정. Shift = 15° 스냅, 더블클릭 = 자동 복귀">
                패널 회전: <b className={isCustomRotation ? "text-blue-700" : ""}>{rotation_round}°</b>
              </span>
              {isCustomRotation ? (
                <span className="ml-1 text-blue-700">(수동)</span>
              ) : (
                <span className="ml-1 text-gray-400">(자동)</span>
              )}
            </span>
            {isCustomRotation && (
              <button
                onClick={onResetRotation}
                className="text-[10px] px-1.5 py-0.5 text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded shrink-0"
                title="시설별 자동 회전으로 복귀"
              >
                ↺ 자동
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="mt-1.5 px-2 py-1.5 bg-amber-50 border border-amber-200 rounded space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-gray-700 w-20 shrink-0">행간 (그림자)</span>
            <input
              type="number"
              step="0.1"
              min="0"
              value={draftRowGap}
              onChange={(e) => setDraftRowGap(e.target.value)}
              className="flex-1 min-w-0 px-1.5 py-0.5 border border-gray-300 rounded text-gray-900 bg-white tabular-nums focus:border-blue-500 focus:outline-none"
            />
            <span className="text-gray-500 shrink-0">m</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-gray-700 w-20 shrink-0">가장자리</span>
            <input
              type="number"
              step="0.1"
              min="0"
              value={draftEdgeInset}
              onChange={(e) => setDraftEdgeInset(e.target.value)}
              className="flex-1 min-w-0 px-1.5 py-0.5 border border-gray-300 rounded text-gray-900 bg-white tabular-nums focus:border-blue-500 focus:outline-none"
            />
            <span className="text-gray-500 shrink-0">m</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-gray-700 w-20 shrink-0">kW당 시공비</span>
            <input
              type="number"
              step="1"
              min="1"
              value={draftCostMan}
              onChange={(e) => setDraftCostMan(e.target.value)}
              className="flex-1 min-w-0 px-1.5 py-0.5 border border-gray-300 rounded text-gray-900 bg-white tabular-nums focus:border-blue-500 focus:outline-none"
            />
            <span className="text-gray-500 shrink-0">만원</span>
          </div>
          <div className="flex justify-between gap-1">
            {isCustomized ? (
              <button
                onClick={handleResetAll}
                className="text-[10px] px-2 py-1 text-gray-600 bg-white hover:bg-gray-100 border border-gray-300 rounded"
              >
                원래대로
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-1">
              <button
                onClick={onToggleEditSpec}
                className="text-[10px] px-2 py-1 text-gray-600 bg-white hover:bg-gray-100 border border-gray-300 rounded"
              >
                취소
              </button>
              <button
                onClick={handleApply}
                className="text-[10px] px-2 py-1 text-white bg-blue-600 hover:bg-blue-700 rounded"
              >
                ✓ 적용
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 패널 N장 + 실제 kW + 시공비 (격자 기반, 봉남리 양식 일관) */}
      <div className="mt-1.5 pt-1.5 border-t border-gray-100">
        <div className="flex items-center justify-between gap-2 text-[11px] text-gray-500 tabular-nums">
          <span>🔲 {panelCount.toLocaleString()}장</span>
          <span className="text-gray-400 text-[10px]">실측 격자</span>
        </div>
        <div className="flex items-baseline justify-between gap-2 mt-0.5">
          <span className="text-sm font-bold text-emerald-700 tabular-nums">
            {formatKw(kw)}
          </span>
          <span className="text-sm font-bold text-gray-900 tabular-nums">
            {formatCost(cost)}
          </span>
        </div>
      </div>
    </div>
  );
}

interface ModuleCardProps {
  module: PanelModule;
  isCustom: boolean;
  isEditing: boolean;
  onToggleEdit: () => void;
  onApply: (m: PanelModule) => void;
  onReset: () => void;
  onCancel: () => void;
}

/**
 * 패널 모듈 카드 — 디폴트(AIKO 670W) 표시 + 사용자 변경.
 * 의뢰자 추가 요청 (2026-04-27): "패널 크기가 회사마다 틀리니 가로/세로/높이 변수로 수정 가능"
 */
function ModuleCard({
  module,
  isCustom,
  isEditing,
  onToggleEdit,
  onApply,
  onReset,
  onCancel,
}: ModuleCardProps) {
  // 인라인 편집 로컬 입력값
  const [draftName, setDraftName] = useState(module.name);
  const [draftWidth, setDraftWidth] = useState(module.widthMm.toString());
  const [draftHeight, setDraftHeight] = useState(module.heightMm.toString());
  const [draftThickness, setDraftThickness] = useState(
    module.thicknessMm.toString(),
  );
  const [draftWatt, setDraftWatt] = useState(module.watt.toString());

  // 외부 module 변경(원래대로 클릭 등) 시 입력값 동기화
  useEffect(() => {
    setDraftName(module.name);
    setDraftWidth(module.widthMm.toString());
    setDraftHeight(module.heightMm.toString());
    setDraftThickness(module.thicknessMm.toString());
    setDraftWatt(module.watt.toString());
  }, [module, isEditing]);

  const handleApply = () => {
    const w = Number(draftWidth);
    const h = Number(draftHeight);
    const t = Number(draftThickness);
    const wp = Number(draftWatt);
    const name = draftName.trim();
    if (!name) return;
    if (!Number.isFinite(w) || w <= 0) return;
    if (!Number.isFinite(h) || h <= 0) return;
    if (!Number.isFinite(t) || t <= 0) return;
    if (!Number.isFinite(wp) || wp <= 0) return;
    onApply({
      name,
      widthMm: w,
      heightMm: h,
      thicknessMm: t,
      watt: wp,
    });
  };

  if (!isEditing) {
    return (
      <div
        className={`px-3 py-2 border rounded ${
          isCustom
            ? "bg-blue-50/60 border-blue-200"
            : "bg-white border-gray-200"
        }`}
      >
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-[11px] font-semibold text-gray-700">
            🔧 {module.name}
            {isCustom && (
              <span className="ml-1 text-[10px] text-blue-700 font-bold">
                수정됨
              </span>
            )}
          </span>
          <button
            onClick={onToggleEdit}
            className="text-[10px] px-1.5 py-0.5 text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded shrink-0"
          >
            ✏ 모듈
          </button>
        </div>
        <div className="text-[10px] text-gray-500 tabular-nums leading-snug">
          {module.widthMm.toLocaleString()} × {module.heightMm.toLocaleString()}{" "}
          × {module.thicknessMm}mm · {module.watt}Wp
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded space-y-1.5">
      <div className="text-[11px] font-semibold text-amber-900 mb-1">
        🔧 모듈 사양 변경
      </div>
      <ModuleField label="모듈명" type="text">
        <input
          type="text"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          className="flex-1 min-w-0 px-1.5 py-0.5 border border-gray-300 rounded text-gray-900 bg-white focus:border-blue-500 focus:outline-none"
        />
      </ModuleField>
      <ModuleField label="가로" unit="mm">
        <input
          type="number"
          step="1"
          min="1"
          value={draftWidth}
          onChange={(e) => setDraftWidth(e.target.value)}
          className="flex-1 min-w-0 px-1.5 py-0.5 border border-gray-300 rounded text-gray-900 bg-white tabular-nums focus:border-blue-500 focus:outline-none"
        />
      </ModuleField>
      <ModuleField label="세로" unit="mm">
        <input
          type="number"
          step="1"
          min="1"
          value={draftHeight}
          onChange={(e) => setDraftHeight(e.target.value)}
          className="flex-1 min-w-0 px-1.5 py-0.5 border border-gray-300 rounded text-gray-900 bg-white tabular-nums focus:border-blue-500 focus:outline-none"
        />
      </ModuleField>
      <ModuleField label="두께" unit="mm">
        <input
          type="number"
          step="1"
          min="1"
          value={draftThickness}
          onChange={(e) => setDraftThickness(e.target.value)}
          className="flex-1 min-w-0 px-1.5 py-0.5 border border-gray-300 rounded text-gray-900 bg-white tabular-nums focus:border-blue-500 focus:outline-none"
        />
      </ModuleField>
      <ModuleField label="와트" unit="Wp">
        <input
          type="number"
          step="1"
          min="1"
          value={draftWatt}
          onChange={(e) => setDraftWatt(e.target.value)}
          className="flex-1 min-w-0 px-1.5 py-0.5 border border-gray-300 rounded text-gray-900 bg-white tabular-nums focus:border-blue-500 focus:outline-none"
        />
      </ModuleField>
      <div className="flex justify-between gap-1 pt-1">
        {isCustom ? (
          <button
            onClick={onReset}
            className="text-[10px] px-2 py-1 text-gray-600 bg-white hover:bg-gray-100 border border-gray-300 rounded"
            title="AIKO 670W 디폴트로 복원"
          >
            원래대로
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-1">
          <button
            onClick={onCancel}
            className="text-[10px] px-2 py-1 text-gray-600 bg-white hover:bg-gray-100 border border-gray-300 rounded"
          >
            취소
          </button>
          <button
            onClick={handleApply}
            className="text-[10px] px-2 py-1 text-white bg-blue-600 hover:bg-blue-700 rounded"
          >
            ✓ 적용
          </button>
        </div>
      </div>
    </div>
  );
}

function ModuleField({
  label,
  unit,
  children,
}: {
  label: string;
  unit?: string;
  type?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <span className="text-gray-700 w-12 shrink-0">{label}</span>
      {children}
      {unit && <span className="text-gray-500 shrink-0">{unit}</span>}
    </div>
  );
}

/**
 * 동 이름 인라인 편집 — ✎ 클릭 → input → Enter/blur 로 확정.
 * 기본값 = 자동 동 번호 (b.buld_nm). 견적서 PDF 까지 그대로 노출되니 자유 입력.
 *
 * Props:
 *   - value: 현재 이름
 *   - onChange: 새 이름 (trim 후 비어있으면 호출 안 됨 — 부모에서도 검증)
 *   - className: 표시 모드의 텍스트 스타일 (편집 모드는 기본 input 스타일)
 */
function BuildingNameEdit({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (newName: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  // 외부 value 변경 시 draft 동기화 (편집 중이 아닐 때만)
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onChange(trimmed);
    else setDraft(value);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        onClick={(e) => e.stopPropagation()}
        className="px-1 py-0 text-xs text-gray-900 bg-white border border-blue-400 rounded outline-none focus:ring-1 focus:ring-blue-200 max-w-[8rem]"
      />
    );
  }

  return (
    <span className="inline-flex items-center gap-1 min-w-0">
      <span className={className}>{value}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setDraft(value);
          setEditing(true);
        }}
        className="text-gray-400 hover:text-blue-600 text-[10px] leading-none px-1 py-0.5 rounded hover:bg-blue-50 shrink-0"
        title="이름 수정"
        aria-label="이름 수정"
      >
        ✎
      </button>
    </span>
  );
}

