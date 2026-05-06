/**
 * 견적 모드 5단계 — 수지분석 계산 라이브러리.
 *
 * 봉남리 PDF 양식 그대로 (의뢰자 컨펌 2026-04-27).
 * 검증: 봉남리 268kW · 일4h · SMP 121 · REC 72 · 가중치 1.5
 *   1년차 발전량 391,280 kWh / SMP 47,344,880 / REC 42,258,240 / 순수익 86,915,026
 *   손익분기 4.4년 / 20년 총수익 1,673,803,829 / ROI 22.7%
 *
 * 시나리오 (의뢰자 명시):
 *   - 자기자본 100% — 대출 0
 *   - 10년 대출 — 거치 N개월 + 상환 120개월
 *   - 15년 대출 — 거치 N개월 + 상환 180개월
 *   - 20년 대출 — 거치 N개월 + 상환 240개월
 *
 * 상환액 표시 (의뢰자 컨펌 2026-05-06 — A안):
 *   - 거치기간 (1년차): 이자만 납부 (P × r × 12)
 *   - 상환기간: 원리금균등 (월상환액 × 12)
 *   - 상환 종료 이후: 0 (UI 에서는 '-' 로 표시)
 *   - 20년 대출(거치+상환=21년)은 분석기간 20년 초과분(마지막 1년치) 잘림
 *
 * 변수 디폴트 (모두 사용자 변경 가능, 봉남리 PDF 일치):
 *   - 일발전시간 4.0h · 열화율 0.4%/년 · 시스템효율 1.0 (봉남리 PDF 검증)
 *   - SMP 121원/kWh · REC 72원/kWh · 가중치 1.5 · 유지보수 매출의 3%
 *   - 대출 금리 5.5% · 거치 12개월
 *   - 부가세 10% (공사비 별도 가산)
 */

export type LoanScenario = "자기자본" | "10년" | "15년" | "20년";

export interface FinanceInput {
  /** 시설용량 kW */
  capacityKw: number;
  /** 일평균 유효 발전시간 (h) — 시스템 손실 내포 */
  dailyHours: number;
  /** 연 열화율 (예: 0.004 = 0.4%) */
  annualDecay: number;
  /** SMP 단가 (원/kWh) */
  smpPrice: number;
  /** REC 단가 (원/kWh) — 가중치 적용 전 */
  recPrice: number;
  /** REC 가중치 */
  recWeight: number;
  /** 유지보수율 (예: 0.03 = 매출의 3%) */
  maintenanceRate: number;
  /** 공사비 (원, 부가세 별도) — 2단계 시공비 합계 */
  constructionCost: number;
  /** 부가세율 (예: 0.10) */
  vatRate: number;
  /** 시나리오 */
  scenario: LoanScenario;
  /** 대출액 (원) — 시나리오 = "자기자본" 이면 0 */
  loanPrincipal: number;
  /** 대출 연이율 (예: 0.055 = 5.5%) */
  loanRate: number;
  /** 거치기간 (개월) — 이 기간 동안은 이자만 납부 */
  graceMonths: number;
  /** 분석 기간 (년) — 봉남리 = 20 */
  years: number;
}

export interface YearRow {
  /** 연차 (1~years) */
  year: number;
  /** N년차 발전량 (kWh) */
  generationKwh: number;
  /** SMP 매출 */
  smpIncome: number;
  /** REC 매출 (가중치 적용) */
  recIncome: number;
  /** 총매출 (SMP + REC) */
  totalIncome: number;
  /** 유지보수비 */
  maintenance: number;
  /** 순수익 (총매출 - 유지보수) */
  netIncome: number;
  /** 누적 순수익 (대출 미반영) */
  cumulativeNet: number;
  /** 그 해 실제 상환액 (年) — 거치 1년차=이자만, 상환기간=원리금균등 합계, 종료 후=0 */
  loanPayment: number;
  /** 대출 적용 후 연수익 = netIncome - loanPayment */
  netAfterLoan: number;
  /** 대출 적용 후 누적 */
  cumulativeAfterLoan: number;
}

