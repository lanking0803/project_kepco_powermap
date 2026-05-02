---
name: 시군구 atomic endpoint — 모드 공통 자산
description: /api/regions/sigungu 는 모든 모드의 시도/시군구 드롭다운 공통 데이터 소스. bjd_master 단일 진실 공급원, 30일 CDN + 모듈 캐시.
type: project
---

# 시군구 atomic (2026-05-02 도입)

## 구조

```
[DB] bjd_master (행안부 표준, 월 1회 CSV)
   ↓ unique 250 시군구
[atomic] /api/regions/sigungu  (CDN 30일)
   ↓
[wrapper] lib/api/regions.ts  (모듈 캐시 + inflight 합치기)
   ↓
[적용 완료] 취락지구 ✅ / 공매 ✅
[예정]      경매 / 시설
```

응답 (`SigunguEntry`): `{ sido, si, gu, code }`
- 한글 = UI 표시용
- code (bjd_code 앞 5자리) = API 호출 키

## 캐시 3중
1. 클라이언트 모듈 scope (페이지 라이프타임)
2. Vercel CDN `s-maxage=2592000` (30일)
3. Supabase 도달은 사실상 30일 1회

## How to apply
- 신규 모드 시도/시군구 드롭다운 필요 시 → `fetchSigungus()` 한 줄. 정적 상수/MV derive 금지.
- 한글 표기는 시스템마다 다름 → 외부 API 송신 시 실 호출 검증 필수 ([reference_onbid_sigungu_format.md](reference_onbid_sigungu_format.md))
- 행정구역 개편 시 bjd_master CSV 재적재만으로 자동 반영