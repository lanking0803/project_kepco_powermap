-- ══════════════════════════════════════════════
-- 042: 검색 시스템 전면 재설계 — 단순 정규화 LIKE
-- ══════════════════════════════════════════════
-- 배경 (2026-04-30):
--   기존 search_kepco RPC (039) 는 한 RPC 안에서 bjd_master ILIKE +
--   kepco_capa 폴백을 묶어 처리. 자유 텍스트 한 줄 입력 + ANY(matched_bjd)
--   + lot_no 범위 비교 조합에서 plan 오선택으로 8s timeout 초과.
--
-- 재설계 컨셉 ("DB에 있는 그대로 매칭, 폴백 없음"):
--   1) 한글 입력 → 클라이언트 정규화 (약어 치환 + 공백/특수문자 제거)
--   2) bjd_master 5개 sep 컬럼 합본 + 공백 제거에 단일 LIKE
--   3) 본번/부번 매칭은 클라이언트가 supabase-js 쿼리빌더로 직접 호출
--      (RPC 안 LIKE 가 Postgres plan 함정에 빠지는 이슈 회피)
--
-- DB 정리 항목:
--   - DROP FUNCTION search_kepco         사용 안 함
--   - DROP FUNCTION kepco_jibun_main     새 모델에서 안 씀
--   - DROP INDEX idx_capa_jibun_main     표현식 인덱스 안 씀 (~5MB 절감)
--   - DROP FUNCTION search_jibun*        2단계는 RPC 안 씀 (클라이언트 직접)
--
-- 실측:
--   - 1단계 search_address  : pure DB ~30ms, 워밍 후 50-90ms wall-clock
--   - 2단계 쿼리빌더 직접   : 워밍 후 30-300ms wall-clock
--
-- 응답 schema:
--   search_address(addr_normalized TEXT, match_limit INT)
--     → { matches: [{ bjd_code, sep_1..sep_5, full_address, cnt, lat, lng, ... }] }
-- ══════════════════════════════════════════════

-- ──────────────────────────────────────────────
-- 1. 레거시 / 이전 시도 정리
-- ──────────────────────────────────────────────
DROP FUNCTION IF EXISTS search_kepco(TEXT[], INTEGER, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS search_address(TEXT[], INTEGER);
DROP FUNCTION IF EXISTS search_jibun(TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS search_jibun(TEXT, INTEGER, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS search_jibun_main(TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS search_jibun_sub(TEXT, INTEGER, INTEGER, INTEGER);

-- 2단계가 RPC 가 아니라 클라이언트 쿼리빌더 직접 호출이고
-- 그 쿼리에서 kepco_jibun_main 표현식을 안 쓰므로 인덱스 제거 (~5MB 절감)
DROP INDEX IF EXISTS idx_capa_jibun_main;

-- 표현식 함수도 사용처 0 → 제거
DROP FUNCTION IF EXISTS kepco_jibun_main(TEXT);

-- ──────────────────────────────────────────────
-- 2. 1단계 RPC — bjd_master 정규화 LIKE
-- ──────────────────────────────────────────────
-- 클라이언트가 정규화한 addr_normalized 를 받아 sep 합본+공백제거에 LIKE 매칭.
-- bjd_master 20K row 풀스캔 ~30ms.
-- "부여군 지토리" 처럼 가운데 단계(장암면) 빼먹으면 매칭 안 됨 (의도된 동작).
CREATE OR REPLACE FUNCTION search_address(
  addr_normalized TEXT,
  match_limit     INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE SQL
STABLE
AS $func_addr$
  SELECT jsonb_build_object(
    'matches',
    COALESCE(
      (SELECT jsonb_agg(row_to_json(t))
       FROM (
         SELECT
           b.bjd_code,
           b.sep_1, b.sep_2, b.sep_3, b.sep_4, b.sep_5,
           concat_ws(' ', b.sep_1, b.sep_2, b.sep_3, b.sep_4, b.sep_5) AS full_address,
           m.total::int AS cnt,
           m.lat,
           m.lng,
           m.geocode_address,
           m.addr_do, m.addr_si, m.addr_gu, m.addr_dong, m.addr_li
         FROM bjd_master b
         LEFT JOIN kepco_map_summary m ON m.bjd_code = b.bjd_code
         WHERE addr_normalized IS NOT NULL
           AND length(trim(addr_normalized)) > 0
           AND regexp_replace(
                 concat_ws('', b.sep_1, b.sep_2, b.sep_3, b.sep_4, b.sep_5),
                 '[[:space:]]', '', 'g'
               )
               LIKE '%' || addr_normalized || '%'
         ORDER BY
           m.total DESC NULLS LAST,
           b.sep_1, b.sep_3, b.sep_4, b.sep_5
         LIMIT match_limit
       ) t),
      '[]'::jsonb
    )
  );
$func_addr$;

COMMENT ON FUNCTION search_address(TEXT, INTEGER) IS
  '042: 1단계 검색 — bjd_master sep 합본 정규화 LIKE 매칭. ~30ms 풀스캔. 폴백 없음.';

-- ──────────────────────────────────────────────
-- 3. 2단계 — RPC 없음 (클라이언트 쿼리빌더 직접 호출)
-- ──────────────────────────────────────────────
-- web/lib/search/searchKepco.ts 의 searchJibun() 가
-- supabase-js 쿼리빌더로 다음 형태 호출:
--
--   본번만(부번 없음):
--     .from('kepco_capa')
--     .eq('bjd_code', bjd)
--     .or('addr_jibun.eq.29,addr_jibun.like.29-%,addr_jibun.eq.산29,addr_jibun.like.산29-%')
--
--   부번까지:
--     .from('kepco_capa')
--     .eq('bjd_code', bjd)
--     .or('addr_jibun.eq.29-4,addr_jibun.eq.산29-4')
--
-- RPC 보다 인덱스 활용 보장됨 (Postgres plan 함정 회피).