export interface FinanceResult {
  /** 20년 시계열 */
  rows: YearRow[];
  /** 공사비 (부가세 별도) */
  constructionCost: number;
  /** 부가세 */
  vat: number;
  /** 총사업비 = 공사비 + 부가세 */
  totalCost: number;
  /** 1년차 순수익 / 총사업비 (의뢰자 컨펌 공식) */
  roi: number;
  /** 손익분기점 (년, 소수 보간) — 누적순수익 = 총사업비 시점 */
  paybackYears: number | null;
  /** 분석 기간 총수익 (대출 미반영) */
  totalNetIncome: number;
  /** 분석 기간 총수익 (대출 적용) */
  totalAfterLoan: number;
  /** 1년 평균 순수익 (대출 미반영) */
  avgAnnualNet: number;
}

/**
 * N년차 연간 발전량 (kWh).
 *
 * 봉남리 검증: 268kW × 4h × 365 = 391,280 kWh (1년차, 효율 1.0)
 * N년차: 1년차 × (1 - decay)^(N-1)
 */
export function calcAnnualGeneration(
  capacityKw: number,
  dailyHours: number,
  annualDecay: number,
  yearIndex: number,
): number {
  if (capacityKw <= 0 || dailyHours <= 0) return 0;
  const yearOne = capacityKw * dailyHours * 365;
  if (yearIndex <= 1) return yearOne;
  return yearOne * Math.pow(1 - annualDecay, yearIndex - 1);
}

/**
 * 원리금 균등상환 월 상환액.
 *   M = P × r × (1+r)^n / ((1+r)^n - 1)
 *   r = 월이율 (annualRate / 12)
 *   n = 상환 개월수
 *
 * 금리 0 일 때는 P / n.
 */
export function calcMonthlyPayment(
  principal: number,
  annualRate: number,
  months: number,
): number {
  if (principal <= 0 || months <= 0) return 0;
  if (annualRate <= 0) return principal / months;
  const r = annualRate / 12;
  const pow = Math.pow(1 + r, months);
  return (principal * r * pow) / (pow - 1);
}

/**
 * 시나리오 → 상환 개월수.
 *   자기자본 → 0
 *   10년     → 120
 *   15년     → 180
 *   20년     → 240
 */
export function getRepayMonths(scenario: LoanScenario): number {
  if (scenario === "10년") return 120;
  if (scenario === "15년") return 180;
  if (scenario === "20년") return 240;
  return 0;
}

/**
 * 연도별 상환 스케줄 (年).
 *
 * 의뢰자 컨펌 (2026-05-06):
 *   - 거치기간(graceMonths): 매월 이자만 납부 (P × r)
 *   - 상환기간(repayMonths): 매월 원리금균등 (calcMonthlyPayment)
 *   - 상환 종료 후: 0
 *
 * 월 단위 시뮬레이션 후 12개월씩 묶어 연도별 합산.
 * (거치/상환 경계가 연도 경계와 안 맞아도 정확히 처리됨)
 *
 * 분석기간(totalYears) 초과분은 잘림 — 20년 대출(거치 12 + 상환 240 = 21년)
 * 의 마지막 1년치 상환분은 분석표 밖으로 나감 (A안 컨펌).
 *
 * 반환: 길이 totalYears 의 연간 상환액 배열. 1년차 = index 0.
 */
export function calcLoanScheduleByYear(
  principal: number,
  annualRate: number,
  graceMonths: number,
  repayMonths: number,
  totalYears: number,
): number[] {
  const schedule = new Array<number>(totalYears).fill(0);
  if (principal <= 0 || totalYears <= 0) return schedule;

  const monthlyInterest = principal * (annualRate / 12);
  const monthlyRepay =
    repayMonths > 0
      ? calcMonthlyPayment(principal, annualRate, repayMonths)
      : 0;
  const totalMonths = totalYears * 12;

  for (let m = 0; m < totalMonths; m += 1) {
    let payment = 0;
    if (m < graceMonths) {
      payment = monthlyInterest;
    } else if (m < graceMonths + repayMonths) {
      payment = monthlyRepay;
    }
    const yearIdx = Math.floor(m / 12);
    schedule[yearIdx] += payment;
  }

  return schedule;
}

