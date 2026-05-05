---
name: KEPCO retrieveMeshNo 5필드+jibun 빈값 채움 규칙 (확정)
description: 의뢰자 직접 캡처 6건 + bjd_master DB 검증으로 확정. 자리마다 채움 규칙이 다름. si/gu=-기타지역, li/jibun=빈문자열, lidong=빈값 발생 안 함, 세종은 si=do.
type: reference
---

## 🎯 핵심 결론 (2026-05-05 의뢰자 직접 KEPCO 사이트 캡처로 확정)

**KEPCO 빈값 채움 규칙은 자리(sep)마다 다름.** 단순히 "빈값 → -기타지역" 규칙이 아니다.

| sep | 자리 | 빈값일 때 | 발생 가능? |
|---|---|---|---|
| sep_1 | do (시도) | (항상 채워짐) | - |
| sep_2 | si (시) | `-기타지역` | ⭕ |
| sep_3 | gu (구/군) | `-기타지역` | ⭕ |
| sep_4 | lidong (읍/면/동) | (해당 없음) | ❌ DB 검증 |
| sep_5 | li (리) | `""` (빈문자열) | ⭕ |
| sep_6 | jibun (지번) | `""` (빈문자열) | ⭕ |

### 예외 1건 — 세종특별자치시
- `si` 자리에 `-기타지역` 이 아니라 **`do` 와 동일값** (`"세종특별자치시"`)
- KEPCO 콤보박스도 시 자리에 자동으로 `세종특별자치시` 채워줌

### KEPCO 자체 분류 ≠ 행안부 표준 (참고)
- 양산시가 KEPCO 에선 **부산광역시 산하** 로 등록됨 (행안부는 경상남도)
- 우리 bjd_master 와 KEPCO 콤보 분류가 일부 어긋날 수 있음. PNU 좌표 기준이라 영향은 제한적이지만 모니터링 필요.

---

## 📋 검증 데이터 — 의뢰자 캡처 6건 (retrieveMeshNo request body)

### 케이스 1 — 도-군 (경기 양평)
```json
{ "do": "경기도", "si": "-기타지역", "gu": "양평군",
  "lidong": "청운면", "li": "", "jibun": "0-19" }
```
→ sep_2 빈값 = `-기타지역` ✅, sep_5 빈값 = `""` ✅

### 케이스 2 — 광역시 산하 일반시 (KEPCO 분류 특이)
```json
{ "do": "부산광역시", "si": "양산시", "gu": "-기타지역",
  "lidong": "덕계동", "li": "", "jibun": "805-3" }
```
→ sep_3 빈값 = `-기타지역` ✅. KEPCO 가 양산시를 부산 산하로 분류한다는 발견.

### 케이스 3 — 도-시-동 (구 없는 시)
```json
{ "do": "경상남도", "si": "김해시", "gu": "-기타지역",
  "lidong": "외동", "li": "", "jibun": "1107-5" }
```
→ sep_3 빈값 = `-기타지역` ✅ (군산/목포/경주/김해 0건 그룹의 진짜 정답)

### 케이스 4 — 도-시-구 (밀양)
```json
{ "do": "경상남도", "si": "밀양시", "gu": "-기타지역",
  "lidong": "가곡동", "li": "", "jibun": "10-16" }
```

### 케이스 5 — 광역시 자치구 (부산 우동)
```json
{ "do": "부산광역시", "si": "-기타지역", "gu": "해운대구",
  "lidong": "우동", "li": "", "jibun": "1025-94" }
```

### 케이스 6 — 세종 (sep_2 do 동일)
```json
{ "do": "세종특별자치시", "si": "세종특별자치시", "gu": "-기타지역",
  "lidong": "한솔동", "li": "", "jibun": "1234" }
```
→ 세종 예외 확정

---

## 🗄 sep_4 (lidong) 빈값 = 발생 불가 — DB 검증

bjd_master 에서 `sep_4 IS NULL` 행 = **284건**. 그러나 모두 **시군구 자체 메타 행**:

| bjd_code | sep_1 | sep_2 | sep_3 | sep_4 | sep_5 | 의미 |
|---|---|---|---|---|---|---|
| 5115000000 | 강원특별자치도 | 강릉시 | (null) | (null) | (null) | 강릉시 자체 |
| 5177000000 | 강원특별자치도 | (null) | 정선군 | (null) | (null) | 정선군 자체 |
| 4128100000 | 경기도 | 고양시 | 덕양구 | (null) | (null) | 덕양구 자체 |
| 5100000000 | 강원특별자치도 | (null) | (null) | (null) | (null) | 강원도 자체 |

→ 실제 PNU 가 가리키는 지번 행은 **반드시 sep_4 채워짐** (읍/면/동 단위). lidong 빈값 케이스는 우리 시스템에서 발생할 일 없음.

→ KEPCO 콤보박스 검증 (양평군 / 해운대구) 에서도 동/면 콤보에 `-기타지역` 옵션 없음. 의뢰자 직접 확인.

---

## 🐛 픽스 전 우리 코드 버그 (build-candidates.ts)

```typescript
// ❌ Before
const gu = parsed.sep_3 ?? "";  // 빈문자열로 보냄

// ✅ After
const gu1 = gu || SKIP_VALUE;   // -기타지역으로 채움
```

영향 그룹: 도-시-동 (군산/목포/경주/김해/외동 등). verify_full.py 33케이스 검증에서 0건 떨어졌던 그룹의 진짜 원인.

→ 픽스 후 단위 테스트 + verify_full.py 재검증으로 매칭률 회복 확인.

## 🔗 관련 메모

- [KEPCO 같은 마을 fallback](reference_kepco_fallback.md) — exact 0건 시 같은 bjd_code 안 본번거리 정렬 (보완책)
- [build-candidates.ts](../../web/lib/kepco-live/build-candidates.ts) — 코드
- [verify_full.py](../../scripts/test_kepco_address_lookup/verify_full.py) — 33케이스 검증 도구