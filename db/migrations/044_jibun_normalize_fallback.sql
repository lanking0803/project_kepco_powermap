-- ══════════════════════════════════════════════
-- 044: 지번 정규화 + 같은 마을 fallback (전기용량 정보 미매칭 대응)
-- ══════════════════════════════════════════════
-- 배경 (2026-05-01):
--   ParcelInfoPanel [전기] 탭에서 사용자가 클릭한 지번이 kepco_capa 에 없을 때
--   "이 지번에 매칭된 KEPCO 용량 정보가 없습니다" 만 떠서 영업 임팩트 0.
--   의뢰자 요청 = 같은 마을 내에서 가장 가까운 본번 N개 정보 표시.
--
-- 설계:
--   1) jibun_to_num — 지번 텍스트 → 숫자 정규화 유틸
--      "1072"   → 1072
--      "1072-3" → 1072.3
--      "산12-4" → 12.4   (산 무시)
--      "1072의1" → 1072.1
--      "1072전" → 1072   (지목 무시)
--   2) fallback_kepco_nearest — RPC entry point
--      bjd_code 로 같은 마을 좁히고 jibun_to_num 거리로 정렬, top 10 반환
--
-- RPC plan caching 함정 회피:
--   WHERE 절은 단순 equality (bjd_code = ?) → 인덱스 정상 활용.
--   표현식은 ORDER BY 에만 위치. fallback 호출이 같은 bjd_code 안 5~30 row 만
--   추려서 그 위에서 표현식 정렬이라 ms 단위.
--   참고: .claude/memory/reference_supabase_rpc_plan_trap.md
--
-- 발동 조건: route.ts 에서 exact 매칭 0건일 때만 호출. 정상 매칭은 추가 부담 0.
-- ══════════════════════════════════════════════


-- ──────────────────────────────────────────────
-- 1) jibun_to_num — 정규화 유틸
-- ──────────────────────────────────────────────
-- 규칙:
--   '-' 와 '의' → '.'
--   비숫자/비점 문자 모두 삭제
--   결과 빈 문자열이면 NULL
--   결과가 numeric 캐스팅 불가하면 NULL (예: ".", "..")
CREATE OR REPLACE FUNCTION jibun_to_num(addr text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  WITH cleaned AS (
    SELECT regexp_replace(
      replace(replace(coalesce(addr, ''), '-', '.'), '의', '.'),
      '[^\d.]', '', 'g'
    ) AS s
  )
  SELECT
    CASE
      WHEN s = '' OR s IS NULL THEN NULL
      WHEN s !~ '^\.?\d' THEN NULL
      ELSE
        -- "1072.3.4" 같이 점이 여러 개면 첫 점 까지만 사용
        CAST(
          (regexp_match(s, '^(\d+(?:\.\d+)?)'))[1]
          AS numeric
        )
    END
  FROM cleaned;
$$;

COMMENT ON FUNCTION jibun_to_num(text) IS
  '지번 텍스트 → 숫자 정규화. ''-''/''의''→''.'', 한글/특수문자 삭제. 같은 마을 fallback 정렬용.';


-- ──────────────────────────────────────────────
-- 2) fallback_kepco_nearest — RPC entry point
-- ──────────────────────────────────────────────
-- 입력: 마을(bjd_code) + 타겟 지번의 정규화된 숫자값
-- 출력: kepco_capa 의 top 10 row (정확히 같은 컬럼 구조)
-- 호출자: route.ts 의 exact 매칭 0건 분기에서 supabase.rpc()
CREATE OR REPLACE FUNCTION fallback_kepco_nearest(
  p_bjd_code text,
  p_target_num numeric,
  p_limit int DEFAULT 10
)
RETURNS SETOF kepco_capa
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT k.*
  FROM kepco_capa k
  WHERE k.bjd_code = p_bjd_code
    AND k.addr_jibun IS NOT NULL
    AND jibun_to_num(k.addr_jibun) IS NOT NULL
  ORDER BY abs(jibun_to_num(k.addr_jibun) - p_target_num) ASC,
           k.addr_jibun ASC   -- 거리 동률일 때 결정적 순서
  LIMIT GREATEST(1, LEAST(p_limit, 50));   -- 안전장치 1~50
$$;

COMMENT ON FUNCTION fallback_kepco_nearest(text, numeric, int) IS
  '같은 마을(bjd_code) 내에서 타겟 지번 정규화 숫자에 거리가 가장 가까운 top N row. exact 매칭 0건 fallback 용. 호출자: /api/capa/by-pnu.';


