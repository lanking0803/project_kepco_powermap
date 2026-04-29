/**
 * 캠코 매물의 PNU 보정 — 매물명 + bjd_code 로 표준 PNU 재구성.
 *
 * ⚠️ 캠코 ltnoPnu 의 산구분 표기 이상
 * ----------------------------------
 * 행안부 표준 PNU = bjd_code(10) + 산구분(1) + 본번(4) + 부번(4)
 *   산구분: 1=일반, 2=산
 *
 * 캠코 ltnoPnu 는 11번째 자리(산구분)가 다음과 같이 들어옴 (실측, 500건 샘플):
 *   - 일반 토지 → "0" (88.6%)  ← 표준 위반
 *   - 산 토지   → "1" (11.2%)  ← 표준의 "일반" 자리에 산을 넣음
 *
 * 즉 캠코는 산구분이 아니라 "산플래그(0=일반/1=산)" 로 사용 중.
 * 결과: VWorld(표준 사용)에 그대로 보내면 0% 매칭 (500건 0% 검증).
 *
 * ✅ 해결: 캠코 ltnoPnu 앞 10자리만 신뢰 (bjd_code 는 행안부 표준)
 *         + 매물명(onbidCltrNm)에서 지번 텍스트 추출
 *         + 우리 표준 빌더(buildPnuFromBjdAndJibun)로 재구성
 *         → 100% 매칭 확인 (산/일반 모두)
 *
 * 검증 스크립트: scripts/test-onbid-pnu-validity.ts
 */

import { buildPnuFromBjdAndJibun } from "@/lib/geo/pnu";

/** 매물명 정규식 — 첫 번째 지번 (산X-Y / X-Y / X) 추출. */
const JIBUN_RE = /(산\s*)?(\d+(?:-\d+)?)/;

/**
 * 캠코 매물(목록/상세 raw 모두 호환) → 행안부 표준 PNU 19자리.
 * 추출 실패 시 null (호출 측이 fallback 결정).
 *
 * 입력 예시:
 *   - "광주광역시 서구 농성동 391-15"           → bjd+1+0391+0015
 *   - "경기도 성남시 분당구 율동 산69-1"        → bjd+2+0069+0001
 *   - "경기도 안양시 만안구 안양동 435-1 1401"  → bjd+1+0435+0001 (첫 지번)
 *   - "충청남도 당진시 송악읍 가학리 302"       → bjd+1+0302+0000
 */
export function pnuFromOnbidItem(item: {
  ltnoPnu?: string | null;
  onbidCltrNm?: string | null;
}): string | null {
  const ltno = item.ltnoPnu ?? "";
  if (!/^\d{19}$/.test(ltno)) return null;
  const bjdCode = ltno.slice(0, 10);

  const nm = item.onbidCltrNm ?? "";
  const m = nm.match(JIBUN_RE);
  if (!m) return null;
  const isSan = !!m[1];
  const num = m[2];
  return buildPnuFromBjdAndJibun(bjdCode, (isSan ? "산" : "") + num);
}
