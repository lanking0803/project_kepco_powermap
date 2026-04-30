"use client";

/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect --
 * 카카오 SDK 는 비동기 로드 + 동적 글로벌(window.kakao.maps) 패턴이라 strict typing 부적합.
 * SDK 로드 완료 → setLoaded(true) 패턴은 외부 시스템 동기화로 set-state-in-effect 의도된 케이스.
 * 메인 components/map/KakaoMap.tsx 와 동일 처리 (코드베이스 일관성).
 */

/**
 * 견적 모드 전용 카카오맵 — 단일 PNU 시각화 + 건물 폴리곤 편집.
 *
 * 책임:
 *   - SDK 로드 (메인이 먼저 로드했어도 재사용)
 *   - 위성+도로 하이브리드 (옥상 식별)
 *   - 필지 폴리곤 (노란 외곽선, 편집 X)
 *   - 건물 폴리곤 (주황 채움, 편집 가능):
 *      * 꼭지점마다 작은 동그라미 마커 (draggable)
 *      * dragend → polygon path 갱신 + 면적 재계산 → 부모 콜백
 *      * 폴리곤 중앙에 "N평" CustomOverlay 라벨
 *
 * 편집 정책 (의뢰자 결정 2026-04-26):
 *   - Q1: 모든 동의 마커 동시 표시 (다중 동도 일관성)
 *   - Q2: dragend 후만 갱신 (drag 중 실시간 X — 성능)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { Position } from "geojson";
import {
  updateVertex,
  calcAreaM2,
  polygonCenter,
  toPyeong,
  translatePolygon,
} from "@/lib/geometry/polygon-edit";

const KAKAO_JS_KEY = process.env.NEXT_PUBLIC_KAKAO_JS_KEY || "";

declare global {
  interface Window {
    kakao: any;
  }
}

/** 편집 가능한 건물 단위 — id 로 부모 state 와 sync */
export interface EditableBuilding {
  id: string;
  /** 라벨 표시용 동 이름 — 우측 카드와 동일 ("1동" / "공장A" 등) */
  name: string;
  polygon: Position[][];
  area_m2: number;
  /** 3단계 격자 알고리즘 결과 — 패널 N개 4꼭지점 폴리곤 (closed ring, [lng, lat]) */
  panels?: Position[][];
  /** 회전된 bbox 의 가로 × 세로 (m) — 라벨에 표시 */
  widthM?: number;
  heightM?: number;
  /** 패널 회전각 (degrees, 0~180). 회전 핸들 위치 계산에 사용. */
  rotation?: number;
  /** 시설 자동 회전 그대로면 true (핸들 색상 다르게) */
  isAutoRotation?: boolean;
}

interface Props {
  /** 필지 폴리곤 (편집 X) */
  parcelPolygon: Position[][] | null;
  /** 편집 가능한 건물들 */
  buildings: EditableBuilding[];
  /** 꼭지점 dragend 시 호출 — 부모는 buildings state 갱신 */
  onBuildingChange?: (
    id: string,
    newPolygon: Position[][],
    newAreaM2: number,
  ) => void;
  /** 꼭지점 마커 dblclick 시 — 점 삭제 (최소 3점 유지는 부모에서 검증) */
  onRemoveVertex?: (id: string, ringIdx: number, vertexIdx: number) => void;
  /** 첫 표시용 fallback 중심 */
  fallbackCenter?: { lat: number; lng: number };
  /** 선택된 동 id — 강조 표시 */
  selectedBuildingId?: string | null;
  /** 폴리곤/라벨 클릭 시 — 동 선택 (force=true 면 토글이 아닌 강제 set) */
  onSelectBuilding?: (id: string, force?: boolean) => void;
  /** 라벨 X 버튼 클릭 시 — 삭제 요청 (부모는 빨간 모드 진입 등) */
  onRequestDelete?: (id: string) => void;
  /** 회전 핸들 드래그 → 각도 변경 (degrees, 0~180). dragend 시점 1회 호출. */
  onRotationChange?: (id: string, deg: number) => void;
  /** 회전 핸들 더블클릭 → 시설 자동 회전 복귀 */
  onResetRotation?: (id: string) => void;
  /**
   * 인쇄 모드 — 도면 출력(/quote/[pnu]/print)에서 사용.
   *  - 꼭지점 흰 점 마커 / ✥ 이동 핸들 / 라벨 X 버튼 모두 숨김
   *  - 폴리곤·라벨 click 이벤트 미부착
   *  - tilesloaded + 1.5초 후 onReady() 호출 (자동 print 트리거)
   */
  printMode?: boolean;
  /** printMode 에서 지도 + 타일 + 패널 모두 그려진 후 호출 */
  onReady?: () => void;
}

const PARCEL_STROKE = "#FBBF24"; // amber-400
const BUILDING_FILL = "#FF4500"; // orangered
const BUILDING_STROKE = "#FFFFFF"; // 흰색 외곽
const PANEL_FILL = "#FF6B6B"; // 봉남리 PDF 빨강 채움
const PANEL_STROKE = "#C92A2A"; // 진한 빨강 외곽

/**
 * 영역 위쪽 외부 anchor — 라벨/✥ 핸들이 영역 가운데(패널)를 가리지 않도록.
 * bbox maxLat + offsetM(m) 의 가로 중앙 위치.
 */
