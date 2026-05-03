---
name: 자연취락지구 마커 + 클러스터 (2026-05-03)
description: 검색 결과를 줌 어느 단계든 마커로 노출. 클러스터러는 KEPCO 패턴 미러. 마커 클릭 = 폴리곤 1개 강조.
type: project
---

# 자연취락지구 마커 (2026-05-03 도입)

## 배경

검색 결과(시군구당 100~400개 자연취락지구) 가 줌아웃 시 사라지는 인지 이탈 제거. KEPCO/공매처럼 줌 단계별 시각화.

## 기술 결정

- **kakao.maps.Marker + MarkerClusterer** (KEPCO 패턴 그대로 미러)
- 클러스터러 `minLevel = LABEL_VISIBLE_LEVEL + 1 = 8`
  - 줌 ≥ 8: 자동 클러스터링 (emerald 원, 안에 매물 수)
  - 줌 ≤ 7: 자동 분해 → 단독 마커 (centroid 위치)
- CustomOverlay 는 안 쓰는 이유: 클러스터러가 Marker만 받음. 418개 CustomOverlay 그렸다 프리징 사고 복기 (2026-05-03).

## 마커 디자인

KEPCO 마커 형상(카드 28×30 + 화살표 8) 재활용. 색상만 emerald (#10b981) + 흰 테두리 1.5px.
내부 텍스트 = 평수 압축 라벨 (`5K`, `55K`, `500K`, `1.5M`). `formatPyeongCompact()`.

이미지 캐싱: `uqMarkerImageCacheRef` Map (라벨 → MarkerImage). 같은 평수 라벨은 SVG 1회 가공.

## 폴리곤 전략

마커는 검색 결과 전체. 폴리곤은 **카드/마커 클릭 시 그 1개만** 강조 (의뢰자 합의 — 시각 노이즈 최소화).

## 데이터 흐름

```
UqVillageSearchPanel results → onResults → MapClient.uqSearchResults
   ↓
KakaoMap.uqMarkers (lat/lng/area_m2/polygon/center)
   ↓
buildUqMarkerImage(area_m2) + Marker → MarkerClusterer.addMarkers
```

마커 클릭 = `onUqMarkerClick({polygon, center})` = MapClient `handleUqPolygonFocus` (panTo + setUqVillagePolygons([그 1개])).

## How to apply

- 다른 모드에 마커 + 클러스터러 도입 시 본 패턴 미러 가능 (registry 색만 바꿔서)
- 검색 결과 ≥ 50 개 정도면 클러스터러 필수. CustomOverlay 직접 N개는 프리징 위험
- 마커 이미지는 데이터별 다르더라도 unique 라벨 캐시로 가공 부담 최소화