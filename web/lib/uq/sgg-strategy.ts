/**
 * VWorld lt_c_uq128 호출 전략 — 일반시/일반구 함정 대응.
 *
 * 검증 결과 (2026-05-02):
 *   - 천안/수원/창원 = 시 단위(44130)에만 등록, 일반구 호출 시 0건
 *   - 성남 분당구 = 시 단위 4건 + 분당구 단위 10건 (중복 X, 다른 데이터)
 *   - 일반 군/광역시 자치구 = 5자리 그대로 정상
 *   - VWorld sigg_name 라벨이 부정확한 행 존재 (예산군 케이스) → std_sggcd 만 신뢰
 *   - 응답에 자연취락지구 + 집단취락지구 혼재 → uname 필터 필요
 *
 * 전략:
 *   1. 일반시 일반구(5번째 자리 != 0) 검색 시:
 *      - 시 단위(시군구 4자리 + 0)
 *      - + 일반구 단위(원본 5자리)
 *      - 두 응답 합치고 mnum dedup
 *   2. 그 외 (일반 군/광역시 자치구):
 *      - 원본 5자리만 호출
 *
 * 호출 측이 그 시군구 마을(sigunguCode 5자리 prefix)과 매칭하면
 * 사용자가 검색한 영역만 카드에 노출됨.
 */

/**
 * 검색용 std_sggcd 후보 목록.
 *
 * @param sigunguCode 사용자가 선택한 시군구 5자리 (bjd_master 기준)
 * @returns 1~2개 시군구 코드 — 모두 호출해서 합쳐야 함
 */
export function getUqQuerySggCodes(sigunguCode: string): string[] {
  if (!/^\d{5}$/.test(sigunguCode)) return [];

  // 5번째 자리가 0 = 일반 군/광역시 자치구/일반시 자체 → 그대로
  if (sigunguCode[4] === "0") return [sigunguCode];

  // 일반시 일반구 → 시 단위 + 구 단위 둘 다
  const cityCode = sigunguCode.slice(0, 4) + "0";
  return [cityCode, sigunguCode];
}
