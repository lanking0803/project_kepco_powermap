---
name: Supabase RPC plan caching 함정
description: 같은 SQL 인데 RPC 안에서 호출하면 PostgreSQL planner 가 generic plan 으로 굳어 인덱스 못 활용 → timeout. 실측 1.5ms ↔ 2,000ms+. supabase-js 쿼리빌더 직접 호출이나 표현식 인덱스로 회피.
type: reference
---

# 발견 (2026-04-30, 042 검색 재설계 중)

`replace(addr_jibun, '-', '') LIKE '%X%'` 같은 표현식 매칭을 RPC 본문에 넣어서 호출하면 — `LANGUAGE SQL` 이든 `LANGUAGE plpgsql` 이든 — **PostgreSQL planner 가 prepared plan 으로 캐시하면서 generic plan 선택 → 인덱스 활용 못 하고 풀스캔**.

## 실측 (kepco_capa 1.73M rows)

같은 SQL:
```sql
SELECT id FROM kepco_capa
WHERE bjd_code = '4476042028'
  AND replace(addr_jibun, '-', '') LIKE '143%'
```

| 실행 방식 | 시간 | 인덱스 활용 |
|---|---|---|
| 직접 SQL (literal 값 박힘) | **1.5 ms** | idx_capa_bjd_code 활용 |
| RPC 안에 동일 SQL | **2,000~6,000 ms** | 풀스캔, shared_buffers 26K 페이지 read |
| RPC 콜드 첫 호출 | **6,000~10,000 ms** | timeout 직전 |

원인: 함수 파라미터(`p_bjd_code`, `p_jibun_norm`) 가 변수라 planner 가 selectivity 추정 못 함 → "이 LIKE 가 얼마나 매칭될지 모름" 으로 판단 → 풀스캔 plan 선택 → cache.

## 회피 방법

### A. supabase-js 쿼리빌더 직접 호출 (DB 변경 0)
```ts
await supabase
  .from('kepco_capa')
  .eq('bjd_code', bjd)
  .or('addr_jibun.eq.29,addr_jibun.like.29-%,...')
```
PostgREST 가 매번 fresh SQL 만들어 보내고 Postgres 가 fresh plan 짜서 인덱스 활용. **단점: 표현식 필터 (`replace(...)`) 못 씀** — 컬럼 직접 매칭만 가능.

### B. 표현식 인덱스 추가
```sql
CREATE INDEX idx_xxx ON tbl ((replace(col, '-', '')) text_pattern_ops) WHERE ...;
```
RPC 본문 그대로 두고 인덱스만 추가하면 plan 함정 회피됨. **DB 용량 추가 (kepco_capa 기준 ~13MB)**.

### C. GENERATED 컬럼 + 일반 인덱스
```sql
ALTER TABLE tbl ADD COLUMN col_norm TEXT GENERATED ALWAYS AS (...) STORED;
```
PostgREST 에서 일반 컬럼처럼 filter 가능. **컬럼 + 인덱스 둘 다 늘어남**.

## 적용된 결정 (042)

- 1단계 search_address: `bjd_master` 풀스캔 30ms — RPC 안에 둬도 OK (작은 테이블, 풀스캔 정상)
- 2단계 search_jibun: **RPC 폐기, supabase-js 쿼리빌더 직접 호출** (옵션 A). `addr_jibun = '29' OR LIKE '29-%' OR ...` OR 패턴.

## 향후 주의

- "단순한 RPC 인데 느려요" 라고 보이면 **이 함정부터 의심**.
- EXPLAIN ANALYZE 를 RPC 호출로 감싸지 말고 **본문 SQL 을 literal 값 박아서 직접** 측정해서 비교.
- 직접 SQL: ms 단위 / RPC: 초 단위 → plan caching 함정 확정.
- 정규화 / 표현식 매칭이 필요하면 **DB 용량 트레이드오프 (옵션 B/C) 또는 클라이언트 OR 패턴 (옵션 A 변형)** 선택.

## 관련

- 042 마이그레이션: db/migrations/042_search_redesign.sql
- 클라이언트 호출: web/lib/search/searchKepco.ts (searchJibun 함수)