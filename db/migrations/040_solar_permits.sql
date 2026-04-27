-- ══════════════════════════════════════════════
-- 040: solar_permits — 전국 태양광 발전소 전기사업 허가 정보
-- ══════════════════════════════════════════════
-- 배경:
--   data.go.kr `tn_pubr_public_solar_gen_flct_api` (NIA, 데이터ID 15107742)
--   전국 태양광 발전소 자료를 매월 1회 적재.
--
--   외부 API 한계 (검증 완료, 2026-04-26~27):
--     - 검색 필터 미지원 → 전수 페이지네이션만 가능
--     - 안정 PK 미제공 → 매월 TRUNCATE + INSERT 정책 채택
--     - 도로명만 있는 행 ~25% 는 영업 활용 불가 → 적재 시 skip
--     - 좌표 보유율 ~47% → 보너스 정보로만 저장
--
-- 적재 정책 (의뢰자 합의 2026-04-27):
--   - 지번주소 + 진짜 번지(숫자) 있는 행만 적재 (전체 ~75%, 약 9만 건)
--   - 우리 시스템에서 지번 → PNU 19자리 자체 조립
--     (bjd_master 룩업 + 본번/부번/산여부 파싱)
--   - 매월 1일 03:00 KST GitHub Actions cron (수동 dispatch 도 가능)
--
-- 영업 활용:
--   - 매물 클릭 → 같은 필지(PNU) 발전소 / 같은 동·리(bjd_code) 통계
--
-- 단순화 결정 (이전 시도에서 폐기한 것들):
--   - PostGIS / GIST 인덱스 X — 좌표 검색 미사용
--   - fingerprint SHA1 PK X — TRUNCATE + INSERT 라 불필요
--   - solar_permits_runs 모니터링 테이블 X — GH Actions 로그로 충분
-- ══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS solar_permits (
  id                BIGSERIAL PRIMARY KEY,

  -- 우리가 조립한 키 (한 필지에 여러 발전소 가능 → UNIQUE 아닌 인덱스만)
  pnu               CHAR(19) NOT NULL,
  bjd_code          CHAR(10) NOT NULL,

  -- 발전소 정보 (외부 API 가 100% 채움)
  facility_name     TEXT NOT NULL,
  capacity_kw       NUMERIC,
  operating_status  TEXT,
  permit_date       DATE,

  -- 좌표 (외부 API 가 ~47% 만 채움 — 보너스)
  lat               DOUBLE PRECISION,
  lng               DOUBLE PRECISION,

  -- 디버그/감사용 원본 지번주소
  raw_addr          TEXT,

  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 인덱스 (조회 패턴 2가지)
-- ─────────────────────────────────────────────

-- 같은 필지 검색 (매물 클릭 시 정확 매칭)
CREATE INDEX IF NOT EXISTS idx_solar_permits_pnu
  ON solar_permits (pnu);

-- 같은 동/리 통계 (매물 클릭 시 보너스 정보)
CREATE INDEX IF NOT EXISTS idx_solar_permits_bjd
  ON solar_permits (bjd_code);

-- ─────────────────────────────────────────────
-- 권한
-- ─────────────────────────────────────────────

GRANT SELECT ON solar_permits TO authenticated;
REVOKE ALL   ON solar_permits FROM anon;

COMMENT ON TABLE solar_permits IS
  '전국 태양광 발전소 전기사업 허가 정보 (data.go.kr NIA 15107742). 매월 1일 03:00 KST TRUNCATE+INSERT 동기화. 2026-04-27 도입.';

COMMENT ON COLUMN solar_permits.pnu IS
  '필지 식별자 19자리 (bjd_code 10 + 산여부 1 + 본번 4 + 부번 4). 외부 API 가 직접 미제공 → 우리가 지번주소에서 조립.';
COMMENT ON COLUMN solar_permits.bjd_code IS
  'pnu 앞 10자리 = 법정동코드. 같은 동/리 통계 인덱스용.';
COMMENT ON COLUMN solar_permits.raw_addr IS
  '원본 지번주소 (외부 API 의 lctnLotnoAddr). PNU 조립 검증/디버그용.';