-- ══════════════════════════════════════════════
-- 검증 쿼리 (운영 적용 전 콘솔에서 한 번 실행해서 결과 확인)
-- ══════════════════════════════════════════════
-- ※ 아래는 DO 블록이 아니라 주석 — 실제 검증 시 Supabase SQL 콘솔에 복붙 실행

-- ── 검증 1: 정규화 케이스 일치 확인 (TS jibunToNumber 와 결과 같아야 함)
-- 기대값:
--   '1072'      → 1072
--   '1072-3'    → 1072.3
--   '1072-30'   → 1072.30 (= 1072.3 으로 취급되어도 OK)
--   '산12-4'    → 12.4
--   '산23'      → 23
--   '1072의1'   → 1072.1
--   '1072전'    → 1072
--   'B1072'     → 1072
--   '1072가'    → 1072
--   ''          → NULL
--   '산'        → NULL
/*
SELECT v, jibun_to_num(v) AS num
FROM (VALUES
  ('1072'),
  ('1072-3'),
  ('1072-30'),
  ('산12-4'),
  ('산23'),
  ('1072의1'),
  ('1072전'),
  ('B1072'),
  ('1072가'),
  (''),
  ('산'),
  (NULL)
) AS t(v);
*/


-- ── 검증 2: RPC 호출 — 의뢰자 마을 (단양군 적성면 상리) 의 1073 fallback
-- 사전: bjd_code 정확값 확인 필요. 의뢰자 화면 PNU 앞 10자리.
/*
-- 1073 (=1073.0) 기준 가장 가까운 10건
SELECT addr_jibun, jibun_to_num(addr_jibun) AS num,
       abs(jibun_to_num(addr_jibun) - 1073) AS dist,
       subst_nm, mtr_no, dl_nm
FROM fallback_kepco_nearest('4380034022', 1073, 10);

-- 산12-4 (=12.4) 기준
SELECT addr_jibun, jibun_to_num(addr_jibun) AS num,
       abs(jibun_to_num(addr_jibun) - 12.4) AS dist
FROM fallback_kepco_nearest('4380034022', 12.4, 10);
*/


-- ── 검증 3: 같은 마을 row 분포 (LIMIT 안전장치 50 이 적정한지 확인)
/*
-- 마을별 row 수 분포 — 도심은 100+ 일 수 있음. fallback 후보 풀로 적정한지 체크.
SELECT bjd_code, count(*) AS row_cnt
FROM kepco_capa
WHERE addr_jibun IS NOT NULL
GROUP BY bjd_code
ORDER BY row_cnt DESC
LIMIT 20;

-- 의뢰자 마을 row 수
SELECT count(*) FROM kepco_capa
WHERE bjd_code = '4380034022' AND addr_jibun IS NOT NULL;
*/


-- ── 검증 4: EXPLAIN ANALYZE — 인덱스 활용 + 실행 시간
-- bjd_code 인덱스가 정상 작동하는지 (RPC plan trap 확인)
/*
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM fallback_kepco_nearest('4380034022', 1073, 10);

-- 기대:
--   - bjd_code 인덱스 활용 (Index Scan on idx_capa_bjd_code 또는 유사)
--   - actual time < 5ms (같은 마을 row 수가 적은 경우)
--   - 도심 큰 마을이라도 < 50ms
-- 만약 Seq Scan 으로 풀스캔 → RPC plan trap 의심, 운영 적용 보류
*/


-- ── 검증 5: 정규화 예외 케이스 사전 점검 (전체 데이터에 정규화 NULL 비율)
/*
SELECT
  count(*) FILTER (WHERE addr_jibun IS NULL) AS jibun_null,
  count(*) FILTER (WHERE addr_jibun IS NOT NULL AND jibun_to_num(addr_jibun) IS NULL) AS num_null,
  count(*) FILTER (WHERE jibun_to_num(addr_jibun) IS NOT NULL) AS num_ok,
  count(*) AS total
FROM kepco_capa;

-- num_null 이 5% 이상이면 정규화 함수 보강 검토.
-- num_null 인 케이스 샘플:
SELECT DISTINCT addr_jibun
FROM kepco_capa
WHERE addr_jibun IS NOT NULL AND jibun_to_num(addr_jibun) IS NULL
LIMIT 50;
*/
