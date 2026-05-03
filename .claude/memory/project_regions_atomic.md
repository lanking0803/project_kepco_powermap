---
name: 행정구역 atomic endpoint — 모드 공통 자산
description: /api/regions/sigungu + /api/regions/eupmyeondong 2단 endpoint. bjd_master 단일 진실 공급원, 30일 CDN + 모듈 캐시.
type: project
---

# 행정구역 atomic (2026-05-02 시군구 도입, 2026-05-03 누락 0 픽스, 2026-05-03 읍·면·동 추가)

## 구조 (2단 atomic)

```
[DB] bjd_master (행안부 표준, 20,560행, 월 1회 CSV)
   ↓
   ├── [1단] /api/regions/sigungu             (시도17+시군구267=284행)
   │     ↓ wrapper.fetchSigungus()  단일 모듈 캐시
   │
   └── [2단] /api/regions/eupmyeondong         (시군구당 8~80행, lazy)
         ↓ wrapper.fetchEupmyeondongs(code)  시군구별 Map 캐시

[적용 완료]
- 시군구 단일 (1단만): 취락지구 ✅
- 시군구 + 읍·면·동 선택 (2단 소비): 공매·경매 (선택), 시설 (필수)
```

## 2단 endpoint — eupmyeondong (2026-05-03)

- 입력: `sigungu_code` (5자리 숫자, /api/regions/sigungu 의 `code`)
- 응답: `{ ok, sigungu_code, count, items: [{ code, label, sido, si, gu }] }`
- 조건: bjd_code 끝 2자리="00" (리 제외) + 6~8번째 ≠ "000" (시군구 자체 제외) + sep_4 NOT NULL
- 검증값: 강남구=14, 구례군=8, 일산서구=8, 광주 동구=34, 일반시 자체 코드(`41280`)=0
- 시설 모드 필수 이유: 외부 건축HUB API 가 sigunguCd+bjdongCd 둘 다 필수, bjdongCd 빈값/생략 시 totalCount=0 (실측 2026-05-03)

응답 (`SigunguEntry`): `{ sido, si, gu, label, code }`
- `sido` = sep_1 (시도 한글)
- `si` = sep_2, `gu` = sep_3 (둘 다 nullable)
- **`label` = `${sep_2} ${sep_3}` trim** ← UI 표시 + 캠코 lctnSggnm 송신 통합값
- `code` = bjd_code 앞 5자리 (API 호출 키)

## 표기 규칙 (4가지 케이스 + 시도 자체)
| 케이스 | sep_2 | sep_3 | label |
|---|---|---|---|
| 광역시 자치구 | null | 강남구 | "강남구" |
| 일반 군 | null | 곡성군 | "곡성군" |
| 일반시 자체 | 여수시 | null | "여수시" |
| 일반시 일반구 | 수원시 | 권선구 | "수원시 권선구" |
| 시도 자체 행 (세종/광역시·도 17개) | null | null | "" (시군구 드롭다운에서 제외) |

## 클라이언트 사용 패턴
- 시도 드롭다운: `Set(items.map(r => r.sido))` — 17개 자동 노출
- 시군구 드롭다운: `items.filter(r => r.sido === 선택 && r.label !== "")` — 267개 분배
- 캠코 송신: `lctnSdnm = sido`, `lctnSggnm = label` (세종은 lctnSggnm 비움 = 시도 단위 검색)

## 캐시 3중
1. 클라이언트 모듈 scope (페이지 라이프타임)
2. Vercel CDN `s-maxage=2592000` (30일)
3. Supabase 도달은 사실상 30일 1회

## How to apply
- 신규 모드 시도/시군구 드롭다운 필요 시 → `fetchSigungus()` 한 줄. 정적 상수/MV derive 금지.
- 표시값은 백엔드 `label` 한 필드만 사용. 클라이언트에서 si/gu 가공 금지(누락 위험).
- 외부 API 송신 시 실 호출 검증 필수 ([reference_onbid_sigungu_format.md](reference_onbid_sigungu_format.md))
- 행정구역 개편 시 bjd_master CSV 재적재만으로 자동 반영