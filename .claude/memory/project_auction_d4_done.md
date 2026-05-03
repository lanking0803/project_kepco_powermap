---
name: 경매 모드 D4 완료 — 진입 흐름 통합
description: 경매 모드의 검색→마커→카드→모달→매물상세 5경로가 모두 ParcelInfoPanel [경매] 탭으로 수렴 (2026-05-03)
type: project
---

# 경매 모드 D4 완료 — 모든 진입 경로 통합 완료

2026-05-03 D4 단계 완료. 검색 결과 카드 / 지도 마커 / 마을 카드 / 모달 → 매물 카드 — 4가지 진입점이 모두 동일 종착점으로 수렴.

## 통합 진입 흐름

```
[A] 검색 결과 카드 클릭 ──────┐
[B] 지도 노란 마커 클릭         │
    ↓                         │
    AuctionVillageCard         │
    ↓                         │
    [매물 N건 자세히 보기]      ├──→ openParcelPanelByPnu(pnu)
    ↓                         │       ↓
    AuctionVillageModal        │     ParcelPanel + [경매] 탭
    ↓                         │     (D2 완성된 AuctionTab/AuctionItemCard/
    매물 카드 클릭 ─────────────┘      AuctionDetailCard 활용)
```

**Why:** 4가지 진입을 하나의 핸들러 `openParcelPanelOnAuctionItemClick` ([MapClient.tsx](../../web/components/map/MapClient.tsx)) 가 책임. PNU 추출 → 카메라 이동 → ParcelPanel 진입 — 한 함수로 일관된 동작.

**How to apply:** 경매 매물 클릭 흐름 수정 시 이 한 함수만 손대면 4경로 동시 반영. 새 진입점 추가 시도 같은 함수 재사용.

## D4 단위별 완료 상태

| 단계 | 작업 | 상태 |
|---|---|---|
| D4-1 | AuctionVillageModal 신규 + MapClient 연결 | ✅ 커밋 2456938 |
| D4-2 | 결과 카드 ↔ 지도 양방향 연동 (카드 클릭 → 카메라 이동 + ParcelPanel) | ✅ |
| D4-3 | 매물 상세 API (`/api/auction/detail`) 연결 | ✅ D2 완성분 활용 (AuctionDetailCard 20833 bytes) |
| D4-4 | ParcelInfoPanel [경매] 탭 본문 | ✅ D2 완성분 활용 (AuctionTab 5893 bytes) |

## 같이 처리된 픽스 (D4-1 커밋)

- **sweep 폭주 픽스** ([client.ts](../../web/lib/hyphen/client.ts)) — 테스트 모드에서 page 1 만 호출. 운영 모드(`HYPHEN_OPERATION_MODE=Y`) 토글 시 자동 풀 sweep 복귀
- **sessionStorage 복원 패턴 픽스** ([AuctionSearchPanel.tsx](../../web/components/map/AuctionSearchPanel.tsx)) — 마운트 시 복원된 results 를 부모로 흘리는 effect 누락 → 회귀 [feedback_session_restore_pattern.md](feedback_session_restore_pattern.md)

## 다음 가능한 작업

- **운영 모드 전환** — Hyphen 결제 + 환경변수 `HYPHEN_OPERATION_MODE=Y` 설정. 코드 변경 0
- **마커 강조** (선택) — 결과 카드 클릭 시 해당 마을 마커에 펄스/링 효과. 현재는 카메라 이동 + ParcelPanel 만
- **추적성** — 의뢰자 영업 활용 후 피드백 받아 보강

## 관련 메모리

- [project_auction_intent.md](project_auction_intent.md) — 경매 모드 큰 그림
- [project_hyphen_billing.md](project_hyphen_billing.md) — Hyphen 비용 + 운영 모드 토글
- [feedback_session_restore_pattern.md](feedback_session_restore_pattern.md) — D3→D4 회귀 사고 복기
- [project_overlay_combined_modes.md](project_overlay_combined_modes.md) — 의뢰자가 원하는 통합 오버레이