function polygonTopAnchor(
  polygon: Position[][],
  offsetM: number,
): { lat: number; lng: number } | null {
  const ring = polygon[0];
  if (!ring || ring.length === 0) return null;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  const last = ring.length - 1;
  const isClosed =
    ring[0] &&
    ring[last] &&
    ring[0][0] === ring[last][0] &&
    ring[0][1] === ring[last][1];
  const upper = isClosed ? last : ring.length;
  for (let i = 0; i < upper; i++) {
    const [lng, lat] = ring[i];
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  if (!Number.isFinite(maxLat)) return null;
  return {
    lat: maxLat + offsetM * 0.0000090, // m → 위도 도
    lng: (minLng + maxLng) / 2,
  };
}
/**
 * 필지 단위 표시 줌 — 카카오는 숫자가 작을수록 확대.
 * level 1 ≈ 50m (옥상 굴뚝/실외기 식별), level 2 ≈ 100m.
 * 단일 필지 견적 작업이라 1이 적당. 큰 다중 부지면 사용자가 줌아웃.
 */
const PARCEL_ZOOM_LEVEL = 1;

/**
 * 꼭지점 마커 SVG — 시각은 14×14 (변경 X), hit area 는 24×24 로 확대.
 * 투명 패딩으로 클릭 인식 영역만 키워 "점 잡으려다 빗나가 영역 이동 트리거" 버그 회피.
 * 24×24 안의 가운데 14×14 만 그리고, 나머지는 투명.
 */
const VERTEX_DOT_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
  `<circle cx="12" cy="12" r="5" fill="white" stroke="${BUILDING_FILL}" stroke-width="2.5"/>` +
  `</svg>`;
const VERTEX_DOT_URI =
  "data:image/svg+xml;base64," +
  (typeof window === "undefined" ? "" : btoa(VERTEX_DOT_SVG));

/**
 * 회전 핸들 SVG — 흰 원 + 진한 외곽 + 작은 회전 화살표 hint.
 * 자동(시설 디폴트) = 회색 외곽 / 사용자 수정 = 파랑 외곽 으로 구분.
 */
function rotateHandleSvg(isAuto: boolean): string {
  const stroke = isAuto ? "#6B7280" : "#2563EB"; // gray-500 / blue-600
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">` +
    `<circle cx="11" cy="11" r="8" fill="white" stroke="${stroke}" stroke-width="2.5"/>` +
    `<path d="M 11 6.5 A 4.5 4.5 0 1 1 6.5 11" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/>` +
    `<path d="M 11 5 L 11 8 L 8.2 6.5 Z" fill="${stroke}"/>` +
    `</svg>`
  );
}
const ROTATE_HANDLE_AUTO_URI =
  "data:image/svg+xml;base64," +
  (typeof window === "undefined" ? "" : btoa(rotateHandleSvg(true)));
const ROTATE_HANDLE_CUSTOM_URI =
  "data:image/svg+xml;base64," +
  (typeof window === "undefined" ? "" : btoa(rotateHandleSvg(false)));

/**
 * 회전 핸들 위치 — 영역 중심에서 정북 기준 시계방향 deg° 회전한 점.
 * deg=0 → 정북, deg=90 → 정동.
 * 회전각이 적용된 패널 방향과 동일하게 핸들도 따라가야 자연스러움.
 */
function calcHandlePosition(
  centerLat: number,
  centerLng: number,
  offsetM: number,
  deg: number,
): { lat: number; lng: number } {
  const rad = (deg * Math.PI) / 180;
  // 정북 기준 시계방향: dy = cos(rad) (북쪽), dx = sin(rad) (동쪽)
  const dyM = offsetM * Math.cos(rad);
  const dxM = offsetM * Math.sin(rad);
  const cos = Math.cos((centerLat * Math.PI) / 180);
  return {
    lat: centerLat + dyM * 0.0000090,
    lng: centerLng + (dxM * 0.0000090) / cos,
  };
}

/** 두 좌표 사이 각도 (degrees) — 위에서 본 시계 방향 0=북, 90=동, 180=남, 270=서. */
function bearingDeg(
  centerLat: number,
  centerLng: number,
  pointLat: number,
  pointLng: number,
): number {
  const cos = Math.cos((centerLat * Math.PI) / 180);
  const dx = (pointLng - centerLng) * cos;
  const dy = pointLat - centerLat;
  // atan2 는 수학 좌표계 (동=0, 시계반대) → 시계방향 + 북=0 으로 변환
  const math = (Math.atan2(dy, dx) * 180) / Math.PI;
  let bearing = 90 - math; // 동(math 0) → 북 기준 90°
  if (bearing < 0) bearing += 360;
  if (bearing >= 360) bearing -= 360;
  return bearing;
}

