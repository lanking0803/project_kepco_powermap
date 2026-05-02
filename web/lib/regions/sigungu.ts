/**
 * 시군구 단위 행정구역 조회 (서버 lib).
 *
 * 출처: bjd_master 테이블 (행안부 법정동 코드 마스터, 월 1회 CSV 갱신).
 * 응답: 한국 전체 시군구 약 250건. 시도/시군구 표기 + bjd_code 앞 5자리.
 *
 * 캐시 전략:
 *   - 서버 lib 자체는 매 호출 DB 조회 (간단). 부담은 atomic endpoint 의
 *     CDN 30일 캐시가 흡수.
 *
 * 표기 규칙 (한국 행정구역):
 *   - 광역시 자치구       : sep_2=null, sep_3="강남구"     → 표시 "강남구"
 *   - 일반 군             : sep_2=null, sep_3="곡성군"     → 표시 "곡성군"
 *   - 일반시 일반구       : sep_2="수원시", sep_3="권선구" → 표시 "수원시 권선구"
 */
import { createAdminClient } from "@/lib/supabase/admin";

export interface SigunguEntry {
  /** sep_1 — 시도 한글 (예: "전라남도") */
  sido: string;
  /** sep_2 — 일반시 한글 또는 null (예: "수원시" / null) */
  si: string | null;
  /** sep_3 — 자치구/행정구/군 한글 (예: "강남구" / "곡성군") */
  gu: string;
  /** bjd_code 앞 5자리 — VWorld lt_c_uq128 의 std_sggcd, API 호출 키 */
  code: string;
}

interface BjdMasterRow {
  bjd_code: string;
  sep_1: string;
  sep_2: string | null;
  sep_3: string | null;
}

/**
 * bjd_master 에서 시군구 단위 unique 행을 가져온다.
 *
 * 시군구는 bjd_code 끝 5자리가 모두 0 인 행이 대표 (예: 46720_00000).
 * 안전을 위해 sep_3 NOT NULL 도 동시 조건.
 */
export async function listSigungus(): Promise<SigunguEntry[]> {
  const supabase = createAdminClient();

  // bjd_code 끝 5자리가 00000 = 시군구 대표 행 (읍면동/리 NULL)
  const { data, error } = await supabase
    .from("bjd_master")
    .select("bjd_code, sep_1, sep_2, sep_3")
    .like("bjd_code", "_____00000")
    .not("sep_3", "is", null)
    .order("sep_1")
    .order("sep_2")
    .order("sep_3");

  if (error) {
    console.error("[regions/sigungu] bjd_master 조회 실패", error);
    return [];
  }

  const rows = (data ?? []) as BjdMasterRow[];
  return rows
    .filter((r) => r.sep_3 !== null)
    .map((r) => ({
      sido: r.sep_1,
      si: r.sep_2,
      gu: r.sep_3 as string,
      code: r.bjd_code.slice(0, 5),
    }));
}
