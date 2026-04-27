import { describe, it, expect } from "vitest";
import {
  calcAnnualGeneration,
  calcAnnualLoanPayment,
  calcFinance,
  calcMonthlyPayment,
  calcPaybackYears,
  DEFAULT_FINANCE_INPUT,
  getRepayMonths,
  type FinanceInput,
} from "./finance";

/**
 * 봉남리 268kW PDF 검증.
 * 일4h · SMP 121 · REC 72 · 가중1.5 · 유지보수 3% · 열화 0.4%
 * 공사비 348,400,000 · 부가세 10% → 총사업비 383,240,000
 * 시나리오: 자기자본 (대출 0)
 */
const BONGNAM_INPUT: FinanceInput = {
  ...DEFAULT_FINANCE_INPUT,
  capacityKw: 268,
  constructionCost: 348_400_000,
  scenario: "자기자본",
  loanPrincipal: 0,
};

describe("calcAnnualGeneration", () => {
  it("봉남리 1년차 = 391,280 kWh", () => {
    const kwh = calcAnnualGeneration(268, 4, 0.004, 1);
    expect(kwh).toBeCloseTo(391_280, 0);
  });

  it("2년차 = 1년차 × 0.996 ≈ 389,715", () => {
    const kwh = calcAnnualGeneration(268, 4, 0.004, 2);
    expect(Math.round(kwh)).toBe(389_715);
  });

  it("20년차 ≈ 362,589", () => {
    const kwh = calcAnnualGeneration(268, 4, 0.004, 20);
    expect(Math.round(kwh)).toBe(362_589);
  });

  it("용량 0 → 0", () => {
    expect(calcAnnualGeneration(0, 4, 0.004, 1)).toBe(0);
  });
});

describe("calcMonthlyPayment", () => {
  it("원금 0 → 0", () => {
    expect(calcMonthlyPayment(0, 0.055, 120)).toBe(0);
  });

  it("금리 0 → 단순 분할 (1억 / 120개월 = 약 833,333)", () => {
    expect(calcMonthlyPayment(100_000_000, 0, 120)).toBeCloseTo(833_333, 0);
  });

  it("1억 · 5.5% · 120개월 = 약 1,085,263원/월 (표준 원리금균등)", () => {
    const m = calcMonthlyPayment(100_000_000, 0.055, 120);
    expect(Math.round(m)).toBe(1_085_263);
  });
});

describe("getRepayMonths", () => {
  it("자기자본 = 0", () => {
    expect(getRepayMonths("자기자본")).toBe(0);
  });
  it("10년 = 120", () => {
    expect(getRepayMonths("10년")).toBe(120);
  });
  it("20년 = 240", () => {
    expect(getRepayMonths("20년")).toBe(240);
  });
});

describe("calcFinance — 봉남리 268kW 자기자본 시나리오", () => {
  const result = calcFinance(BONGNAM_INPUT);
  const r1 = result.rows[0];
  const r20 = result.rows[19];

  it("총사업비 = 공사비 + 부가세 10% = 383,240,000", () => {
    expect(result.constructionCost).toBe(348_400_000);
    expect(result.vat).toBe(34_840_000);
    expect(result.totalCost).toBe(383_240_000);
  });

  it("1년차 발전량 391,280 kWh", () => {
    expect(Math.round(r1.generationKwh)).toBe(391_280);
  });

  it("1년차 SMP 매출 47,344,880", () => {
    expect(Math.round(r1.smpIncome)).toBe(47_344_880);
  });

  it("1년차 REC 매출 42,258,240 (가중치 1.5)", () => {
    expect(Math.round(r1.recIncome)).toBe(42_258_240);
  });

  it("1년차 총매출 89,603,120", () => {
    expect(Math.round(r1.totalIncome)).toBe(89_603_120);
  });

  it("1년차 유지보수 = 매출의 3% = 2,688,094", () => {
    expect(Math.round(r1.maintenance)).toBe(2_688_094);
  });

  it("1년차 순수익 86,915,026", () => {
    expect(Math.round(r1.netIncome)).toBe(86_915_026);
  });

  it("20년차 순수익 80,541,979", () => {
    expect(Math.round(r20.netIncome)).toBe(80_541_979);
  });

  it("20년 누적 순수익 1,673,803,829", () => {
    expect(Math.round(r20.cumulativeNet)).toBe(1_673_803_829);
  });

  it("ROI = 1년차 순수익 / 총사업비 ≈ 22.7%", () => {
    expect(result.roi).toBeCloseTo(0.2268, 3);
  });

  it("손익분기점 ≈ 4.4년", () => {
    expect(result.paybackYears).not.toBeNull();
    expect(result.paybackYears!).toBeCloseTo(4.44, 1);
  });

  it("자기자본 시나리오 → 모든 행 loanPayment = 0", () => {
    for (const r of result.rows) {
      expect(r.loanPayment).toBe(0);
    }
  });

  it("자기자본 시나리오 → 누적(대출후) = 누적(무대출)", () => {
    expect(result.totalAfterLoan).toBeCloseTo(result.totalNetIncome, 0);
  });
});

describe("calcAnnualLoanPayment — 대출 케이스", () => {
  it("대출 0 → 0", () => {
    expect(
      calcAnnualLoanPayment(0, 0.055, 12, 120, 20),
    ).toBe(0);
  });

  it("1억 · 5.5% · 거치 12개월 · 상환 120개월 · 분석 20년 → 양수", () => {
    const annual = calcAnnualLoanPayment(
      100_000_000,
      0.055,
      12,
      120,
      20,
    );
    expect(annual).toBeGreaterThan(0);
    // 거치 1년 이자 + 10년 원리금균등 총합 / 20년
    // = (550만 + 월상환 1,085,263 × 120) / 20 ≈ 6,786,577
    expect(Math.round(annual)).toBe(6_786_577);
  });
});

describe("calcFinance — 10년 대출 시나리오", () => {
  const input: FinanceInput = {
    ...BONGNAM_INPUT,
    scenario: "10년",
    loanPrincipal: 100_000_000,
  };
  const result = calcFinance(input);

  it("모든 연차 loanPayment 동일 (평균값)", () => {
    const first = result.rows[0].loanPayment;
    expect(first).toBeGreaterThan(0);
    for (const r of result.rows) {
      expect(r.loanPayment).toBeCloseTo(first, 0);
    }
  });

  it("netAfterLoan = netIncome - loanPayment", () => {
    for (const r of result.rows) {
      expect(r.netAfterLoan).toBeCloseTo(r.netIncome - r.loanPayment, 0);
    }
  });

  it("대출후 20년 총수익 < 무대출 (이자만큼 줄어듦)", () => {
    expect(result.totalAfterLoan).toBeLessThan(result.totalNetIncome);
  });
});

describe("calcPaybackYears", () => {
  it("총사업비 0 → 0", () => {
    expect(calcPaybackYears([], 0)).toBe(0);
  });

  it("누적이 절대 못 넘으면 null", () => {
    const rows = [
      {
        year: 1,
        generationKwh: 0,
        smpIncome: 0,
        recIncome: 0,
        totalIncome: 0,
        maintenance: 0,
        netIncome: 0,
        cumulativeNet: 0,
        loanPayment: 0,
        netAfterLoan: 0,
        cumulativeAfterLoan: 0,
      },
    ];
    expect(calcPaybackYears(rows, 1_000)).toBeNull();
  });
});
