"use client";

/**
 * 실시간 GPS 위치 추적 — 카카오 지도 위에 표시.
 *
 * 기능:
 *   1. 파란 점 + 펄스 링 (현재 위치)
 *   2. 방향 화살표 (heading — 이동 중일 때)
 *   3. 이동 궤적 (Polyline)
 *   4. 정확도 원 (50m 이상일 때)
 *   5. 좌하단 정보 패널 (속도, 정확도, 좌표)
 *
 * 100% 클라이언트 사이드 — 서버 통신 없음.
 */

import { useEffect, useRef, useState } from "react";
import { haversineMeters } from "@/lib/geo/distance";

interface Props {
  map: any;
  active: boolean;
  autoFollow: boolean;
  onAutoFollowChange: (v: boolean) => void;
  onError?: (msg: string) => void;
  onFirstFix?: () => void;
}

const MAX_TRAIL_POINTS = 5000;

// ── GPS 필터링 상수 ──
const FILTER_ACCURACY_THRESHOLD = 50; // m — 이보다 큰 accuracy면 폐기
const FILTER_MAX_SPEED = 42; // m/s (≈150 km/h) — 초과 시 점프 판정
const FILTER_MIN_DISTANCE = 3; // m — 이전 위치와 이보다 가까우면 폐기
const EMA_ALPHA = 0.3; // EMA 스무딩 계수 (0에 가까울수록 부드러움)

