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
  polygon: Position[][];
  area_m2: number;
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
  /** 첫 표시용 fallback 중심 */
  fallbackCenter?: { lat: number; lng: number };
}

const PARCEL_STROKE = "#FBBF24"; // amber-400
const BUILDING_FILL = "#FF4500"; // orangered
const BUILDING_STROKE = "#FFFFFF"; // 흰색 외곽
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
  fallbackCenter,
}: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const [loaded, setLoaded] = useState(false);

  const parcelOverlaysRef = useRef<any[]>([]);
  const buildingPolyRef = useRef<any[]>([]);
  const vertexMarkersRef = useRef<any[]>([]);
  const labelOverlaysRef = useRef<any[]>([]);

  // dragend 콜백 안에서 최신 buildings/onChange 참조 — closure 꼬임 방지.
  // ref 갱신은 effect 안에서 (render 중 ref.current 변경은 React 19에서 anti-pattern).
  const buildingsRef = useRef(buildings);
  const onChangeRef = useRef(onBuildingChange);
  useEffect(() => {
    buildingsRef.current = buildings;
  });
  useEffect(() => {
    onChangeRef.current = onBuildingChange;
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
    return () => ro.disconnect();
  }, [loaded, fallbackCenter]);

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
    vertexMarkersRef.current.forEach((m) => m.setMap(null));
    vertexMarkersRef.current = [];
    labelOverlaysRef.current.forEach((o) => o.setMap(null));
    labelOverlaysRef.current = [];

    const dotImage = new window.kakao.maps.MarkerImage(
      VERTEX_DOT_URI,
      new window.kakao.maps.Size(14, 14),
      { offset: new window.kakao.maps.Point(7, 7) },
    );

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
          fillOpacity: 0.55,
        });
        buildingPolyRef.current.push(poly);
        ringPolys.push(poly);
      }

      // 꼭지점 마커 — closed ring 의 마지막 좌표는 첫 좌표와 동일하므로 N-1 개만
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
          vertexMarkersRef.current.push(marker);
        }
      });

      // 면적 라벨 (CustomOverlay, 폴리곤 중앙)
      const center = polygonCenter(building.polygon);
      if (center) {
        const labelEl = document.createElement("div");
        labelEl.className =
          "px-2 py-0.5 bg-white/95 border border-orange-500 rounded text-orange-700 text-xs font-bold shadow tabular-nums select-none pointer-events-none";
        labelEl.textContent = `${toPyeong(building.area_m2).toLocaleString()}평`;
        const overlay = new window.kakao.maps.CustomOverlay({
          map,
          position: new window.kakao.maps.LatLng(center.lat, center.lng),
          content: labelEl,
          xAnchor: 0.5,
          yAnchor: 0.5,
          zIndex: 999,
        });
        labelOverlaysRef.current.push(overlay);
      }
    }
  }, [loaded, buildings]);

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

  // 클린업
  useEffect(() => {
    return () => {
      parcelOverlaysRef.current.forEach((p) => p.setMap(null));
      buildingPolyRef.current.forEach((p) => p.setMap(null));
      vertexMarkersRef.current.forEach((m) => m.setMap(null));
      labelOverlaysRef.current.forEach((o) => o.setMap(null));
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
