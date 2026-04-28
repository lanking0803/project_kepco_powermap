---
name: 2차 영업 대상 자동 발굴 시스템 — 착수 인덱스
description: 2차(700만) 5개 항목 작업 분할 + 데이터 소스 상태 + 우선순위. 1차 5단계 완료(2026-04-28) 후 시작점
type: project
---

> 1차 본 단계 100% 완료(2026-04-28) → **2차 착수**.
> 가격/카톡 양식 → [docs/견적_1차2차.md](../../docs/견적_1차2차.md) §"2차".
> 이 메모는 **"어디서부터 어떤 순서로 시작할지"** 단일 진입점.

## 📦 2차 항목 5종 (700만 / 약 2.5개월)

| 순번 | 항목 | 금액 | 데이터 소스 | 검증 상태 |
|---|---|---|---|---|
| 1 | 유리온실/축사 + 여유선로 + 일반 건물 평수 구간 | 250만 | 건축물대장 + KEPCO 자체 DB | ✅ [reference_bldg_register_api.md](reference_bldg_register_api.md) |
| 2 | 공시지가 / 평수 라벨 (땅야 스타일) | 100만 | 국토부 공시지가 API | ⏳ 미검증 |
| 3 | 실거래가 표시 | 100만 | 국토부 실거래가 API | ⏳ 미검증 |
| 4 | 공매 표시 (2차 1번 화면에 통합) | 100만 | 캠코 온비드 OpenAPI | ✅ [project_auction_intent.md](project_auction_intent.md) |
| 5 | ➕ 취락지구 여유선로 | +150만 | VWorld WFS `lt_c_uq128` (키 활성화 완료 2026-04-20) | ✅ 키 OK / 호출 검증 X |

**합계 700만** (1+4 묶음 350만 우선 권장 — 의뢰자 컨펌으로 같은 화면 통합).

## 🚀 권장 우선순위

### 1순위 — **2차 1번 + 공매 통합 (350만 묶음)**
- 데이터 검증 다 끝남 → 즉시 개발 가능
- 의뢰자 차별화 핵심: KEPCO 여유 ∩ 공매 매물 결합 (경쟁사 불가)
- 통합 UI 1개 화면 → 분리 개발보다 효율 +
- 세부 흐름 → [project_auction_intent.md](project_auction_intent.md) §"UI 통합 전략"

**작업 분할**
- Step 1: `auctions` 테이블 마이그레이션 (`source` 컬럼 — 추후 경매 확장 대비)
- Step 2: `crawler/sync_onbid.py` 일배치 (4개 재산유형 sweep, 부동산만 필터)
- Step 3: 캠코 용도 코드 → 우리 5종 카테고리(토지/온실/축사/창고/50평+) 매핑 테이블
- Step 4: 건축물대장 동·식물관련시설 매칭 (유리온실/축사 자동 분류)
- Step 5: 지도 깜빡이 원 마커 시스템 (🔵 여유 / 🔴 부족 / 🟥 공매)
- Step 6: 가격탭 공매 배지 (보너스)

### 2순위 — **취락지구 +150만**
- VWorld WFS 키 활성화 완료, 호출 검증만 하면 빠른 추가
- 이미 만든 깜빡이 원 시스템에 4번째 카테고리 추가 (재사용)
- 폴리곤-마을 inclusion + fallback 로직만 신규
- 의뢰자 의도: [project_solar_proposal.md](project_solar_proposal.md) §"협상 내부 메모 — 취락지구"

### 3순위 — **공시지가 + 실거래가 (각 100만)**
- 미검증 API 2개 — 호출 검증부터
- 의뢰자 의도 = "토지 가치 평가 + 매입 기회" 패키지의 시세 축
- 1+4 통합 + 5(취락지구) 끝나고 마지막에

## ⏳ 1차 잔여 (2차와 병행 가능)

- ➕ 조례 옵션 (+30만) — 의뢰자 노출 기준 회신 받는 즉시 (1주)
- 회사 로고 PNG — `/public/print/company-logo.png` 자리만 두면 PDF 자동 반영
- 1차 후 추가 협의 (별도 청구) — 견적서 관리 90만 + 시공비 5항목 % 분해 30~50만

## 🔗 관련 메모

- [project_solar_proposal.md](project_solar_proposal.md) — 협상 맥락 / 1·2차 진행 상태
- [project_auction_intent.md](project_auction_intent.md) — 공매 의도 + 카테고리 + 캠코 코드 매핑
- [project_target_buildings_overlay.md](project_target_buildings_overlay.md) — 2차 1번 UI 패턴 사전 메모
- [reference_bldg_register_api.md](reference_bldg_register_api.md) — 건축물대장 검증 결과