export default function QuoteMap({
  parcelPolygon,
  buildings,
  onBuildingChange,
  onRemoveVertex,
  fallbackCenter,
  selectedBuildingId,
  onSelectBuilding,
  onRequestDelete,
  onRotationChange,
  onResetRotation,
  printMode = false,
  onReady,
}: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const [loaded, setLoaded] = useState(false);

  const parcelOverlaysRef = useRef<any[]>([]);
  const buildingPolyRef = useRef<any[]>([]);
  /** id → 폴리곤 객체 매핑 — selected 변경 시 setOptions 만 호출 (재생성 X) */
  const buildingPolyMapRef = useRef<Map<string, any>>(new Map());
  const vertexMarkersRef = useRef<any[]>([]);
  const labelOverlaysRef = useRef<any[]>([]);
  const panelPolyRef = useRef<any[]>([]);
  /** 회전 핸들 마커 + 중심에서 핸들까지의 점선 (id 별 1개씩) */
  const rotateHandleRef = useRef<any[]>([]);
  const rotateLineRef = useRef<any[]>([]);
  /** id → 회전 핸들 객체 매핑 — rotation/panels 변경 시 in-place 위치 갱신 */
  const rotateHandleMapRef = useRef<Map<string, { marker: any; line: any; centerLat: number; centerLng: number }>>(
    new Map(),
  );
  /** id → 패널 폴리곤 배열 매핑 — rotation/panels 변경 시 destroy 후 재생성 */
  const panelPolyMapRef = useRef<Map<string, any[]>>(new Map());
  /**
   * 방금 영역 평행이동이 끝났는지 플래그.
   * 영역 드래그 후 mouseup 시 카카오 SDK 가 폴리곤 click 도 발화 → 활성화 토글로
   * 풀려버리는 버그 방지. true 면 다음 click 1회 무시.
   */
  const justDraggedRef = useRef(false);

  // dragend / dblclick 콜백 안에서 최신 buildings/onChange 참조 — closure 꼬임 방지.
  // ref 갱신은 effect 안에서 (render 중 ref.current 변경은 React 19에서 anti-pattern).
  const buildingsRef = useRef(buildings);
  const onChangeRef = useRef(onBuildingChange);
  const onRemoveVertexRef = useRef(onRemoveVertex);
  const onSelectRef = useRef(onSelectBuilding);
  const onRequestDeleteRef = useRef(onRequestDelete);
  const onRotationChangeRef = useRef(onRotationChange);
  const onResetRotationRef = useRef(onResetRotation);
  useEffect(() => {
    buildingsRef.current = buildings;
  });
  useEffect(() => {
    onChangeRef.current = onBuildingChange;
  });
  useEffect(() => {
    onRemoveVertexRef.current = onRemoveVertex;
  });
  useEffect(() => {
    onSelectRef.current = onSelectBuilding;
  });
  useEffect(() => {
    onRequestDeleteRef.current = onRequestDelete;
  });
  useEffect(() => {
    onRotationChangeRef.current = onRotationChange;
  });
  useEffect(() => {
    onResetRotationRef.current = onResetRotation;
  });

  // SDK 로드
  useEffect(() => {
    if (window.kakao?.maps) {
      setLoaded(true);
      return;
    }
    const script = document.createElement("script");
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}&autoload=false&libraries=services`;
    script.onload = () => window.kakao.maps.load(() => setLoaded(true));
    document.head.appendChild(script);
  }, []);

  // 지도 초기화
  useEffect(() => {
    if (!loaded || !mapRef.current || mapInstanceRef.current) return;
    const initCenter = fallbackCenter ?? { lat: 36.5, lng: 127.8 };
    const map = new window.kakao.maps.Map(mapRef.current, {
      center: new window.kakao.maps.LatLng(initCenter.lat, initCenter.lng),
      level: 3,
    });
    map.setMapTypeId(window.kakao.maps.MapTypeId.HYBRID);
    mapInstanceRef.current = map;
    const ro = new ResizeObserver(() => map.relayout());
    ro.observe(mapRef.current);
    // 인쇄 모드 — 타일 로드 + 1.5초 마진 후 onReady (자동 print 트리거)
    if (printMode && onReady) {
      const listener = window.kakao.maps.event.addListener(
        map,
        "tilesloaded",
        () => {
          window.kakao.maps.event.removeListener(listener);
          setTimeout(() => onReady(), 1500);
        },
      );
    }
    return () => ro.disconnect();
  }, [loaded, fallbackCenter, printMode, onReady]);

  // 필지 폴리곤
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!loaded || !map) return;
    parcelOverlaysRef.current.forEach((p) => p.setMap(null));
    parcelOverlaysRef.current = [];
    if (!parcelPolygon) return;

    for (const ring of parcelPolygon) {
      const path = ring.map(
        ([lng, lat]) => new window.kakao.maps.LatLng(lat, lng),
      );
      const poly = new window.kakao.maps.Polygon({
        map,
        path,
        strokeWeight: 4,
        strokeColor: PARCEL_STROKE,
        strokeOpacity: 1,
        strokeStyle: "solid",
        fillColor: PARCEL_STROKE,
        fillOpacity: 0,
      });
      parcelOverlaysRef.current.push(poly);
    }
  }, [loaded, parcelPolygon]);

  /**
   * 건물 effect 재실행 트리거 시그니처.
   * 회전 핸들 드래그 = rotation 만 매 프레임 변경 → 시그니처 동일 → effect 재실행 X.
   * 사용자 mousedown → 활성화(selectedBuildingId 변경) 동안에도 effect 재실행 X
   * (그래야 비활성 영역 첫 클릭+드래그 시 같은 mousedown 세션이 안 끊김).
   * 영역 추가/삭제/꼭지점 변경 등 "구조" 변화일 때만 effect 재실행.
   * selectedBuildingId, rotation, panels 변경은 별도 effect 들이 in-place 처리.
   */
  const buildingsEffectKey = useMemo(
    () =>
      buildings
        .map(
          (b) =>
            `${b.id}|${b.area_m2.toFixed(3)}|${b.polygon[0]?.length ?? 0}|${
              b.polygon[0]
                ?.map((p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`)
                .join(";") ?? ""
            }`,
        )
        .join("##"),
    [buildings],
  );

  // 건물 폴리곤 + 꼭지점 마커 + 면적 라벨
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!loaded || !map) return;

    // 기존 오버레이 제거
    buildingPolyRef.current.forEach((p) => p.setMap(null));
    buildingPolyRef.current = [];
    buildingPolyMapRef.current.clear();
    vertexMarkersRef.current.forEach((m) => m.setMap(null));
    vertexMarkersRef.current = [];
    labelOverlaysRef.current.forEach((o) => o.setMap(null));
    labelOverlaysRef.current = [];
    panelPolyRef.current.forEach((p) => p.setMap(null));
    panelPolyRef.current = [];
    panelPolyMapRef.current.clear();
    rotateHandleRef.current.forEach((m) => m.setMap(null));
    rotateHandleRef.current = [];
    rotateLineRef.current.forEach((l) => l.setMap(null));
    rotateLineRef.current = [];
    rotateHandleMapRef.current.clear();

    const dotImage = new window.kakao.maps.MarkerImage(
      VERTEX_DOT_URI,
      new window.kakao.maps.Size(24, 24),
      { offset: new window.kakao.maps.Point(12, 12) },
    );

    // 영역 평행이동 — 지도 mousedown 1개로 모든 building 처리 (Polygon 자체는 mousedown 미지원).
    // mousedown 좌표가 폴리곤 ring 안이면 그 building 드래그 시작.
    interface DragHandler {
      id: string;
      polygon: Position[][];
      ringPolys: any[];
      labelRefBox: { current: any };
      /** 회전 핸들 ref — 평행이동 시 같이 옮기기 위함 */
      rotateHandleBox: { current: { marker: any; line: any; centerLat: number; centerLng: number } | null };
    }
    const dragHandlers: DragHandler[] = [];

    for (const building of buildings) {
      // 폴리곤 본체 — ring 마다 별도 Polygon 객체. ringPolys 로 ring 인덱스별 ref 보관.
      const ringPolys: any[] = [];
      for (const ring of building.polygon) {
        const path = ring.map(
          ([lng, lat]) => new window.kakao.maps.LatLng(lat, lng),
        );
        const poly = new window.kakao.maps.Polygon({
          map,
          path,
          strokeWeight: 3,
          strokeColor: BUILDING_STROKE,
          strokeOpacity: 1,
          strokeStyle: "solid",
          fillColor: BUILDING_FILL,
          fillOpacity: 0.3,
        });
        // 폴리곤 click → 동 선택 (강조). 외곽 ring(0번) 에만 부착해도 충분.
        // 인쇄 모드 = 정적 출력이라 click 이벤트 미부착.
        if (!printMode) {
          const clickedId = building.id;
          window.kakao.maps.event.addListener(poly, "click", () => {
            // 영역 평행이동 직후 click = 카카오 SDK 가 자동 발화 → 활성화 토글 방지
            if (justDraggedRef.current) {
              justDraggedRef.current = false;
              return;
            }
            onSelectRef.current?.(clickedId);
          });
        }
        buildingPolyRef.current.push(poly);
        ringPolys.push(poly);
      }
      // 라벨 ref 보관용 — 라벨 생성 후 setter 로 주입. 드래그 시 라벨도 같이 평행이동.
      const labelRefBox = { current: null as any };
      (ringPolys[0] as any).__setLabelRef = (lo: any) => {
        labelRefBox.current = lo;
      };
      // 회전 핸들 ref 보관용 — 핸들 생성 시 setter 로 주입
      const rotateHandleBox = {
        current: null as { marker: any; line: any; centerLat: number; centerLng: number } | null,
      };
      (ringPolys[0] as any).__setRotateHandle = (
        marker: any,
        line: any,
        centerLat: number,
        centerLng: number,
      ) => {
        rotateHandleBox.current = { marker, line, centerLat, centerLng };
      };
      // building → 영역 평행이동 핸들러 등록 (지도 mousedown 분배)
      // 인쇄 모드 = 정적 출력이라 미부착.
      if (!printMode && ringPolys[0]) {
        dragHandlers.push({
          id: building.id,
          polygon: building.polygon,
          ringPolys,
          labelRefBox,
          rotateHandleBox,
        });
      }
      // id → 외곽 폴리곤 매핑 (selected 변경 시 setOptions 호출용)
      if (ringPolys[0]) {
        buildingPolyMapRef.current.set(building.id, ringPolys[0]);
      }

      // 꼭지점 마커 — closed ring 의 마지막 좌표는 첫 좌표와 동일하므로 N-1 개만
      // 인쇄 모드 = 도면 출력에 마커 안 보이도록 생성 자체 skip.
      if (!printMode) {
        building.polygon.forEach((ring, ringIdx) => {
        const lastIdx = ring.length - 1;
        const targetPoly = ringPolys[ringIdx];
        for (let vIdx = 0; vIdx < lastIdx; vIdx += 1) {
          const [lng, lat] = ring[vIdx];
          const marker = new window.kakao.maps.Marker({
            map,
            position: new window.kakao.maps.LatLng(lat, lng),
            image: dotImage,
            draggable: true,
            zIndex: 1000,
          });
          // capture 변수 (id, ringIdx, vIdx, polygon ref)
          const capturedId = building.id;
          const capturedRing = ringIdx;
          const capturedVertex = vIdx;

          /**
           * 카카오 Marker 는 'drag' 이벤트를 발화하지 않음 (dragstart/dragend 만).
           * → dragstart 시점에 requestAnimationFrame 폴링 시작 → dragend 에 정지.
           *   매 프레임 marker.getPosition() 으로 현재 위치 읽어 폴리곤 path 갱신.
           */
          let rafId: number | null = null;
          let pathSnapshot: any[] = [];

          window.kakao.maps.event.addListener(marker, "dragstart", () => {
            if (!targetPoly) return;
            // 드래그 시작 = 동 선택 강제 (이미 선택돼 있어도 토글 X)
            onSelectRef.current?.(capturedId, true);
            // getPath 반환 형식이 SDK 버전마다 다를 수 있어 Array.from 으로 안전 변환
            pathSnapshot = Array.from(targetPoly.getPath());
            const tick = () => {
              const pos = marker.getPosition();
              const newPath = pathSnapshot.slice();
              newPath[capturedVertex] = pos;
              // closed ring 동기화 (첫 점/마지막 점 같이 움직임)
              if (capturedVertex === 0) newPath[newPath.length - 1] = pos;
              else if (capturedVertex === newPath.length - 1) newPath[0] = pos;
              targetPoly.setPath(newPath);
              rafId = requestAnimationFrame(tick);
            };
            rafId = requestAnimationFrame(tick);
          });

          /**
           * dragend — RAF 정지 + state 업데이트 → 면적 재계산 → 라벨 갱신.
           */
          window.kakao.maps.event.addListener(marker, "dragend", () => {
            if (rafId !== null) {
              cancelAnimationFrame(rafId);
              rafId = null;
            }
            const pos = marker.getPosition();
            const newCoord: Position = [pos.getLng(), pos.getLat()];
            const target = buildingsRef.current.find(
              (b) => b.id === capturedId,
            );
            if (!target) return;
            const newPolygon = updateVertex(
              target.polygon,
              capturedRing,
              capturedVertex,
              newCoord,
            );
            const newAreaM2 = calcAreaM2(newPolygon);
            onChangeRef.current?.(capturedId, newPolygon, newAreaM2);
          });

          /**
           * dblclick — 점 삭제. 부모 콜백에서 최소 3점 검증.
           */
          window.kakao.maps.event.addListener(marker, "dblclick", () => {
            onRemoveVertexRef.current?.(
              capturedId,
              capturedRing,
              capturedVertex,
            );
          });
          // click — 동 선택 (강조). 드래그 시작 시 click 은 발화되지 않음.
          window.kakao.maps.event.addListener(marker, "click", () => {
            onSelectRef.current?.(capturedId);
          });
          vertexMarkersRef.current.push(marker);
        }
      });
      }
      // ↑ printMode 가드 닫기 (꼭지점 마커 블록 끝)

      // 면적 라벨 (CustomOverlay) — 영역 위쪽 외부 (패널 가리지 않도록).
      // 평행이동 시 dragEffectivePos 기준이라 위치 무관.
      const labelAnchor = polygonTopAnchor(building.polygon, 8);
      let labelOverlay: any = null;
      if (labelAnchor) {
        const labelEl = document.createElement("div");
        // 인쇄 모드 = X 버튼 + click 이벤트 미부착 (정적 라벨)
        labelEl.className = printMode
          ? "px-1.5 py-1 bg-white/95 border border-orange-500 rounded text-orange-700 text-[11px] leading-tight font-bold shadow tabular-nums select-none"
          : "px-1.5 py-1 bg-white/95 border border-orange-500 rounded text-orange-700 text-[11px] leading-tight font-bold shadow tabular-nums select-none cursor-pointer hover:bg-white";
        const line1 = `${building.name} · ${toPyeong(building.area_m2).toLocaleString()}평`;
        const hasDims =
          typeof building.widthM === "number" &&
          typeof building.heightM === "number" &&
          building.widthM > 0 &&
          building.heightM > 0;
        const line2 = hasDims
          ? `${Math.round(building.widthM!)} × ${Math.round(building.heightM!)}m · ${Math.round(building.area_m2).toLocaleString()}㎡`
          : `${Math.round(building.area_m2).toLocaleString()}㎡`;
        const xButton = printMode
          ? ""
          : `<button
              type="button"
              data-action="delete"
              class="text-red-600 hover:bg-red-100 rounded leading-none w-4 h-4 flex items-center justify-center text-sm shrink-0 -mt-0.5"
              aria-label="이 동 삭제"
              title="이 동 삭제"
            >×</button>`;
        labelEl.innerHTML = `
          <div class="flex items-start gap-1.5">
            <div class="flex-1 text-center">
              <div>${line1}</div>
              <div class="text-[10px] font-normal text-gray-600">${line2}</div>
            </div>
            ${xButton}
          </div>
        `;
        // 라벨/X 버튼 click 이벤트 — 인쇄 모드에선 미부착
        if (!printMode) {
          const clickedId = building.id;
          labelEl.addEventListener("click", (e) => {
            const target = e.target as HTMLElement;
            if (target.closest('[data-action="delete"]')) {
              e.stopPropagation();
              onRequestDeleteRef.current?.(clickedId);
            } else {
              onSelectRef.current?.(clickedId);
            }
          });
        }
        labelOverlay = new window.kakao.maps.CustomOverlay({
          map,
          position: new window.kakao.maps.LatLng(labelAnchor.lat, labelAnchor.lng),
          content: labelEl,
          xAnchor: 0.5,
          yAnchor: 0.5,
          zIndex: 999,
        });
        labelOverlaysRef.current.push(labelOverlay);
        // 폴리곤 mousedown 드래그 클로저에 라벨 ref 주입 (드래그 시 라벨도 같이 이동)
        const setter = (ringPolys[0] as any)?.__setLabelRef;
        if (typeof setter === "function") setter(labelOverlay);
      }

      // 회전 핸들 — 패널이 있을 때만(2단계 이상) + 인쇄 모드 X.
      // 모든 영역에 항상 생성하되, **선택되지 않은 영역의 핸들은 별도 effect 가 hide.**
      // (메인 effect 가 selectedBuildingId 에 의존하면 첫 클릭 + 드래그 세션이
      //  effect 재실행으로 끊긴다 — 의뢰자 보고 사례 2026-04-30)
      if (
        !printMode &&
        building.panels &&
        building.panels.length > 0 &&
        onRotationChangeRef.current
      ) {
        const center = polygonCenter(building.polygon);
        if (!center) continue;
        // 핸들은 현재 회전각 따라 배치 — 정북에서 시계방향 rotation°.
        // rotation 이 없으면 0 (정북) fallback.
        const currentRot = building.rotation ?? 0;
        const handlePos = calcHandlePosition(
          center.lat,
          center.lng,
          16,
          currentRot,
        );
        const isAuto = building.isAutoRotation !== false;
        const handleImage = new window.kakao.maps.MarkerImage(
          isAuto ? ROTATE_HANDLE_AUTO_URI : ROTATE_HANDLE_CUSTOM_URI,
          new window.kakao.maps.Size(22, 22),
          { offset: new window.kakao.maps.Point(11, 11) },
        );
        const handleMarker = new window.kakao.maps.Marker({
          map,
          position: new window.kakao.maps.LatLng(handlePos.lat, handlePos.lng),
          image: handleImage,
          draggable: true,
          zIndex: 1100,
          title: "드래그 = 회전 / Shift+드래그 = 15° 스냅 / 더블클릭 = 자동 복귀",
        });
        // 중심 ↔ 핸들 점선 — 현재 회전 방향 시각화
        const lineStroke = isAuto ? "#6B7280" : "#2563EB";
        const line = new window.kakao.maps.Polyline({
          map,
          path: [
            new window.kakao.maps.LatLng(center.lat, center.lng),
            new window.kakao.maps.LatLng(handlePos.lat, handlePos.lng),
          ],
          strokeWeight: 2,
          strokeColor: lineStroke,
          strokeOpacity: 0.7,
          strokeStyle: "shortdash",
          zIndex: 1099,
        });
        rotateHandleRef.current.push(handleMarker);
        rotateLineRef.current.push(line);
        // id 매핑 — rotation 변경 시 별도 effect 에서 in-place 위치 갱신.
        rotateHandleMapRef.current.set(building.id, {
          marker: handleMarker,
          line,
          centerLat: center.lat,
          centerLng: center.lng,
        });
        // 평행이동 핸들러가 회전 핸들도 같이 옮길 수 있도록 ref 주입
        const setHandle = (ringPolys[0] as any)?.__setRotateHandle;
        if (typeof setHandle === "function") {
          setHandle(handleMarker, line, center.lat, center.lng);
        }

        const capturedId = building.id;
        // RAF tick 에서 매 프레임 마우스 위치 → 각도 계산 → onRotationChange.
        // 동일 deg 면 skip (불필요한 React 리렌더 방지).
        // 부모 useMemo 가 rotationOverrides 따라 재실행 → 패널 + 핸들 + 점선 재배치.
        let rafId: number | null = null;
        let lastEmittedDeg = currentRot;
        let shiftHeld = false;

        const onShiftDown = (ev: KeyboardEvent) => {
          if (ev.key === "Shift") shiftHeld = true;
        };
        const onShiftUp = (ev: KeyboardEvent) => {
          if (ev.key === "Shift") shiftHeld = false;
        };

        window.kakao.maps.event.addListener(handleMarker, "dragstart", () => {
          onSelectRef.current?.(capturedId, true);
          (handleMarker as any).__dragging = true;
          window.addEventListener("keydown", onShiftDown);
          window.addEventListener("keyup", onShiftUp);
          const tick = () => {
            const pos = handleMarker.getPosition();
            // 정북=0, 시계방향, 0~360. 핸들 위치는 사용자가 끈 방향 그대로
            // 유지해야 자연스러우므로 0~360 으로 부모에 전달.
            // (직사각형 패널은 180° 대칭이라 fillPanelGrid 가 자체 정규화)
            let deg = bearingDeg(
              center.lat,
              center.lng,
              pos.getLat(),
              pos.getLng(),
            );
            if (shiftHeld) {
              deg = Math.round(deg / 15) * 15;
              if (deg >= 360) deg -= 360;
            } else {
              deg = Math.round(deg);
            }
            // 변화 있을 때만 부모 state 업데이트 (렌더 비용 방지)
            if (deg !== lastEmittedDeg) {
              lastEmittedDeg = deg;
              onRotationChangeRef.current?.(capturedId, deg);
            }
            rafId = requestAnimationFrame(tick);
          };
          rafId = requestAnimationFrame(tick);
        });

        window.kakao.maps.event.addListener(handleMarker, "dragend", () => {
          if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
          window.removeEventListener("keydown", onShiftDown);
          window.removeEventListener("keyup", onShiftUp);
          // 마지막 한 번 더 — 드래그 도중 화면 갱신과 mouse 위치 sync 보장
          const pos = handleMarker.getPosition();
          let deg = bearingDeg(
            center.lat,
            center.lng,
            pos.getLat(),
            pos.getLng(),
          );
          if (shiftHeld) {
            deg = Math.round(deg / 15) * 15;
            if (deg >= 360) deg -= 360;
          } else {
            deg = Math.round(deg);
          }
          // 드래그 종료 → 다음 in-place effect 가 마커를 정확한 위치(영역 중심+rotation°) 로 snap.
          // dragging=false 로 풀고, 만약 deg 변경이 있었으면 emit.
          (handleMarker as any).__dragging = false;
          if (deg !== lastEmittedDeg) {
            onRotationChangeRef.current?.(capturedId, deg);
          } else {
            // deg 변화 없어도 마커가 사용자 손에 의해 살짝 어긋나 있을 수 있어
            // 정확한 위치로 snap (다음 effect tick 에서 처리될 수도 있지만 즉시 보정).
            const snap = calcHandlePosition(
              center.lat,
              center.lng,
              16,
              deg,
            );
            handleMarker.setPosition(
              new window.kakao.maps.LatLng(snap.lat, snap.lng),
            );
            line.setPath([
              new window.kakao.maps.LatLng(center.lat, center.lng),
              new window.kakao.maps.LatLng(snap.lat, snap.lng),
            ]);
          }
        });

        window.kakao.maps.event.addListener(handleMarker, "dblclick", () => {
          onResetRotationRef.current?.(capturedId);
        });
        window.kakao.maps.event.addListener(handleMarker, "click", () => {
          onSelectRef.current?.(capturedId);
        });
      }

      // 3단계 패널 폴리곤 — 격자 알고리즘 결과 N개. 영역 위에 빨강 채움.
      // zIndex 800 = 영역 폴리곤(기본) 위, 라벨/마커(>=999) 아래.
      // 패널 클릭도 부모 동 선택으로 위임 (패널이 영역 클릭을 가리는 문제 우회).
      // 인쇄 모드 = 봉남리 양식과 동일하게 fill 진하게 (0.35 → 0.7).
      if (building.panels && building.panels.length > 0) {
        const clickedId = building.id;
        const polysForThis: any[] = [];
        for (const panelRing of building.panels) {
          const panelPath = panelRing.map(
            ([lng, lat]) => new window.kakao.maps.LatLng(lat, lng),
          );
          const panelPoly = new window.kakao.maps.Polygon({
            map,
            path: panelPath,
            strokeWeight: 0.5,
            strokeColor: PANEL_STROKE,
            strokeOpacity: printMode ? 0.9 : 0.7,
            strokeStyle: "solid",
            fillColor: PANEL_FILL,
            fillOpacity: printMode ? 0.7 : 0.35,
            zIndex: 800,
          });
          if (!printMode) {
            window.kakao.maps.event.addListener(panelPoly, "click", () => {
              if (justDraggedRef.current) {
                justDraggedRef.current = false;
                return;
              }
              onSelectRef.current?.(clickedId);
            });
          }
          panelPolyRef.current.push(panelPoly);
          polysForThis.push(panelPoly);
        }
        panelPolyMapRef.current.set(building.id, polysForThis);
      }

    }

    // ── 영역 평행이동 — 지도 mousedown 으로 시작점이 어떤 폴리곤 안인지 검사
    if (printMode || dragHandlers.length === 0) {
      return;
    }

    let active: {
      handler: DragHandler;
      startLat: number;
      startLng: number;
      pathSnapshots: any[][];
      vertexSnapshots: Array<[number, number] | null>;
      labelStart: { lat: number; lng: number } | null;
      handleStart: { marker: any; line: any; lat: number; lng: number; centerLat: number; centerLng: number } | null;
      /** 패널 폴리곤 — 평행이동 시 같이 옮길 수 있도록 path 스냅샷 (poly 별 LatLng[]) */
      panelSnapshots: Array<{ poly: any; path: any[] }>;
      lastLat: number;
      lastLng: number;
    } | null = null;

    const projection = map.getProjection();

    const pixelToLatLng = (clientX: number, clientY: number) => {
      const rect = mapRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const point = new window.kakao.maps.Point(
        clientX - rect.left,
        clientY - rect.top,
      );
      return projection.coordsFromContainerPoint(point);
    };

    const pointInRing = (lat: number, lng: number, ring: Position[]): boolean => {
      let inside = false;
      const n = ring.length;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        const intersect =
          yi > lat !== yj > lat &&
          lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-30) + xi;
        if (intersect) inside = !inside;
      }
      return inside;
    };

    const onDocMouseMove = (e: MouseEvent) => {
      if (!active) return;
      const ll = pixelToLatLng(e.clientX, e.clientY);
      if (!ll) return;
      const lat = ll.getLat();
      const lng = ll.getLng();
      active.lastLat = lat;
      active.lastLng = lng;
      const dLat = lat - active.startLat;
      const dLng = lng - active.startLng;
      active.handler.ringPolys.forEach((p, ri) => {
        const snap = active!.pathSnapshots[ri];
        if (!snap) return;
        p.setPath(
          snap.map(
            (pt: any) =>
              new window.kakao.maps.LatLng(
                pt.getLat() + dLat,
                pt.getLng() + dLng,
              ),
          ),
        );
      });
      vertexMarkersRef.current.forEach((m, mi) => {
        const snap = active!.vertexSnapshots[mi];
        if (!snap) return;
        m.setPosition(
          new window.kakao.maps.LatLng(snap[0] + dLat, snap[1] + dLng),
        );
      });
      const lo = active.handler.labelRefBox.current;
      if (lo && active.labelStart) {
        lo.setPosition(
          new window.kakao.maps.LatLng(
            active.labelStart.lat + dLat,
            active.labelStart.lng + dLng,
          ),
        );
      }
      // 회전 핸들 + 점선도 같이 평행이동
      const hs = active.handleStart;
      if (hs) {
        hs.marker.setPosition(
          new window.kakao.maps.LatLng(hs.lat + dLat, hs.lng + dLng),
        );
        hs.line.setPath([
          new window.kakao.maps.LatLng(
            hs.centerLat + dLat,
            hs.centerLng + dLng,
          ),
          new window.kakao.maps.LatLng(hs.lat + dLat, hs.lng + dLng),
        ]);
      }
      // 패널 폴리곤도 같이 평행이동 — 스냅샷 path 에 dLat/dLng 적용해서 setPath
      for (const ps of active.panelSnapshots) {
        ps.poly.setPath(
          ps.path.map(
            (pt: any) =>
              new window.kakao.maps.LatLng(
                pt.getLat() + dLat,
                pt.getLng() + dLng,
              ),
          ),
        );
      }
    };

    const onDocMouseUp = () => {
      if (!active) return;
      const a = active;
      active = null;
      document.removeEventListener("mousemove", onDocMouseMove);
      document.removeEventListener("mouseup", onDocMouseUp);
      map.setDraggable(true);
      const dLat = a.lastLat - a.startLat;
      const dLng = a.lastLng - a.startLng;
      // 거의 안 움직였으면 클릭으로 간주 — state 갱신 skip (polygon click 이 별도 발화)
      if (Math.abs(dLat) < 1e-7 && Math.abs(dLng) < 1e-7) return;
      // 의미 있는 드래그 발생 → 직후 폴리곤 click 발화로 활성화가 토글되지 않도록
      // 플래그 set. polygon click 핸들러가 보고 1회 무시.
      justDraggedRef.current = true;
      const target = buildingsRef.current.find((b) => b.id === a.handler.id);
      if (!target) return;
      const newPolygon = translatePolygon(target.polygon, dLng, dLat);
      onChangeRef.current?.(a.handler.id, newPolygon, calcAreaM2(newPolygon));
    };

    const onMapMouseDownEl = (e: MouseEvent) => {
      // 좌클릭만 처리
      if (e.button !== 0) return;
      const ll = pixelToLatLng(e.clientX, e.clientY);
      if (!ll) return;
      const lat = ll.getLat();
      const lng = ll.getLng();
      // 꼭지점/회전 핸들 마커 hit area 와 겹치면 영역 이동 양보 (마커 우선).
      // 카카오 SDK 의 마커 dragstart 는 div mousedown 보다 늦게 발화되므로
      // ref flag 방식은 못 쓰고, 클릭 픽셀 좌표 직접 비교가 가장 안전.
      // 꼭지점 = 24×24 (12px 반경), 회전 핸들 = 28×28 (14px 반경, 약간 더 큼).
      const VERTEX_HIT_PX = 12;
      const ROTATE_HIT_PX = 14;
      const rect2 = mapRef.current?.getBoundingClientRect();
      if (rect2) {
        const clickX = e.clientX - rect2.left;
        const clickY = e.clientY - rect2.top;
        // 꼭지점 마커
        for (const m of vertexMarkersRef.current) {
          const mPos = m.getPosition();
          const mPt = projection.containerPointFromCoords(
            new window.kakao.maps.LatLng(mPos.getLat(), mPos.getLng()),
          );
          const dx = clickX - mPt.x;
          const dy = clickY - mPt.y;
          if (dx * dx + dy * dy <= VERTEX_HIT_PX * VERTEX_HIT_PX) {
            return; // 꼭지점 = 양보
          }
        }
        // 회전 핸들 — 화면에 보이는(setMap !== null) 핸들만 검사
        for (const entry of rotateHandleMapRef.current.values()) {
          if (!entry.marker.getMap()) continue; // 숨겨진 핸들 무시
          const mPos = entry.marker.getPosition();
          const mPt = projection.containerPointFromCoords(
            new window.kakao.maps.LatLng(mPos.getLat(), mPos.getLng()),
          );
          const dx = clickX - mPt.x;
          const dy = clickY - mPt.y;
          if (dx * dx + dy * dy <= ROTATE_HIT_PX * ROTATE_HIT_PX) {
            return; // 회전 핸들 = 양보
          }
        }
      }
      // 가장 위에 그린(나중에 추가된) 동을 우선 — 마지막부터 검사
      for (let i = dragHandlers.length - 1; i >= 0; i--) {
        const h = dragHandlers[i];
        const ring = h.polygon[0];
        if (!ring) continue;
        if (!pointInRing(lat, lng, ring)) continue;
        // 이 동 내부 = 드래그 시작
        onSelectRef.current?.(h.id, true);
        const vertexSnaps: Array<[number, number] | null> = vertexMarkersRef.current.map(
          (m) => {
            const p = m.getPosition();
            const mLat = p.getLat();
            const mLng = p.getLng();
            const belongs = h.polygon.some((rg) =>
              rg.some(
                ([rl, rt]) =>
                  Math.abs(rt - mLat) < 1e-9 && Math.abs(rl - mLng) < 1e-9,
              ),
            );
            return belongs ? [mLat, mLng] : null;
          },
        );
        const lo = h.labelRefBox.current;
        const labelStart = lo
          ? { lat: lo.getPosition().getLat(), lng: lo.getPosition().getLng() }
          : null;
        const rh = h.rotateHandleBox.current;
        const handleStart = rh
          ? {
              marker: rh.marker,
              line: rh.line,
              lat: rh.marker.getPosition().getLat(),
              lng: rh.marker.getPosition().getLng(),
              centerLat: rh.centerLat,
              centerLng: rh.centerLng,
            }
          : null;
        // 패널 폴리곤 path 스냅샷 — 이 동에 속한 패널만
        const panels = panelPolyMapRef.current.get(h.id) ?? [];
        const panelSnapshots = panels.map((poly) => ({
          poly,
          path: Array.from(poly.getPath() as any[]),
        }));
        active = {
          handler: h,
          startLat: lat,
          startLng: lng,
          lastLat: lat,
          lastLng: lng,
          pathSnapshots: h.ringPolys.map((p) =>
            Array.from(p.getPath() as any[]),
          ),
          vertexSnapshots: vertexSnaps,
          labelStart,
          handleStart,
          panelSnapshots,
        };
        map.setDraggable(false);
        e.preventDefault();
        document.addEventListener("mousemove", onDocMouseMove);
        document.addEventListener("mouseup", onDocMouseUp);
        return;
      }
    };

    const mapEl = mapRef.current;
    mapEl?.addEventListener("mousedown", onMapMouseDownEl);

    return () => {
      mapEl?.removeEventListener("mousedown", onMapMouseDownEl);
      document.removeEventListener("mousemove", onDocMouseMove);
      document.removeEventListener("mouseup", onDocMouseUp);
      if (active) map.setDraggable(true);
    };
    // 의존성: structure key 만 — rotation/panels 만 바뀐 경우 effect 재실행 X.
    // panels/rotation 시각화는 별도 effect 에서 in-place 갱신.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, buildingsEffectKey, printMode]);

  /**
   * 패널 폴리곤 + 회전 핸들 위치 in-place 갱신.
   * 메인 effect 가 안 돌아도 (rotation/panels 만 변경 시) 시각화는 갱신돼야 함.
   * 회전 드래그 매 프레임 호출되므로 마커 destroy 없이 setPosition 만 사용.
   */
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!loaded || !map) return;

    for (const building of buildings) {
      // 1) 패널 폴리곤 — 갯수가 바뀌면 destroy 후 재생성, 같으면 setPath 만.
      const oldPolys = panelPolyMapRef.current.get(building.id) ?? [];
      const newPanels = building.panels ?? [];
      if (oldPolys.length !== newPanels.length) {
        // 갯수 변경 = 재생성
        for (const p of oldPolys) {
          p.setMap(null);
          // 전역 ref 에서도 제거
          const idx = panelPolyRef.current.indexOf(p);
          if (idx !== -1) panelPolyRef.current.splice(idx, 1);
        }
        const fresh: any[] = [];
        const clickedId = building.id;
        for (const panelRing of newPanels) {
          const panelPath = panelRing.map(
            ([lng, lat]) => new window.kakao.maps.LatLng(lat, lng),
          );
          const panelPoly = new window.kakao.maps.Polygon({
            map,
            path: panelPath,
            strokeWeight: 0.5,
            strokeColor: PANEL_STROKE,
            strokeOpacity: printMode ? 0.9 : 0.7,
            strokeStyle: "solid",
            fillColor: PANEL_FILL,
            fillOpacity: printMode ? 0.7 : 0.35,
            zIndex: 800,
          });
          if (!printMode) {
            window.kakao.maps.event.addListener(panelPoly, "click", () => {
              if (justDraggedRef.current) {
                justDraggedRef.current = false;
                return;
              }
              onSelectRef.current?.(clickedId);
            });
          }
          panelPolyRef.current.push(panelPoly);
          fresh.push(panelPoly);
        }
        panelPolyMapRef.current.set(building.id, fresh);
      } else {
        // 갯수 동일 = setPath in-place
        for (let i = 0; i < oldPolys.length; i++) {
          const newPath = newPanels[i].map(
            ([lng, lat]) => new window.kakao.maps.LatLng(lat, lng),
          );
          oldPolys[i].setPath(newPath);
        }
      }

      // 2) 회전 핸들 — 현재 회전각으로 위치 갱신 (드래그 중에도 매 프레임 동기화).
      //    영역 polygon 자체가 안 바뀌었으니 center 도 동일.
      const handleEntry = rotateHandleMapRef.current.get(building.id);
      if (handleEntry) {
        const rot = building.rotation ?? 0;
        const newPos = calcHandlePosition(
          handleEntry.centerLat,
          handleEntry.centerLng,
          16,
          rot,
        );
        // 드래그 중인 마커는 사용자가 잡고 있으므로 setPosition 으로 강제 동기화 X.
        // → 마커 자체는 그대로 두고 line(중심→마커) 만 갱신.
        // (드래그 안 끝났을 때 setPosition 하면 사용자 손을 놔도 마커가 점프)
        const dragging = (handleEntry.marker as any).__dragging === true;
        if (!dragging) {
          handleEntry.marker.setPosition(
            new window.kakao.maps.LatLng(newPos.lat, newPos.lng),
          );
        }
        // line 은 항상 마커 현재 위치 따라가게
        const markerPos = handleEntry.marker.getPosition();
        handleEntry.line.setPath([
          new window.kakao.maps.LatLng(handleEntry.centerLat, handleEntry.centerLng),
          new window.kakao.maps.LatLng(markerPos.getLat(), markerPos.getLng()),
        ]);
      }
    }
  }, [loaded, buildings, printMode]);

  // 첫 진입 시 fitBounds — buildings + parcel 모두 도착 후 1회만
  const fitDoneRef = useRef(false);
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!loaded || !map) return;
    if (fitDoneRef.current) return;
    if (!parcelPolygon && buildings.length === 0) return;

    const bounds = new window.kakao.maps.LatLngBounds();
    if (parcelPolygon) {
      for (const ring of parcelPolygon) {
        for (const [lng, lat] of ring) {
          bounds.extend(new window.kakao.maps.LatLng(lat, lng));
        }
      }
    }
    for (const b of buildings) {
      for (const ring of b.polygon) {
        for (const [lng, lat] of ring) {
          bounds.extend(new window.kakao.maps.LatLng(lat, lng));
        }
      }
    }
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    const center = new window.kakao.maps.LatLng(
      (ne.getLat() + sw.getLat()) / 2,
      (ne.getLng() + sw.getLng()) / 2,
    );
    map.setLevel(PARCEL_ZOOM_LEVEL);
    map.setCenter(center);
    fitDoneRef.current = true;
  }, [loaded, parcelPolygon, buildings]);

  // 선택된 동 강조 — selectedBuildingId 변경 시 setOptions 만 호출 (재생성 X)
  useEffect(() => {
    for (const [id, poly] of buildingPolyMapRef.current.entries()) {
      const isSelected = id === selectedBuildingId;
      poly.setOptions({
        strokeWeight: isSelected ? 6 : 3,
        strokeColor: isSelected ? "#FACC15" : BUILDING_STROKE, // yellow-400
        fillOpacity: isSelected ? 0.4 : 0.3,
      });
    }
  }, [selectedBuildingId, buildings]);

  // 회전 핸들 표시 토글 — selectedBuildingId 변경 시 setMap 만 호출 (재생성 X).
  // 핸들/라인 객체는 메인 effect 가 모든 영역에 항상 생성. 여기선 보이기/숨기기만.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!loaded || !map) return;
    for (const [id, entry] of rotateHandleMapRef.current.entries()) {
      const visible = id === selectedBuildingId;
      entry.marker.setMap(visible ? map : null);
      entry.line.setMap(visible ? map : null);
    }
  }, [loaded, selectedBuildingId, buildings]);

  // 클린업
  useEffect(() => {
    return () => {
      parcelOverlaysRef.current.forEach((p) => p.setMap(null));
      buildingPolyRef.current.forEach((p) => p.setMap(null));
      vertexMarkersRef.current.forEach((m) => m.setMap(null));
      labelOverlaysRef.current.forEach((o) => o.setMap(null));
      panelPolyRef.current.forEach((p) => p.setMap(null));
      rotateHandleRef.current.forEach((m) => m.setMap(null));
      rotateLineRef.current.forEach((l) => l.setMap(null));
    };
  }, []);

  const sdkMissing = useMemo(() => !KAKAO_JS_KEY, []);
  if (sdkMissing) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-100 text-sm text-red-600">
        NEXT_PUBLIC_KAKAO_JS_KEY 미설정
      </div>
    );
  }

  return <div ref={mapRef} className="w-full h-full" />;
}
