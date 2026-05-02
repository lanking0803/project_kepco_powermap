---
name: 자연취락지구 폴리곤 표시 — 마을 클릭 시 자동
description: 마을 마커/필지/공매그룹 클릭 시 마을 폴리곤 안의 자연취락지구 폴리곤 자동 표시. 별도 토글 없음. 의뢰자 컨펌(2026-05-02).
type: project
---

# 자연취락지구 폴리곤 표시 (2차 5번 항목 / +150만)

## 의뢰자 의도 (2026-04-20 + 2026-05-02 재확인)

> **"전국 자연취락지구 안에 여유선로가 있는지 한눈에 파악"**
> — 태양광 영업 1순위 발굴 (저렴 + 인허가 쉬움 + 민원 적음 + 마을 안 = 전기 가까움)

스코프 확정 (의뢰자 명시):
- 단위: 자연취락지구 폴리곤 1개 = 화면 1개 (지번 단위 X)
- 표시: 마을(리/읍면동) 안에 들어오는 자연취락지구 영역만 시각화
- UI: 별도 토글 X — 마을 클릭 시 자동 (덕지덕지 금지)

## 데이터 소스

- **VWorld WFS `lt_c_uq128`** (용도지구 — 자연취락지구)
- 운영 키 (sunlap.kr) 사용. 만료 2028-10-08.
- 분기 1회 갱신 데이터 → HTTP 1주 캐시 + SWR 1일

## ⚠️ 핵심 한계

- 응답 단위 = **시군구(std_sggcd 5자리) 까지만 필터 가능**
- 응답에 읍면동/리 코드/이름 자체가 없음 — bjd_code 직접 매칭 불가
- → **시군구 단위 응답 받아 클라이언트에서 마을 폴리곤과 교차 비교 후처리 필수**

## 구조 (2일 작업)

```
[프론트] 마을 마커 클릭 → bjd_code 10자리
   ↓
[프론트] Promise.allSettled 로 두 atomic endpoint 병렬:
   ├── /api/polygon/by-bjd?bjd_code=4157035025      ← 행정구역 폴리곤 (기존)
   └── /api/uq-villages/by-bjd?bjd_code=4157035025  ← 시군구 자연취락지구 N개 (신규)
                                                       내부에서 bjd_code 앞 5자리만 사용
   ↓
[프론트] Turf.booleanIntersects 로 마을 안에 있는 것만 솎아냄 (0~3개)
   ↓
[프론트] 카카오맵 Polygon 렌더링 (보라 fill, zIndex 2 — 마을 위, 필지 아래)
```

## 주요 파일

- 서버 lib: [web/lib/vworld/uq-villages.ts](../../web/lib/vworld/uq-villages.ts)
- Atomic endpoint: [web/app/api/uq-villages/by-bjd/route.ts](../../web/app/api/uq-villages/by-bjd/route.ts)
- 클라이언트 wrapper: [web/lib/api/vworld.ts](../../web/lib/api/vworld.ts) — `fetchVworldUqVillagesByBjdCode`
- 통합 헬퍼: [web/components/map/MapClient.tsx](../../web/components/map/MapClient.tsx) — `loadVillageAndUqPolygons` (3개 진입점 모두 이 1개만 호출)
- 렌더링: [web/components/map/KakaoMap.tsx](../../web/components/map/KakaoMap.tsx) — `uqVillagePolygons` prop + 보라 폴리곤 useEffect

## 입력 인터페이스 (의뢰자 결정 사항)

**bjd_code 10자리로 통일** — 다른 atomic endpoint(`/api/polygon/by-bjd`, `/api/parcel/by-pnu` 등) 와 동일.
내부에서 앞 5자리 추출하는 것은 wrapper 가 처리. 호출 측은 bjd_code 만 알면 됨.

## 캐시 전략

- 클라이언트: 시군구 5자리 키로 모듈 scope Map (같은 시군구 다른 마을 클릭 = 외부 호출 0)
- HTTP: `public, s-maxage=604800, stale-while-revalidate=86400` (1주 + SWR 1일)
- 분기 1회 갱신 데이터라 longer-than-default 캐시 안전

## 색상 컨벤션 (다른 폴리곤과 분리)

- 마을 행정구역: 파랑 (#2563eb, fillOpacity 0.08, zIndex 1)
- **자연취락지구: 보라** (#a855f7, fillOpacity 0.25, zIndex 2)
- 필지(클릭): 주황 (zIndex 5)

## How to apply

- 신규 atomic endpoint 추가 시 이 흐름 미러 가능 (단순 외부 데이터 + 시군구 단위 후처리)
- Turf.booleanIntersects 패턴은 다른 "외부 폴리곤 ∩ 우리 마을" 시나리오에 재사용 가능
- 별도 UI 토글 없이 기존 클릭 흐름에 piggyback 하는 방식이 의뢰자 선호 (덕지덕지 방지)