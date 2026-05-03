---
name: 필지(시설) 마을 마커 — 공매·경매 패턴 미러
description: 필지 모드 마을 마커 + 카드 + 모달 신설(2026-05-03). 건축HUB 무좌표 응답을 bjd_master JOIN 으로 보강. 공매·경매 100% 미러링.
type: project
---

## 의뢰자 요구 (확정)

> "마을단위 1마커가 맞다. 공매와 경매와 동일하게. 마커 위치가 전기랑 겹치더라도 필지모드에서는 필지마커가 무조건 위로." (2026-05-03 카톡)
>
> 추가: "상세보기 스타일도 경.공매와 통일. 지번 클릭하면 모달 닫히게."

원래 [project_target_buildings_overlay.md](project_target_buildings_overlay.md) (2026-04-14) 의 "유리온실/축사/대형건물 지도 표시" 요구의 **마커 시각화 단계**.

## 핵심 결정

**Why:** 공매·경매와 정확히 같은 시각·코드 패턴. 6개월 뒤 누가 봐도 형제 모드처럼 보여야 유지보수 쉬움.

**How to apply:** 필지 모드의 마커/카드/모달 어떤 변경이든 공매(`OnbidVillage*`)·경매(`AuctionVillage*`) 의 동일 영역 변경과 비교 — 패턴 어긋나면 그게 신호. 공통 추상화 도입은 금지(셋 다 안정될 때까지). 5줄 절약하려고 추상층 깔지 말 것.

## 미러링 매핑

| 영역 | 공매 | 경매 | 필지 |
|---|---|---|---|
| atomic | `/api/onbid/search` | `/api/auction/search` | `/api/facility/search` |
| 그룹화 | `lib/onbid/group.ts` | `lib/hyphen/group.ts` | `lib/facility/group.ts` |
| 마을 카드 | `OnbidVillageCard` | `AuctionVillageCard` | `FacilityVillageCard` |
| 마을 모달 | `OnbidVillageModal` | `AuctionVillageModal` | `FacilityVillageModal` |
| 매물 카드 | `OnbidItemCard` | `AuctionItemCard` | `FacilityItemCard` |
| 마커 CSS | `.onbid-card-marker` (rose) | `.auction-card-marker` (amber) | `.facility-card-marker` (violet) |
| 카드 zIndex | 100 | 100 | 100 |
| dot zIndex | 50 | 50 | 50 |

## 좌표 출처 (함정 주의)

건축HUB 응답에 위경도 **없음** (78개 필드 전부 검증). 공매·경매도 동일 — 셋 다 `bjd_master` JOIN 으로 동 단위 좌표 보강.

```
sigunguCd + bjdongCd = BJD 10자리
→ supabase.from("bjd_master").select("bjd_code, lat, lng").in("bjd_code", [...])
```

RPC 아닌 **쿼리빌더 직접 SELECT**. RPC 쓰면 generic plan trap 위험 ([reference_supabase_rpc_plan_trap.md](reference_supabase_rpc_plan_trap.md)).

## 동적 갱신 패턴 (중요)

`selectedFacilityVillage` 를 그룹 스냅샷이 아니라 **BJD 키만 보관** + `useMemo` lookup. 사이드바 필터 바꿀 때마다 카드/모달의 모든 수치(시설 수/평균 평수/카테고리 분포)가 자동 갱신.

```ts
const [selectedFacilityKey, setSelectedFacilityKey] = useState<string | null>(null);
const facilityVillages = useMemo(() => groupFacilityItemsByVillage(facilitySearchResults), [...]);
const selectedFacilityVillage = useMemo(
  () => selectedFacilityKey ? facilityVillages.find(g => g.key === selectedFacilityKey) ?? null : null,
  [selectedFacilityKey, facilityVillages],
);
```

→ 같은 패턴을 공매·경매에도 적용하면 동일 효과 (현재 공매/경매는 group 스냅샷 보관 중 — 필요 시 회귀).

## 모달 닫힘 흐름

시설 카드 클릭 → `handleFacilityItemClick` → `buildPnuFromRawItem` → `openParcelPanelByPnu` 매칭 성공 → 진입점 함수 안에서 일괄 cleanup:

```ts
setOnbidModalOpen(false);   setSelectedOnbidVillage(null);
setAuctionModalOpen(false); setSelectedAuctionVillage(null);
setFacilityModalOpen(false); setSelectedFacilityKey(null);
```

→ 어느 모달에서 진입하든 통합 진입점에서 모두 정리. 모드 간 잔상 0.

## 검색 단위 = 마커 단위

검색 입력이 BJD 10자리 단위(동/리)라 결과가 같은 BJD 에 몰림. 사이드바 검색 1번 = 마을 마커 1~수십개 (농촌 면 "전체" 선택 시 N개 리). 의뢰자 합의: "마을 단위 1마커가 맞다."

→ 개별 시설 마커(N건 = N마커) 은 외부 호출 N건 필요 — 채택 안 함.