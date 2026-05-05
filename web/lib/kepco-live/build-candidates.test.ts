/**
 * buildKepcoCandidates 단위 테스트.
 *
 * 빈값 채움 규칙 (의뢰자 KEPCO 캡처 6건+DB 검증, 2026-05-05):
 *   si=-기타지역 / gu=-기타지역 / li='' / lidong 빈값 없음 / 세종 si=do
 * 상세: .claude/memory/reference_kepco_field_rules.md
 *
 * 검증 출처: scripts/test_kepco_address_lookup/verify_full.py 매트릭스 +
 * verify_extra (효자동1가/2가/3가 매칭).
 */

import { describe, it, expect } from "vitest";
import { parseKoreanAddress } from "./parse-address";
import { buildKepcoCandidates } from "./build-candidates";

describe("buildKepcoCandidates — 도-군 (양평)", () => {
  const parsed = parseKoreanAddress("경기도 양평군 청운면 갈운리 24-1");
  const cands = buildKepcoCandidates(parsed);

  it("후보 2개 (1차 + si='' fallback)", () => {
    expect(cands).toHaveLength(2);
  });

  it("1차: si='-기타지역', gu='양평군'", () => {
    expect(cands[0]).toMatchObject({
      do: "경기도", si: "-기타지역", gu: "양평군",
      lidong: "청운면", li: "갈운리",
    });
  });

  it("2차 fallback: si=''", () => {
    expect(cands[1]).toMatchObject({
      do: "경기도", si: "", gu: "양평군",
    });
  });
});

describe("buildKepcoCandidates — 정규 도-시-구-동 (충북 청주)", () => {
  const parsed = parseKoreanAddress("충청북도 청주시 흥덕구 가경동 1502");
  const cands = buildKepcoCandidates(parsed);

  it("후보 1개 (sep_2/sep_3 둘 다 채워짐 → fallback 불필요)", () => {
    expect(cands).toHaveLength(1);
  });

  it("1차: si='청주시', gu='흥덕구'", () => {
    expect(cands[0]).toMatchObject({
      do: "충청북도", si: "청주시", gu: "흥덕구",
      lidong: "가경동", li: "",
    });
  });
});

describe("buildKepcoCandidates — 광역시 자치구 (서울 강남)", () => {
  const parsed = parseKoreanAddress("서울특별시 강남구 역삼동 736");
  const cands = buildKepcoCandidates(parsed);

  it("후보 2개 (sep_3=강남구 있으므로 si fallback 만)", () => {
    expect(cands).toHaveLength(2);
  });

  it("1차: si='-기타지역', gu='강남구'", () => {
    expect(cands[0]).toMatchObject({
      do: "서울특별시", si: "-기타지역", gu: "강남구",
      lidong: "역삼동",
    });
  });

  it("2차 fallback: si=''", () => {
    expect(cands[1].si).toBe("");
  });
});

describe("buildKepcoCandidates — 도-시-동 (구 없는 시, gu→-기타지역)", () => {
  // 회귀 방지: 군산/목포/경주/김해 등. 픽스 전 verify_full.py 에서 0건 그룹.
  // 의뢰자 KEPCO 캡처 (경상남도/김해시/-기타지역/외동/'') 정답 일치.
  const parsed = parseKoreanAddress("경상남도 김해시 외동 1107-5");
  const cands = buildKepcoCandidates(parsed);

  it("후보 2개 (1차 + gu='' fallback)", () => {
    expect(cands).toHaveLength(2);
  });

  it("1차: si='김해시', gu='-기타지역', li=''", () => {
    expect(cands[0]).toMatchObject({
      do: "경상남도", si: "김해시", gu: "-기타지역",
      lidong: "외동", li: "",
    });
  });

  it("2차 fallback: gu=''", () => {
    expect(cands[1]).toMatchObject({
      do: "경상남도", si: "김해시", gu: "",
      lidong: "외동", li: "",
    });
  });
});

describe("buildKepcoCandidates — 도-시-동 (전북 군산)", () => {
  const parsed = parseKoreanAddress("전북특별자치도 군산시 수송동 1");
  const cands = buildKepcoCandidates(parsed);

  it("1차: gu='-기타지역' (sep_3 빈값 → 채움)", () => {
    expect(cands[0]).toMatchObject({
      do: "전북특별자치도", si: "군산시", gu: "-기타지역",
      lidong: "수송동", li: "",
    });
  });
});

describe("buildKepcoCandidates — 도-시-동 (강원 춘천)", () => {
  const parsed = parseKoreanAddress("강원특별자치도 춘천시 효자동 100");
  const cands = buildKepcoCandidates(parsed);

  it("후보 2개 (1차 + gu='' fallback)", () => {
    expect(cands).toHaveLength(2);
  });

  it("1차: gu='-기타지역', lidong='효자동'", () => {
    expect(cands[0]).toMatchObject({
      do: "강원특별자치도", si: "춘천시", gu: "-기타지역",
      lidong: "효자동", li: "",
    });
  });
});

describe("buildKepcoCandidates — 광역시 산하 일반시 (KEPCO 분류, 부산 양산)", () => {
  // 의뢰자 캡처: KEPCO 가 양산시를 부산광역시 산하로 분류함 (행안부와 다름).
  // bjd_master 가 '경상남도 양산시' 로 저장하므로 이 매핑은 별도 이슈.
  // 본 테스트는 후보 생성 룰 자체 검증만 — sep_3 빈값 → -기타지역.
  const parsed = parseKoreanAddress("경상남도 양산시 덕계동 805-3");
  const cands = buildKepcoCandidates(parsed);

  it("1차: gu='-기타지역'", () => {
    expect(cands[0]).toMatchObject({
      do: "경상남도", si: "양산시", gu: "-기타지역",
      lidong: "덕계동", li: "",
    });
  });
});

