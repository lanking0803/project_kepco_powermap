-- ══════════════════════════════════════════════
-- 041: solar_permits 테이블 DROP
-- ══════════════════════════════════════════════
-- 배경:
--   solar_permits 데이터 저장소를 DB 테이블 → Supabase Storage 'solar-permits' bucket
--   (BJD 별 JSON, Public + Smart CDN) 으로 전환 완료 (2026-04-29).
--
--   변경 이력:
--     - 040 (2026-04-27): solar_permits 테이블 + 인덱스 신설, 매월 TRUNCATE+INSERT
--     - 워커 commit 5735897, ae928e0 (2026-04-29): 워커가 Storage 만 채우도록 전환
--     - 라우트 commit a70747c + 후속 (2026-04-29): /api/solar-permits/by-pnu Storage 전환
--     - 041 (이 파일): 더 이상 참조하지 않는 DB 테이블 제거
--
-- 회수 효과:
--   - 디스크 ~23 MB (행 ~85k + idx_solar_permits_pnu + idx_solar_permits_bjd)
--   - DB Size 96% 포화 완화 (KEPCO 380 MB 정리 전 마진 확보)
--
-- 롤백:
--   - 라우트 v1 코드는 git history 에 보존 (a70747c 직전).
--   - DB 데이터는 외부 API + 워커 재실행 (수동 dispatch) 으로 즉시 복원 가능.
--   - 즉 이 DROP 은 "Storage 전환 검증 통과" 후 적용. 검증 전엔 042 부터 사용.
-- ══════════════════════════════════════════════

DROP INDEX IF EXISTS idx_solar_permits_pnu;
DROP INDEX IF EXISTS idx_solar_permits_bjd;
DROP TABLE IF EXISTS solar_permits;
