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
 * 표기 규칙 (label = sep_2 + sep_3 trim, 4가지 케이스):
 *   - 광역시 자치구   : sep_2=null,  sep_3="강남구"  → "강남구"
 *   - 일반 군         : sep_2=null,  sep_3="곡성군"  → "곡성군"
 *   - 일반시 자체     : sep_2="여수시", sep_3=null   → "여수시"
 *   - 일반시 일반구   : sep_2="수원시", sep_3="권선구" → "수원시 권선구"
 *
 * 캠코 OnbidRlstListSrvc2 검증 결과 (2026-05-03):
 *   - "여수시" 단독 = 55건, "수원시" 단독 = 367건 (구 매물 포함 합산), "수원시 권선구" 통합 = 28건
 *   - "권선구" 단독은 0건 → 일반구는 반드시 "시 구" 통합 표기여야 함
 */
import { createAdminClient } from "@/lib/supabase/admin";

export interface SigunguEntry {
  /** sep_1 — 시도 한글 (예: "전라남도") */
  sido: string;
  /** sep_2 — 일반시 한글 또는 null (예: "수원시" / null) */
  si: string | null;
  /** sep_3 — 자치구/행정구/군 한글 또는 null (예: "강남구" / null) */
  gu: string | null;
  /** UI 표시 + 캠코 API lctnSggnm 송신 통합값. sep_2 + sep_3 trim. */
  label: string;
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
 * 시군구는 bjd_code 끝 5자리가 모두 0 인 행이 대표 (예: 4613000000).
 * sep_2/sep_3 둘 다 null 인 행(세종 시도 자체 대표)은 시군구가 아니므로 제외.
 */
export async function listSigungus(): Promise<SigunguEntry[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("bjd_master")
    .select("bjd_code, sep_1, sep_2, sep_3")
    .like("bjd_code", "_____00000")
    .order("sep_1")
    .order("sep_2", { nullsFirst: true })
    .order("sep_3", { nullsFirst: true });

  if (error) {
    console.error("[regions/sigungu] bjd_master 조회 실패", error);
    return [];
  }

  const rows = (data ?? []) as BjdMasterRow[];
  return rows
    .map((r) => {
      const label = `${r.sep_2 ?? ""} ${r.sep_3 ?? ""}`.trim();
      return {
        sido: r.sep_1,
        si: r.sep_2,
        gu: r.sep_3,
        label,
        code: r.bjd_code.slice(0, 5),
      };
    })
    .filter((e) => e.label !== "");
}
