-- ══════════════════════════════════════════════
-- 045: kepco_refresh_log 테이블 복구
-- ══════════════════════════════════════════════
-- 배경 (2026-05-02):
--   043_cleanup_unused.sql 에서 "코드베이스 grep 사용처 0" 으로 판단해
--   kepco_refresh_log 테이블을 DROP 했으나, 실제로는 DB 함수
--   refresh_kepco_summary() 본문 안에서 cooldown 계산용으로 사용 중이었음.
--   (TS/Python grep 으로는 함수 본문 SQL 안의 참조를 잡지 못함)
--
--   결과: /api/refresh-mv 호출 시
--     'relation "kepco_refresh_log" does not exist' 로 500 에러.
--
--   함수 자체는 그대로 살아있고, 함수는 lazy resolve 라
--   테이블만 복구하면 다음 호출부터 정상 동작함.
--
-- 정의는 018_refresh_lock_timeout.sql 의 원본 그대로.
-- ══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS kepco_refresh_log (
  id int PRIMARY KEY CHECK (id = 1),
  last_refreshed_at timestamptz NOT NULL DEFAULT 'epoch'
);

INSERT INTO kepco_refresh_log (id) VALUES (1) ON CONFLICT DO NOTHING;

COMMENT ON TABLE kepco_refresh_log IS
  'kepco_map_summary 의 마지막 REFRESH 완료 시각. cooldown 계산용 1행 메타 테이블. (045 에서 복구 — 043 청소 시 함수 의존성 누락)';
