---
name: DB 자산 청소 시 함수 본문까지 검사
description: 테이블/인덱스/함수 청소 전, 코드 grep 만이 아니라 DB 함수·트리거·뷰 본문(pg_proc.prosrc 등)까지 검색해야 함
type: feedback
---

DB 자산을 "미사용" 으로 판단해 DROP 하기 전에는 **반드시 두 단계 검색**을 모두 수행한다:

1. **코드베이스 grep** — TS/Python/SQL 파일에서 직접 참조 검색
2. **DB 메타데이터 검색** — 함수/트리거/뷰 본문 안의 SQL 참조 검색
   ```sql
   -- 함수 본문에서 참조 찾기
   SELECT proname FROM pg_proc WHERE prosrc ILIKE '%대상이름%';
   -- 뷰 정의에서 참조 찾기
   SELECT viewname FROM pg_views WHERE definition ILIKE '%대상이름%';
   -- 트리거
   SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal;
   ```

**Why:**
2026-05-02, `043_cleanup_unused.sql` 에서 `kepco_refresh_log` 테이블을
"코드 grep 사용처 0" 으로 판단해 DROP. 실제로는 `refresh_kepco_summary()`
함수 본문 안에서 cooldown 계산용 SELECT/UPDATE 로 사용 중이었음.
TS/Python grep 으로는 함수 본문 SQL 안의 참조를 못 잡아서 누락.
결과: `/api/refresh-mv` 가 'relation does not exist' 로 500. 045 에서 복구.

**How to apply:**
- DB migration 에서 `DROP TABLE/INDEX/FUNCTION` 작성 시, 청소 근거에
  "코드 grep + pg_proc/pg_views/pg_trigger 검색 모두 0건" 두 줄을 명시
- 인덱스 청소는 `pg_stat_user_indexes.idx_scan` 누적값까지 추가로 확인
- 함수가 의존하는 자산을 떨굴 때는 함수도 같이 정리하거나, 의존성을
  먼저 끊고 단계적으로 진행