-- ══════════════════════════════════════════════
-- 043: 미사용 함수/테이블/인덱스 청소
-- ══════════════════════════════════════════════
-- 배경 (2026-04-30):
--   042 검색 재설계 완료 후 DB 전수 조사.
--   pg_stat_user_indexes 누적 사용 통계 + 코드베이스 grep 결과 기준
--   장기간 미사용으로 확인된 자산 일괄 제거.
--
-- 절감: 약 1.9 MB + INSERT/UPDATE 시 인덱스 유지 비용 감소.
-- ══════════════════════════════════════════════

-- ──────────────────────────────────────────────
-- 1. 미사용 함수
-- ──────────────────────────────────────────────
-- get_db_size: grep 결과 사용처 0
DROP FUNCTION IF EXISTS get_db_size();

-- ──────────────────────────────────────────────
-- 2. 미사용 테이블
-- ──────────────────────────────────────────────
-- kepco_refresh_log: grep 결과 사용처 0 (1 row, 24KB)
DROP TABLE IF EXISTS kepco_refresh_log;

-- ──────────────────────────────────────────────
-- 3. 미사용 인덱스 (누적 idx_scan 0~7회, 1년 운영 기준)
-- ──────────────────────────────────────────────
-- 0회 사용
DROP INDEX IF EXISTS idx_summary_xy;          -- kepco_map_summary(lat, lng)   264 KB
DROP INDEX IF EXISTS idx_user_roles_role;     -- user_roles(role)              16 KB

-- 한 자리 회 사용 (사실상 미사용)
DROP INDEX IF EXISTS idx_addr_latlng;         -- kepco_addr(lat, lng) PARTIAL  816 KB / 7회
DROP INDEX IF EXISTS idx_addr_bjd_code;       -- kepco_addr(bjd_code) PARTIAL  688 KB / 3회
DROP INDEX IF EXISTS idx_summary_remaining_desc; -- kepco_map_summary           72 KB / 3회
DROP INDEX IF EXISTS idx_crawl_jobs_thread_status; -- crawl_jobs                16 KB / 1회

-- 보존되는 활용 인덱스 (참고):
--   idx_bjd_sep                  82,658회 ⚠ 핵심
--   idx_capa_bjd_code               597회 (042 검색 핵심)
--   idx_crawl_jobs_active            38회
--   idx_crawl_jobs_created        1,956회
--   pkey/ukey 들                   상시
