/**
 * ParsedAddress → KEPCO API 호출 후보 N개.
 *
 * 빈값 채움 규칙 (자리마다 다름, 의뢰자 KEPCO 사이트 캡처 6건+DB 검증으로 확정):
 *   - si  (sep_2) 빈값 → '-기타지역'
 *   - gu  (sep_3) 빈값 → '-기타지역'
 *   - li  (sep_5) 빈값 → '' (빈문자열, 채우면 안 됨)
 *   - lidong (sep_4) 빈값 케이스 = DB 메타 행 한정 → 발생 안 함
 *   - 세종 예외: sep_2 빈값 → si=do (세종특별자치시)
 *
 * 1차 후보 = KEPCO 콤보 기본 동작과 동일한 정답.
 * 2~5차 후보 = 비일관 응답·세종 변형 대비 fallback (첫 비어있지 않은 결과 채택).
 *
 * 상세 규칙·캡처: .claude/memory/reference_kepco_field_rules.md
 * 검증 도구: scripts/test_kepco_address_lookup/verify_full.py (33 케이스)
 */

import type { ParsedAddress } from "./parse-address";

export interface KepcoCandidate {
  do: string;
  si: string;
  gu: string;
  lidong: string;
  li: string;
  reason: string; // 디버그/로그용 — 어떤 룰로 만들어진 후보인지
}

const SKIP_VALUE = "-기타지역";

// 동분할 후보 — 사용자 입력 '효자동' → '효자동N가' 또는 '효자N동'
// (검증: 전북 전주 완산구 효자동 → 효자동1가/2가/3가 매칭)
const SPLIT_DONG_GA = ["1가", "2가", "3가", "4가", "5가"];
const SPLIT_DONG_NUM = ["1동", "2동", "3동", "4동"];

function makeBaseCandidates(parsed: ParsedAddress): KepcoCandidate[] {
  const do_ = parsed.sep_1 ?? "";
  const sep2 = parsed.sep_2 ?? "";
  const sep3 = parsed.sep_3 ?? "";
  const lidong = parsed.sep_4 ?? "";
  const li = parsed.sep_5 ?? "";

  // 빈값 채움 규칙 (의뢰자 KEPCO 캡처 6건+DB 검증, 2026-05-05):
  //   si (sep_2)  빈값 → '-기타지역'
  //   gu (sep_3)  빈값 → '-기타지역'
  //   li (sep_5)  빈값 → '' (빈문자열, 채우면 안 됨)
  //   lidong (sep_4) 은 빈값 케이스 자체가 없음 (DB sep_4 NULL=메타 행 한정)
  // 상세: .claude/memory/reference_kepco_field_rules.md
  const si1 = sep2 || SKIP_VALUE;
  const gu1 = sep3 || SKIP_VALUE;

  const candidates: KepcoCandidate[] = [];

  // 1차: 정답 후보 (KEPCO 콤보 기본 동작과 일치)
  candidates.push({
    do: do_, si: si1, gu: gu1, lidong, li,
    reason: sep2 && sep3 ? "primary"
      : !sep2 && !sep3 ? "primary (si/gu both → -기타지역)"
      : !sep2 ? "primary (si → -기타지역)"
      : "primary (gu → -기타지역)",
  });

  // 2차 fallback: si='-기타지역' 이면 si='' 도 시도 (구버전 호환 + 일부 비일관 응답 대응)
  if (si1 === SKIP_VALUE) {
    candidates.push({
      do: do_, si: "", gu: gu1, lidong, li,
      reason: "fallback: si=empty",
    });
  }

  // 3차 fallback: gu='-기타지역' 이면 gu='' 도 시도 (구버전 호환)
  if (gu1 === SKIP_VALUE && si1 !== SKIP_VALUE) {
    candidates.push({
      do: do_, si: si1, gu: "", lidong, li,
      reason: "fallback: gu=empty",
    });
  }

  // 4차: 세종 예외 — sep_2/sep_3 모두 없을 때 si=do
  // (검증: '세종특별자치시 / 세종특별자치시 / -기타지역 / 한솔동' 정답 캡처)
  if (!sep2 && !sep3) {
    candidates.push({
      do: do_, si: do_, gu: SKIP_VALUE, lidong, li,
      reason: "sejong: si=do, gu=-기타지역",
    });
    // 5차: 세종 + li='' (세종은 일부 동에서 li='' 가 더 잘 잡힘, 검증)
    if (li) {
      candidates.push({
        do: do_, si: do_, gu: SKIP_VALUE, lidong, li: "",
        reason: "sejong: si=do + empty li",
      });
    }
  }

  return candidates;
}

function expandSplitDongCandidates(parsed: ParsedAddress): KepcoCandidate[] {
  const lidong = parsed.sep_4;
  if (!lidong) return [];
  if (parsed.sep_5) return []; // 리가 있으면 동분할 의미 없음
  // 이미 분할된 형태 (효자동1가, 둔산1동 등) 면 skip
  if (/\d/.test(lidong)) return [];

  const do_ = parsed.sep_1 ?? "";
  const sep2 = parsed.sep_2 ?? "";
  const sep3 = parsed.sep_3 ?? "";
  const si = sep2 || SKIP_VALUE;
  const gu = sep3 || SKIP_VALUE;

  // ~동 → ~동N가 (효자동 → 효자동1가)
  // ~동 → ~N동 (효자동 → 효자1동)
  const stem = lidong.endsWith("동") ? lidong.slice(0, -1) : lidong;
  const variants: string[] = [];
  for (const s of SPLIT_DONG_GA) variants.push(`${lidong}${s}`);
  for (const s of SPLIT_DONG_NUM) variants.push(`${stem}${s}`);

  return variants.map((v): KepcoCandidate => ({
    do: do_, si, gu, lidong: v, li: "",
    reason: `split-dong:${v}`,
  }));
}

export interface BuildOpts {
  /** 동분할 변종 후보 추가 (효자동 → 효자동1가/2가/3가 등). 1차 0건 시에만 의미 있음. */
  includeSplitDong?: boolean;
}

export function buildKepcoCandidates(
  parsed: ParsedAddress,
  opts?: BuildOpts,
): KepcoCandidate[] {
  const base = makeBaseCandidates(parsed);
  if (!opts?.includeSplitDong) return base;
  return [...base, ...expandSplitDongCandidates(parsed)];
}