describe("buildKepcoCandidates — 세종 (sep_2/sep_3 None, li 있음)", () => {
  const parsed = parseKoreanAddress("세종특별자치시 조치원읍 신흥리 1");
  const cands = buildKepcoCandidates(parsed);

  it("후보 4개 (1차 + si='' fallback + 세종 si=do + 세종 li='')", () => {
    expect(cands).toHaveLength(4);
  });

  it("1차: si='-기타지역', gu='-기타지역'", () => {
    expect(cands[0]).toMatchObject({
      do: "세종특별자치시", si: "-기타지역", gu: "-기타지역",
      lidong: "조치원읍", li: "신흥리",
    });
  });

  it("3차: 세종 si=do, gu='-기타지역' (KEPCO 정답)", () => {
    // 의뢰자 캡처: do=세종특별자치시 / si=세종특별자치시 / gu=-기타지역 / lidong=한솔동 / li=''
    expect(cands[2]).toMatchObject({
      do: "세종특별자치시", si: "세종특별자치시", gu: "-기타지역",
      lidong: "조치원읍", li: "신흥리",
    });
  });

  it("4차: 세종 si=do + li=''", () => {
    expect(cands[3]).toMatchObject({
      do: "세종특별자치시", si: "세종특별자치시", gu: "-기타지역",
      lidong: "조치원읍", li: "",
    });
  });
});

describe("buildKepcoCandidates — 세종 li 없음 (si='' fallback 케이스)", () => {
  const parsed = parseKoreanAddress("세종특별자치시 한솔동 1");
  const cands = buildKepcoCandidates(parsed);

  it("후보 3개 (1차 + si='' fallback + 세종 si=do, li 없으니 5차 미생성)", () => {
    expect(cands).toHaveLength(3);
  });

  it("3차: 세종 si=do (의뢰자 캡처 정답과 일치)", () => {
    expect(cands[2]).toMatchObject({
      do: "세종특별자치시", si: "세종특별자치시", gu: "-기타지역",
      lidong: "한솔동", li: "",
    });
  });
});

describe("buildKepcoCandidates — 동분할 옵션 (효자동)", () => {
  const parsed = parseKoreanAddress("전북특별자치도 전주시 완산구 효자동 1");

  it("기본 호출: 동분할 후보 포함 안 함", () => {
    const cands = buildKepcoCandidates(parsed);
    expect(cands).toHaveLength(1);
    expect(cands[0].lidong).toBe("효자동");
  });

  it("includeSplitDong: 9개 변종 추가 (1가~5가, 1동~4동)", () => {
    const cands = buildKepcoCandidates(parsed, { includeSplitDong: true });
    expect(cands).toHaveLength(1 + 9);
    const variants = cands.slice(1).map((c) => c.lidong);
    expect(variants).toContain("효자동1가");
    expect(variants).toContain("효자동2가");
    expect(variants).toContain("효자동3가");
    expect(variants).toContain("효자1동");
    expect(variants).toContain("효자2동");
  });

  it("리가 있으면 동분할 후보 생성 안 함", () => {
    const withLi = parseKoreanAddress("경기도 양평군 청운면 갈운리 24-1");
    const cands = buildKepcoCandidates(withLi, { includeSplitDong: true });
    expect(cands).toHaveLength(2); // 동분할 추가 0
  });

  it("이미 분할된 동 (효자동1가) 입력은 추가 안 함", () => {
    const splitParsed = parseKoreanAddress("전북특별자치도 전주시 완산구 효자동1가 1");
    const cands = buildKepcoCandidates(splitParsed, { includeSplitDong: true });
    const splitCount = cands.filter((c) => c.reason.startsWith("split-dong")).length;
    expect(splitCount).toBe(0);
  });

  it("동분할 변종도 gu 빈값 → -기타지역 규칙 적용", () => {
    // 전주시 완산구는 sep_3 채워짐 → split 변종도 그 값 유지
    const cands = buildKepcoCandidates(parsed, { includeSplitDong: true });
    const splitOne = cands.find((c) => c.reason === "split-dong:효자동1가");
    expect(splitOne).toMatchObject({ gu: "완산구" });
  });
});

describe("buildKepcoCandidates — 광역시 자치군 (인천 강화군)", () => {
  const parsed = parseKoreanAddress("인천광역시 강화군 강화읍 갑곳리 1");
  const cands = buildKepcoCandidates(parsed);

  it("후보 2개 (sep_3=강화군 채워짐, si fallback 만)", () => {
    expect(cands).toHaveLength(2);
    expect(cands[0]).toMatchObject({
      si: "-기타지역", gu: "강화군", lidong: "강화읍", li: "갑곳리",
    });
  });
});

describe("buildKepcoCandidates — reason 디버그 라벨", () => {
  it("각 후보가 reason 필드 보유", () => {
    const parsed = parseKoreanAddress("세종특별자치시 조치원읍 신흥리 1");
    const cands = buildKepcoCandidates(parsed);
    for (const c of cands) {
      expect(c.reason).toBeTruthy();
    }
  });
});
