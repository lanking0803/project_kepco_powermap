---
name: 시설 모드 — 진행 중 (사이드바 패널 완성, 마커 미구현)
description: 건축물대장 기반 영업 타겟 발굴. 검색 패널 + 카테고리 6종 + 평수 슬라이더 완성. Phase 4(마커) + Phase 5(시설 탭) 미완.
type: project
---

# 시설 모드 (2026-05-03 진행 중)

## ✅ 완료 (Phase 1~3 + 보강)

### Atomic Endpoints (3개)
- `/api/regions/sigungu` — 기존
- `/api/regions/eupmyeondong` — **신설**, 동/면 + 자식 리(hasChildren+children) 1번에 응답
- `/api/buildings/list/by-bjd` — **신설**, 법정동 단위 일괄 (외부 100건 hard cap, 페이지 자동 순회)

### 클라이언트 헬퍼 (lib/api/buildings.ts)
- `fetchAllBuildingsByBjd` — 단건 자동 페이지 순회 (max 20 = 2,000건)
- `fetchAllBuildingsByBjdMulti` — 다중 bjd_code 병렬 (concurrency 5)

### 분류 + 필터 (lib/facility/classify.ts)
- 카테고리 **6종** (의뢰자 영업 행태 기준): greenhouse / barn / factory / warehouse / animalplant_etc / other
- mainPurpsCd 코드 매칭 (한글명 매칭 X — "동물및식물관련시설" 표기 변동 함정 회피)
- "기타 전체" = 5종 외 모든 코드 1클릭 토글
- 평수: archArea ÷ 3.305785, 미상 1.3% 자동 제외

### 사이드바 패널 (FacilitySearchPanel.tsx)
- 지역: 시도 → 시군구 → 읍·면·동 → (농촌만) 리 동적 dropdown
- 리 dropdown 에 "전체" 옵션 → 면의 모든 리 병렬 호출
- 검색 결과는 rawBuildings 보관, **카테고리/평수 변경 시 즉시 재필터** (외부 호출 0)
- 검색조건 접기/펴기 토글 (경매 패턴 미러)
- 모바일 친화 (터치 타깃 32px+, 줄바꿈, 라벨 단축)

### Modes Registry
- `facility.status: "live"` (planned 에서 전환)
- 색상 violet (`#8b5cf6`)

## 🚧 미완 (다음 단계)

### Phase 4 — 마커 + 클러스터러 (다음 작업)
- KakaoMap 에 facility 마커 (violet 단일색, 평수 라벨)
- MarkerClusterer (취락지구 패턴 미러, minLevel = LABEL_VISIBLE_LEVEL+1 = 8)
- 마커 클릭 → 카드 + 카메라 이동
- PNU → 좌표 lazy fetch (VWorld 또는 KEPCO 리 좌표)

### Phase 5 — ParcelInfoPanel [시설] 탭
- 카드 클릭 → 시설 탭 진입
- 풍부한 정보: 도로명/구조/지붕/층수/사용승인일/KEPCO 여유

### Phase 6 — 시연 + 최종 메모리

## ⚠️ 외부 API 함정 (실측 2026-05-03)

| 단위 | 외부 API 응답 | 우리 처리 |
|---|---|---|
| 도시 동 (sep_5 NULL) | sep_4 코드로 응답 ✅ | bjd_code 그대로 호출 |
| 농촌 읍/면 (sep_5 NULL) | **0건 ❌** | 외부 API 미지원 |
| 농촌 리 (sep_5 NOT NULL) | sep_5 코드로 응답 ✅ | 리 코드로 호출 |

→ `/api/regions/eupmyeondong` 가 hasChildren 플래그로 분기 처리.
→ `numOfRows` 100 hard cap (요청 무시), pageNo 순회 필수.

## 🔁 차기 별도 과제
- 공매 검색 패널에 읍·면·동 dropdown 추가 ([project_onbid_eupmyeondong_dropdown.md](project_onbid_eupmyeondong_dropdown.md))
- 영업 권역 사전 적재 (전남 등) — 시군구 단위 즉시 검색 가능
