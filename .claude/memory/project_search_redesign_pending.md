---
name: 주소·지번 검색 재설계 숙제
description: 현재 검색 로직 문제점 — 리 후보 1건일 때만 지번 검색. 리/MV/지번 흐름 전체 갈아엎을 필요.
type: project
---

## 현재 검색 로직의 문제 (2026-05-05 발견)

`web/app/api/search/route.ts` line 117:

```ts
if (validMatches.length === 1 && parsed.lotMain !== null) {
  const jibunResult = await searchJibun(...);
}
```

리 후보가 **정확히 1건일 때만** 지번 검색을 함. 0건/2건 이상이면 스킵.

### 발견 케이스
"성남리 160" 검색 → 성남리 동명 6개 → 지번 검색 자체가 호출 안 됨 → "지번 결과 없음".
실제로는 신림면 성남리에 산160 데이터 있음. 사용자 입장에서 검색 누락.

### 추가로 얽혀있는 문제

1. **리 검색은 MV(`kepco_map_summary`) 본다** — 자동 갱신 안 됨.
   - 사용자가 [수집] 으로 새 데이터 넣어도 MV 미반영 시 검색 누락.
   - MV refresh 트리거: 크롤러 1시간/사용자 수동 새로고침 버튼.

2. **지번 검색은 DB 직접** (`kepco_capa`) — 실시간.

3. **리/지번 결과 분리 노출** — 사용자가 "리 단위" 탭에서 클릭해야 지번이 보이는 흐름.

### 의뢰자 결정 (2026-05-05)
"완전히 다 갈아엎어야겠다" — 부분 패치 X. 검색 흐름 전체 재설계 후 일괄 적용.

## How to apply
검색 관련 작업할 때 이 메모 먼저 확인. 현재 로직 손대기 전에 의뢰자와 재설계 합의 필요.

관련 파일:
- `web/app/api/search/route.ts`
- `web/lib/search/searchKepco.ts`
- `web/lib/search/parseQuery.ts`
- `web/components/map/SearchResultList.tsx`
- `db/migrations/042_search_redesign.sql` (현재 흐름 정의)