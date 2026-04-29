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

/** 꼭지점 마커 SVG (작은 흰 동그라미 + 주황 테두리) — data URI 로 MarkerImage */
const VERTEX_DOT_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">` +
  `<circle cx="7" cy="7" r="5" fill="white" stroke="${BUILDING_FILL}" stroke-width="2.5"/>` +
  `</svg>`;
const VERTEX_DOT_URI =
  "data:image/svg+xml;base64," +
  (typeof window === "undefined" ? "" : btoa(VERTEX_DOT_SVG));

export default function QuoteMap({
  parcelPolygon,
  buildings,
  onBuildingChange,
  onRemoveVertex,
  fallbackCenter,
  selectedBuildingId,
  onSelectBuilding,
  onRequestDelete,
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

  // dragend / dblclick 콜백 안에서 최신 buildings/onChange 참조 — closure 꼬임 방지.
  // ref 갱신은 effect 안에서 (render 중 ref.current 변경은 React 19에서 anti-pattern).
  const buildingsRef = useRef(buildings);
  const onChangeRef = useRef(onBuildingChange);
  const onRemoveVertexRef = useRef(onRemoveVertex);
  const onSelectRef = useRef(onSelectBuilding);
  const onRequestDeleteRef = useRef(onRequestDelete);
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

    const dotImage = new window.kakao.maps.MarkerImage(
      VERTEX_DOT_URI,
      new window.kakao.maps.Size(14, 14),
      { offset: new window.kakao.maps.Point(7, 7) },
    );

    // 영역 평행이동 — 지도 mousedown 1개로 모든 building 처리 (Polygon 자체는 mousedown 미지원).
    // mousedown 좌표가 폴리곤 ring 안이면 그 building 드래그 시작.
    interface DragHandler {
      id: string;
      polygon: Position[][];
      ringPolys: any[];
      labelRefBox: { current: any };
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
      // building → 영역 평행이동 핸들러 등록 (지도 mousedown 분배)
      // 인쇄 모드 = 정적 출력이라 미부착.
      if (!printMode && ringPolys[0]) {
        dragHandlers.push({
          id: building.id,
          polygon: building.polygon,
          ringPolys,
          labelRefBox,
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
      const center = polygonCenter(building.polygon); // ✥ 핸들 평행이동 dLat/dLng 계산용
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

      // 3단계 패널 폴리곤 — 격자 알고리즘 결과 N개. 영역 위에 빨강 채움.
      // zIndex 800 = 영역 폴리곤(기본) 위, 라벨/마커(>=999) 아래.
      // 패널 클릭도 부모 동 선택으로 위임 (패널이 영역 클릭을 가리는 문제 우회).
      // 인쇄 모드 = 봉남리 양식과 동일하게 fill 진하게 (0.35 → 0.7).
      if (building.panels && building.panels.length > 0) {
        const clickedId = building.id;
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
              onSelectRef.current?.(clickedId);
            });
          }
          panelPolyRef.current.push(panelPoly);
        }
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

  // 클린업
  useEffect(() => {
    return () => {
      parcelOverlaysRef.current.forEach((p) => p.setMap(null));
      buildingPolyRef.current.forEach((p) => p.setMap(null));
      vertexMarkersRef.current.forEach((m) => m.setMap(null));
      labelOverlaysRef.current.forEach((o) => o.setMap(null));
      panelPolyRef.current.forEach((p) => p.setMap(null));
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
