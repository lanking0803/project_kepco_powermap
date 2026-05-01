-- ══════════════════════════════════════════════
-- 044b: fallback_kepco_nearest RPC plan trap 수정
-- ══════════════════════════════════════════════
-- 원인 (2026-05-01 EXPLAIN 검증):
--   원본 044 RPC = LANGUAGE sql + 변수 바인딩 → planner 가 generic plan 캐시 →
--   bjd_code 인덱스 무시하고 87만건 풀스캔 → 2.5초.
--   Literal SQL = 24ms (인덱스 정상 사용).
--
-- 수정:
--   plpgsql + EXECUTE format() 동적 SQL 로 매번 fresh plan 생성.
--   참고: .claude/memory/reference_supabase_rpc_plan_trap.md
-- ══════════════════════════════════════════════

DROP FUNCTION IF EXISTS fallback_kepco_nearest(text, numeric, int);

CREATE OR REPLACE FUNCTION fallback_kepco_nearest(
  p_bjd_code text,
  p_target_num numeric,
  p_limit int DEFAULT 10
)
RETURNS SETOF kepco_capa
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $outer$
BEGIN
  -- EXECUTE + format 으로 매번 fresh plan 생성 → planner 가 literal 값 보고
  -- bjd_code 인덱스 정상 활용. RPC plan caching 함정 회피.
  RETURN QUERY EXECUTE format($inner$
    SELECT k.*
    FROM kepco_capa k
    WHERE k.bjd_code = %L
      AND k.addr_jibun IS NOT NULL
      AND jibun_to_num(k.addr_jibun) IS NOT NULL
    ORDER BY abs(jibun_to_num(k.addr_jibun) - %L) ASC,
             k.addr_jibun ASC
    LIMIT %s
  $inner$,
    p_bjd_code,
    p_target_num,
    GREATEST(1, LEAST(p_limit, 50))
  );
END;
$outer$;

COMMENT ON FUNCTION fallback_kepco_nearest(text, numeric, int) IS
  '같은 마을(bjd_code) 내에서 타겟 지번 정규화 숫자에 거리가 가장 가까운 top N row. EXECUTE 동적 SQL 로 RPC plan caching 함정 회피. 호출자: /api/capa/by-pnu.';