/** 누적순수익이 총사업비를 넘는 시점 (소수 보간). 못 넘으면 null. */
export function calcPaybackYears(
  rows: YearRow[],
  totalCost: number,
): number | null {
  if (totalCost <= 0 || rows.length === 0) return 0;
  let prevCum = 0;
  for (const row of rows) {
    if (row.cumulativeNet >= totalCost) {
      const delta = row.cumulativeNet - prevCum;
      if (delta <= 0) return row.year;
      const fraction = (totalCost - prevCum) / delta;
      return row.year - 1 + fraction;
    }
    prevCum = row.cumulativeNet;
  }
  return null;
}

/**
 * 수지분석 메인 — 20년 시계열 + 요약 지표 한 번에 계산.
 */
export function calcFinance(input: FinanceInput): FinanceResult {
  const {
    capacityKw,
    dailyHours,
    annualDecay,
    smpPrice,
    recPrice,
    recWeight,
    maintenanceRate,
    constructionCost,
    vatRate,
    scenario,
    loanPrincipal,
    loanRate,
    graceMonths,
    years,
  } = input;

  const vat = constructionCost * vatRate;
  const totalCost = constructionCost + vat;
  const repayMonths = getRepayMonths(scenario);
  const effectiveLoan = scenario === "자기자본" ? 0 : loanPrincipal;
  const loanSchedule = calcLoanScheduleByYear(
    effectiveLoan,
    loanRate,
    graceMonths,
    repayMonths,
    years,
  );

  const rows: YearRow[] = [];
  let cumulativeNet = 0;
  let cumulativeAfterLoan = 0;

  for (let i = 1; i <= years; i += 1) {
    const generationKwh = calcAnnualGeneration(
      capacityKw,
      dailyHours,
      annualDecay,
      i,
    );
    const smpIncome = generationKwh * smpPrice;
    const recIncome = generationKwh * recPrice * recWeight;
    const totalIncome = smpIncome + recIncome;
    const maintenance = totalIncome * maintenanceRate;
    const netIncome = totalIncome - maintenance;
    cumulativeNet += netIncome;
    const loanPayment = loanSchedule[i - 1] ?? 0;
    const netAfterLoan = netIncome - loanPayment;
    cumulativeAfterLoan += netAfterLoan;
    rows.push({
      year: i,
      generationKwh,
      smpIncome,
      recIncome,
      totalIncome,
      maintenance,
      netIncome,
      cumulativeNet,
      loanPayment,
      netAfterLoan,
      cumulativeAfterLoan,
    });
  }

  const yearOneNet = rows[0]?.netIncome ?? 0;
  const roi = totalCost > 0 ? yearOneNet / totalCost : 0;
  const paybackYears = calcPaybackYears(rows, totalCost);
  const totalNetIncome = rows.reduce((s, r) => s + r.netIncome, 0);
  const totalAfterLoan = rows.reduce((s, r) => s + r.netAfterLoan, 0);
  const avgAnnualNet = years > 0 ? totalNetIncome / years : 0;

  return {
    rows,
    constructionCost,
    vat,
    totalCost,
    roi,
    paybackYears,
    totalNetIncome,
    totalAfterLoan,
    avgAnnualNet,
  };
}

/** 디폴트 입력 변수 (의뢰자 컨펌 2026-04-27 + 봉남리 PDF 검증). */
export const DEFAULT_FINANCE_INPUT: Omit<
  FinanceInput,
  "capacityKw" | "constructionCost" | "loanPrincipal" | "scenario"
> = {
  dailyHours: 4.0,
  annualDecay: 0.004,
  smpPrice: 121,
  recPrice: 72,
  recWeight: 1.5,
  maintenanceRate: 0.03,
  vatRate: 0.1,
  loanRate: 0.055,
  graceMonths: 12,
  years: 20,
};
