---
name: 캠코 공매 lctnSggnm 표기 규칙
description: 캠코 onbid lctnSggnm 은 일반시 일반구의 경우 "성남시 분당구" 통합 표기. 광역시 자치구/일반 군은 단독. 검증 2026-05-02 (분당구 단독 검색 0건 사고).
type: reference
---

# 캠코 공매 lctnSggnm 표기 규칙 (검증 2026-05-02)

## 사고 복기
- 가설: "캠코는 자치구/일반구 단독 표기" — **틀림**
- 사고: 의뢰자 검색 — 경기도 / "분당구" → 0건. "성남시 분당구" → 162건.
- 메모리 [feedback_no_lies_no_guess.md] 위반 — 추측으로 가설 만들고 그대로 구현.

## 사실 (실증)

| 케이스 | bjd_master sep_2 | bjd_master sep_3 | 캠코 lctnSggnm 표기 |
|---|---|---|---|
| 광역시 자치구 | NULL | "강남구" | **"강남구"** (단독) |
| 일반 군 | NULL | "곡성군" | **"곡성군"** (단독) |
| 일반시 일반구 | "성남시" | "분당구" | **"성남시 분당구"** (통합) |

**규칙**: `si` (sep_2) NULL 이면 `gu` 단독. NOT NULL 이면 `"si gu"` 통합.

```ts
const display = entry.si ? `${entry.si} ${entry.gu}` : entry.gu;
qs.set("sigungu", display);  // 그대로 송신
```

## 다른 모드 적용 시 주의

- **자연취락지구** = 자체 atomic 사용 (bjd_code 5자리), lctnSggnm 무관
- **경매 (Hyphen)** = API 명세 별도 검증 필요 — 캠코 가설 그대로 적용 금지
- **그 외 한글 시군구 받는 외부 API** = 실 호출 검증 필수

## How to apply

- 한국 행정구역 한글 시군구 표기는 시스템마다 다르므로 **무조건 실 호출 검증**
- bjd_master 는 sep_2/sep_3 분리 저장 → 결합은 시스템 표기 따라 분기
- 광역시 → sep_2 NULL 이라 자연히 단독, 일반시 → sep_2 NOT NULL 이라 통합 — bjd_master 데이터 자체가 분기 키