export default function GpsTracker({
  map,
  active,
  autoFollow,
  onAutoFollowChange,
  onError,
  onFirstFix,
}: Props) {
  // 정보 패널용 상태
  const [gpsInfo, setGpsInfo] = useState<{
    speed: number | null;
    heading: number | null;
    accuracy: number;
    lat: number;
    lng: number;
    filtered: boolean;
    filterReason: string | null;
    filterStats: { total: number; accepted: number; rejectedAccuracy: number; rejectedSpeed: number; rejectedDistance: number };
  } | null>(null);

  // 모든 ref를 하나로 — cleanup을 안정적으로 처리
  const stateRef = useRef({
    watchId: null as number | null,
    overlay: null as any,
    headingOverlay: null as any,
    headingEl: null as HTMLElement | null,
    accuracyCircle: null as any,
    trailLine: null as any,
    trailPath: [] as any[],
    firstFix: false,
    autoFollow: true,
    // ── GPS 필터 상태 ──
    lastValidPos: null as { lat: number; lng: number; time: number; accuracy?: number } | null,
    emaPos: null as { lat: number; lng: number } | null,
    gpsStartTime: 0,
    filterStats: { total: 0, accepted: 0, rejectedAccuracy: 0, rejectedSpeed: 0, rejectedDistance: 0 },
    lowAccuracyWarned: false,
  });
  stateRef.current.autoFollow = autoFollow;

  // 콜백 refs — effect 의존성을 안정화
  const onAutoFollowChangeRef = useRef(onAutoFollowChange);
  onAutoFollowChangeRef.current = onAutoFollowChange;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onFirstFixRef = useRef(onFirstFix);
  onFirstFixRef.current = onFirstFix;

  // 사용자가 지도를 드래그하면 autoFollow 해제
  useEffect(() => {
    if (!map || !active) return;
    const handler = () => {
      if (stateRef.current.autoFollow) {
        onAutoFollowChangeRef.current(false);
      }
    };
    window.kakao.maps.event.addListener(map, "dragstart", handler);
    return () => {
      window.kakao.maps.event.removeListener(map, "dragstart", handler);
    };
  }, [map, active]);

  // ── 핵심 effect: GPS watch 관리 ──
  useEffect(() => {
    const s = stateRef.current;

    // cleanup 함수
    function cleanup() {
      if (s.watchId != null) {
        navigator.geolocation.clearWatch(s.watchId);
        s.watchId = null;
      }
      if (s.overlay) { s.overlay.setMap(null); s.overlay = null; }
      if (s.headingOverlay) { s.headingOverlay.setMap(null); s.headingOverlay = null; s.headingEl = null; }
      if (s.accuracyCircle) { s.accuracyCircle.setMap(null); s.accuracyCircle = null; }
      if (s.trailLine) { s.trailLine.setMap(null); s.trailLine = null; }
      s.trailPath = [];
      s.firstFix = false;
      // ── 필터 상태 초기화 ──
      s.lastValidPos = null;
      s.emaPos = null;
      s.gpsStartTime = 0;
      s.filterStats = { total: 0, accepted: 0, rejectedAccuracy: 0, rejectedSpeed: 0, rejectedDistance: 0 };
      s.lowAccuracyWarned = false;
    }

    if (!active || !map) {
      cleanup();
      setGpsInfo(null);
      return cleanup;
    }

    if (!navigator.geolocation) {
      onErrorRef.current?.("이 브라우저에서는 위치 서비스를 지원하지 않아요.");
      return cleanup;
    }

    // ── 현재 위치 점 (네이비 + 흰 링, 1.5배 크기) ──
    //    여유용량 마커(#1d4ed8 파랑)와 명도 차별화 위해 짙은 네이비 사용.
    const dotHtml = `
      <div style="position:relative;width:0;height:0;pointer-events:none;">
        <div style="
          position:absolute;left:-30px;top:-30px;
          width:60px;height:60px;border-radius:50%;
          background:rgba(30,58,138,0.15);
          border:1.5px solid rgba(30,58,138,0.35);
          animation:gpsRipple 3s ease-out infinite;
        "></div>
        <div style="
          position:absolute;left:-12px;top:-12px;
          width:24px;height:24px;border-radius:50%;
          background:#1e3a8a;
          border:4px solid white;
          box-shadow:0 2px 6px rgba(0,0,0,0.4);
        "></div>
        <style>
          @keyframes gpsRipple {
            0% { transform:scale(0.7); opacity:1; }
            100% { transform:scale(2.2); opacity:0; }
          }
        </style>
      </div>`;

    s.overlay = new window.kakao.maps.CustomOverlay({
      position: map.getCenter(),
      content: dotHtml,
      yAnchor: 0.5,
      xAnchor: 0.5,
      zIndex: 200,
    });
    s.overlay.setMap(map);

    // ── 방향 화살표 오버레이 생성 (이동 중에만 표시) ──
    const wrapper = document.createElement("div");
    const arrow = document.createElement("div");
    arrow.style.cssText =
      "position:absolute;left:-12px;top:-30px;width:24px;height:24px;pointer-events:none;transition:transform 0.3s ease;";
    arrow.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M12 2 L8 14 L12 11 L16 14 Z" fill="#1e3a8a" stroke="white" stroke-width="1"/>
    </svg>`;
    wrapper.appendChild(arrow);
    s.headingEl = arrow;

    s.headingOverlay = new window.kakao.maps.CustomOverlay({
      position: map.getCenter(),
      content: wrapper,
      yAnchor: 0.5,
      xAnchor: 0.5,
      zIndex: 201,
    });
    // 처음에는 숨김

    // ── getCurrentPosition으로 초기 위치 빠르게 잡기 (enableHighAccuracy: false → WiFi/네트워크 우선) ──
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // watchPosition 콜백과 동일한 핸들러로 전달
        handlePosition(pos);
      },
      () => { /* 실패해도 watchPosition이 백업 */ },
      { enableHighAccuracy: false, maximumAge: 60000, timeout: 5000 },
    );

    // ── watchPosition으로 지속 추적 ──
    s.gpsStartTime = Date.now();

    function handlePosition(pos: GeolocationPosition) {
        const { latitude, longitude, accuracy, heading, speed } = pos.coords;
        const now = pos.timestamp;
        if (!s.filterStats) s.filterStats = { total: 0, accepted: 0, rejectedAccuracy: 0, rejectedSpeed: 0, rejectedDistance: 0 };
        s.filterStats.total++;

        // ── [전략] "최선 채택" — 이전보다 정확하거나, 처음이면 무조건 채택 ──
        const bestAccuracy = s.lastValidPos ? s.lastValidPos.accuracy ?? Infinity : Infinity;
        const isBetter = accuracy <= bestAccuracy;
        const isGoodEnough = accuracy <= FILTER_ACCURACY_THRESHOLD;

        // firstFix 전: 이전보다 정확하면 무조건 채택 (IP든 WiFi든 가장 좋은 것 사용)
        // firstFix 후: 정확도 기준 충족 시만 채택 + 속도/거리 필터 적용
        if (!s.firstFix) {
          if (!isBetter && !isGoodEnough) {
            s.filterStats.rejectedAccuracy++;
            setGpsInfo({ speed, heading, accuracy, lat: latitude, lng: longitude, filtered: true, filterReason: "accuracy", filterStats: { ...s.filterStats } });
            return;
          }
        } else {
          // firstFix 이후: 정확도 필터
          if (accuracy > FILTER_ACCURACY_THRESHOLD) {
            s.filterStats.rejectedAccuracy++;
            setGpsInfo({ speed, heading, accuracy, lat: latitude, lng: longitude, filtered: true, filterReason: "accuracy", filterStats: { ...s.filterStats } });
            return;
          }

          // 속도 기반 점프 필터
          if (s.lastValidPos) {
            const dist = haversineMeters(s.lastValidPos.lat, s.lastValidPos.lng, latitude, longitude);
            const dt = (now - s.lastValidPos.time) / 1000;
            if (dt > 0 && dist / dt > FILTER_MAX_SPEED) {
              s.filterStats.rejectedSpeed++;
              setGpsInfo({ speed, heading, accuracy, lat: latitude, lng: longitude, filtered: true, filterReason: "speed", filterStats: { ...s.filterStats } });
              return;
            }

            // 최소 거리 필터 (정지 떨림 제거)
            if (dist < FILTER_MIN_DISTANCE) {
              s.filterStats.rejectedDistance++;
              setGpsInfo({ speed, heading, accuracy, lat: s.emaPos?.lat ?? latitude, lng: s.emaPos?.lng ?? longitude, filtered: true, filterReason: "distance", filterStats: { ...s.filterStats } });
              return;
            }
          }
        }

        // 저정확도 경고 (1km 이상, 1회만)
        if (accuracy > 1000 && !s.lowAccuracyWarned) {
          s.lowAccuracyWarned = true;
          onErrorRef.current?.(getLowAccuracyGuide());
        }

        // ── 채택 ──
        s.filterStats.accepted++;
        s.lastValidPos = { lat: latitude, lng: longitude, time: now, accuracy };

        // EMA 스무딩 (firstFix 후에만 적용, 처음엔 원본 사용)
        const smoothed = (s.emaPos && s.firstFix)
          ? applyEma(s.emaPos, { lat: latitude, lng: longitude }, EMA_ALPHA)
          : { lat: latitude, lng: longitude };
        s.emaPos = smoothed;

        const latlng = new window.kakao.maps.LatLng(smoothed.lat, smoothed.lng);

        // 파란 점 이동
        if (s.overlay) s.overlay.setPosition(latlng);

        // 정확도 원 (raw accuracy 사용)
        if (s.accuracyCircle) { s.accuracyCircle.setMap(null); s.accuracyCircle = null; }
        if (accuracy > 50) {
          s.accuracyCircle = new window.kakao.maps.Circle({
            center: latlng,
            radius: accuracy,
            strokeWeight: 1,
            strokeColor: "#1e3a8a",
            strokeOpacity: 0.3,
            fillColor: "#1e3a8a",
            fillOpacity: 0.08,
          });
          s.accuracyCircle.setMap(map);
        }

        // 방향 화살표
        if (heading != null && s.headingOverlay) {
          s.headingOverlay.setPosition(latlng);
          s.headingOverlay.setMap(map);
          if (s.headingEl) {
            s.headingEl.style.transform = `rotate(${heading}deg)`;
          }
        } else if (s.headingOverlay) {
          s.headingOverlay.setMap(null);
        }

        // 이동 궤적 (필터 통과한 smoothed 좌표만)
        s.trailPath.push(latlng);
        if (s.trailPath.length > MAX_TRAIL_POINTS) {
          s.trailPath = s.trailPath.slice(-MAX_TRAIL_POINTS);
        }
        if (s.trailPath.length >= 2) {
          if (s.trailLine) s.trailLine.setMap(null);
          s.trailLine = new window.kakao.maps.Polyline({
            path: s.trailPath,
            strokeWeight: 4,
            strokeColor: "#1e3a8a",
            strokeOpacity: 0.5,
            strokeStyle: "solid",
          });
          s.trailLine.setMap(map);
        }

        // 정보 패널
        setGpsInfo({ speed, heading, accuracy, lat: smoothed.lat, lng: smoothed.lng, filtered: false, filterReason: null, filterStats: { ...s.filterStats } });

        // 첫 위치 (정확도 필터 통과 후에만 발동)
        if (!s.firstFix) {
          s.firstFix = true;
          map.setCenter(latlng);
          map.setLevel(4, { animate: true });
          onFirstFixRef.current?.();
        } else if (s.autoFollow) {
          map.panTo(latlng);
        }
      } // handlePosition 끝

    s.watchId = navigator.geolocation.watchPosition(
      handlePosition,
      (err) => {
        const msgs: Record<number, string> = {
          1: "위치 권한을 허용해 주세요. (브라우저 설정에서 변경 가능)",
          2: "현재 위치를 확인할 수 없어요. GPS 신호를 확인해 주세요.",
          3: "위치 확인이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.",
        };
        onErrorRef.current?.(msgs[err.code] ?? "위치 오류가 발생했어요.");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000,
      }
    );

    return cleanup;
  }, [active, map]);

  // autoFollow 복원 시 현재 위치로 이동
  useEffect(() => {
    const s = stateRef.current;
    if (active && autoFollow && map && s.overlay) {
      const pos = s.overlay.getPosition();
      if (pos) map.panTo(pos);
    }
  }, [active, autoFollow, map]);

  // ── 정보 패널 렌더링 ──
  if (!active || !gpsInfo) return null;

  const speedKmh = gpsInfo.speed != null ? gpsInfo.speed * 3.6 : null;

  const accuracyColor = gpsInfo.accuracy <= 10 ? "text-green-600"
    : gpsInfo.accuracy <= 50 ? "text-yellow-600" : "text-red-600";
  const accuracyLabel = gpsInfo.accuracy <= 10 ? "좋음"
    : gpsInfo.accuracy <= 50 ? "보통" : "나쁨";

  return (
    <div className="absolute bottom-16 md:bottom-4 left-1/2 -translate-x-1/2 z-20 kepco-slide-up">
      <div className="flex items-center gap-2 bg-white/95 backdrop-blur rounded-full shadow-lg border border-gray-200 px-3 py-1.5 text-[11px] whitespace-nowrap">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-700 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-900" />
        </span>
        <span className="text-blue-900 font-bold">GPS</span>
        <span className={`font-bold tabular-nums ${accuracyColor}`}>
          ±{gpsInfo.accuracy.toFixed(0)}m
        </span>
        <span className={`text-[10px] ${accuracyColor}`}>{accuracyLabel}</span>
        {speedKmh != null && speedKmh > 0.5 && (
          <>
            <span className="text-gray-300">·</span>
            <span className="text-gray-700 font-bold tabular-nums">{speedKmh.toFixed(1)}</span>
            <span className="text-gray-400 text-[10px]">km/h</span>
          </>
        )}
        {gpsInfo.filtered && gpsInfo.filterReason && (
          <>
            <span className="text-gray-300">·</span>
            <span className="text-orange-500 text-[10px]">
              {gpsInfo.filterReason === "accuracy" ? "신호약함"
                : gpsInfo.filterReason === "speed" ? "점프무시"
                : gpsInfo.filterReason === "distance" ? "정지중"
                : "대기중"}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/** 브라우저별 '정확한 위치' 활성화 안내 메시지 */
function getLowAccuracyGuide(): string {
  const ua = navigator.userAgent;
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);

  if (!isMobile) {
    return "위치 정확도가 낮아요. HTTPS 환경에서 접속하거나, 브라우저 위치 권한을 재설정해 보세요.";
  }
  if (/iPad|iPhone|iPod/.test(ua)) {
    return "위치 정확도가 매우 낮아요. 설정 → 개인정보 보호 및 보안 → 위치 서비스 → Safari 웹사이트 → '정확한 위치' 켜기";
  }
  if (/SamsungBrowser/i.test(ua)) {
    return "위치 정확도가 매우 낮아요. 삼성 인터넷 메뉴(≡) → 설정 → 사이트 및 다운로드 → 위치 → 이 사이트 권한 삭제 후 다시 허용";
  }
  if (/Chrome/i.test(ua)) {
    return "위치 정확도가 매우 낮아요. 주소창 왼쪽 자물쇠 → 권한 → 위치 → '정확한 위치 사용' 켜기";
  }
  return "위치 정확도가 매우 낮아요. 브라우저 설정에서 이 사이트의 위치 권한을 '정확한 위치'로 변경해 주세요.";
}

/** EMA(지수이동평균) 스무딩 */
function applyEma(
  prev: { lat: number; lng: number },
  curr: { lat: number; lng: number },
  alpha: number,
): { lat: number; lng: number } {
  return {
    lat: prev.lat + alpha * (curr.lat - prev.lat),
    lng: prev.lng + alpha * (curr.lng - prev.lng),
  };
}
