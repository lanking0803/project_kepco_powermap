---
name: ParcelInfoPanel 탭 카드 패턴 — 공매탭 미러
description: 가격/공매/경매 등 ParcelInfoPanel 안의 탭들은 공매탭 카드 패턴(rounded-md border 헤더+본문) 으로 통일. 색상만 분기.
type: project
---

# ParcelInfoPanel 탭 카드 통일 패턴

## 결정 (2026-05-02)
의뢰자 명시: "공매탭 스타일을 그대로 적용해 색상만 다르게 하면되겠네 통일감도 있고 좋잖아"

→ ParcelInfoPanel 안의 모든 탭(필지/전기/공매/경매/가격/입지/규제) 의 카드 컴포넌트는 **공매탭 Section 패턴**을 미러.

## 패턴 (공매탭 OnbidTab 의 Section 함수 기준)

```tsx
<div className="rounded-md border border-{accent}-100 overflow-hidden bg-white">
  <div className="px-2.5 py-1.5 bg-{accent}-50 border-b border-{accent}-100">
    <div className="text-xs font-bold text-{accent}-900">{title}</div>
    {/* 우측 액세서리 (선택) */}
  </div>
  <div className="px-2.5 py-2 bg-white">{children}</div>
</div>
```

## 색상 규약 (탭별 accent)

| 탭 | accent | 의미 |
|---|---|---|
| 공매 | rose | 캠코 부동산 매물 |
| 경매 | amber | Hyphen 법원경매 |
| 가격 — 실거래 | blue | 영업 핵심 정보 (RTMS) |
| 가격 — 공시지가 | gray | 정부 발표값 (보조/참고) |

→ 한 탭 안에서도 정보 종류별 색 분리 가능 (가격탭이 그 예).

## 구현체

- 공매: [web/components/map/onbid/OnbidTab.tsx](../../web/components/map/onbid/OnbidTab.tsx) `function Section`
- 가격: [web/components/map/parcel/PriceCard.tsx](../../web/components/map/parcel/PriceCard.tsx) — accent="blue"|"gray" prop

## How to apply

- 신규 탭/카드 추가 시 새 헬퍼 만들지 말고 위 두 헬퍼 중 하나 재사용 (또는 동일 패턴으로 신규 생성, accent 만 다르게)
- 카드 헤더 = subtitle/rightSlot 까지 prop 으로 받게 설계 (공매·가격 모두 그렇게 만들어둠)
- 카드 안의 본문은 자유 — 단 폰트 크기/색상은 `text-xs` 기본, 강조는 `font-bold` 위주

## 위반 사례 (피할 것)

가격 탭 1차 시도 (2026-05-02 폐기):
- `<div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3">` 같은 원자 div 들로 카드마다 다른 스타일
- 공매탭과 시각 통일감 X
- 의뢰자 지적 후 PriceCard 헬퍼로 일괄 교체