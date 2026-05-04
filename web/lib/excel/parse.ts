/**
 * KEPCO 엑셀 파싱 + 검증
 * - 헤더 자동 탐지
 * - 행 검증 (잘못된 행만 스킵, 카운트)
 * - 파일 내 중복 제거 (마지막 값 우선)
 */
import * as XLSX from "xlsx";
import {
  detectHeaderMap,
  ExcelFormatError,
  REQUIRED_HEADERS,
  OPTIONAL_STEP_HEADERS,
  type HeaderMap,
} from "./headers";

/** 엑셀 한 행을 정규화한 형태 (DB upsert에 그대로 사용) */
export interface ParsedRow {
  addr_do: string;
  addr_si: string | null;
  addr_gu: string | null;
  addr_dong: string | null;
  addr_li: string | null;
  addr_jibun: string | null;
  geocode_address: string;

  subst_nm: string;
  mtr_no: string;
  dl_nm: string;

  subst_capa: number;
  subst_pwr: number;
  g_subst_capa: number;
  mtr_capa: number;
  mtr_pwr: number;
  g_mtr_capa: number;
  dl_capa: number;
  dl_pwr: number;
  g_dl_capa: number;

  step1_cnt: number | null;
  step1_pwr: number | null;
  step2_cnt: number | null;
  step2_pwr: number | null;
  step3_cnt: number | null;
  step3_pwr: number | null;
}

export interface ParseResult {
  /** 파싱 성공 + 중복 제거된 최종 행 (DB upsert 대상) */
  rows: ParsedRow[];
  /** 헤더에서 데이터로 들어간 총 후보 행 수 */
  totalRows: number;
  /** 양식 메타 */
  hasStep: boolean;
  headerRow: number;
  /** 스킵 카운트 */
  skipped: {
    emptyRow: number;
    missingAddr: number;
    missingSubst: number;
    missingMtr: number;
    missingDl: number;
    other: number;
  };
  /** 파일 내 중복 (마지막 값으로 처리됨) */
  duplicates: number;
  /** 행별 에러 (최대 100개까지 기록) */
  errors: Array<{ row: number; reason: string }>;
}

const MAX_ERROR_LOG = 100;

/** 문자열 정제 */
function s(v: any): string {
  if (v == null) return "";
  return String(v).trim();
}

/** 숫자 정제 (콤마 제거, 비숫자는 0) */
function n(v: any): number {
  if (v == null || v === "") return 0;
  const str = String(v).replace(/,/g, "").trim();
  if (!str) return 0;
  const num = Number(str);
  if (isNaN(num)) return 0;
  return Math.round(num);
}

/** "-기타지역"을 빼고 리 단위 주소 만들기 (지오코딩용) */
function buildGeocodeAddress(
  addr_do: string,
  addr_si: string,
  addr_gu: string,
  addr_dong: string,
  addr_li: string
): string {
  return [addr_do, addr_si, addr_gu, addr_dong, addr_li]
    .filter((p) => p && p !== "-기타지역")
    .join(" ")
    .trim();
}

/** 한 행을 검증 + 정규화 */
function parseRow(
  row: any[],
  rowNumber: number,
  hm: HeaderMap,
  result: ParseResult
): ParsedRow | null {
  if (!row || row.every((c) => c == null || c === "")) {
    result.skipped.emptyRow++;
    return null;
  }

  const addr_do = s(row[hm.required["시/도"]]);
  if (!addr_do) {
    result.skipped.missingAddr++;
    if (result.errors.length < MAX_ERROR_LOG) {
      result.errors.push({ row: rowNumber, reason: "시/도 누락" });
    }
    return null;
  }

  const subst_nm = s(row[hm.required["변전소명"]]);
  if (!subst_nm) {
    result.skipped.missingSubst++;
    if (result.errors.length < MAX_ERROR_LOG) {
      result.errors.push({ row: rowNumber, reason: "변전소명 누락" });
    }
    return null;
  }

  const mtr_no = s(row[hm.required["주변압기"]]);
  if (!mtr_no) {
    result.skipped.missingMtr++;
    if (result.errors.length < MAX_ERROR_LOG) {
      result.errors.push({ row: rowNumber, reason: "주변압기 누락" });
    }
    return null;
  }

  const dl_nm = s(row[hm.required["배전선로명"]]);
  if (!dl_nm) {
    result.skipped.missingDl++;
    if (result.errors.length < MAX_ERROR_LOG) {
      result.errors.push({ row: rowNumber, reason: "배전선로명 누락" });
    }
    return null;
  }

  const addr_si = s(row[hm.required["시"]]) || null;
  const addr_gu = s(row[hm.required["구/군"]]) || null;
  const addr_dong = s(row[hm.required["동/면"]]) || null;
  const addr_li = s(row[hm.required["리"]]) || null;
  const addr_jibun = s(row[hm.required["상세번지"]]) || null;

  const geocode_address = buildGeocodeAddress(
    addr_do,
    addr_si ?? "",
    addr_gu ?? "",
    addr_dong ?? "",
    addr_li ?? ""
  );

  return {
    addr_do,
    addr_si,
    addr_gu,
    addr_dong,
    addr_li,
    addr_jibun,
    geocode_address,
    subst_nm,
    mtr_no,
    dl_nm,
    subst_capa: n(row[hm.required["변전소 접속기준용량(kW)"]]),
    subst_pwr: n(row[hm.required["변전소 접수기준접속용량(kW)"]]),
    g_subst_capa: n(row[hm.required["변전소 접속계획반영접속용량(kW)"]]),
    mtr_capa: n(row[hm.required["주변압기 접속기준용량(kW)"]]),
    mtr_pwr: n(row[hm.required["주변압기 접수기준접속용량(kW)"]]),
    g_mtr_capa: n(row[hm.required["주변압기 접속계획반영접속용량(kW)"]]),
    dl_capa: n(row[hm.required["배전선로 접속기준용량(kW)"]]),
    dl_pwr: n(row[hm.required["배전선로 접수기준접속용량(kW)"]]),
    g_dl_capa: n(row[hm.required["배전선로 접속계획반영접속용량(kW)"]]),
    step1_cnt: hm.hasStep ? n(row[hm.step["접수 건수"]]) : null,
    step1_pwr: hm.hasStep ? n(row[hm.step["접수 용량(kW)"]]) : null,
    step2_cnt: hm.hasStep ? n(row[hm.step["공용망보강 건수"]]) : null,
    step2_pwr: hm.hasStep ? n(row[hm.step["공용망보강 용량(kW)"]]) : null,
    step3_cnt: hm.hasStep ? n(row[hm.step["접속공사 건수"]]) : null,
    step3_pwr: hm.hasStep ? n(row[hm.step["접속공사 용량(kW)"]]) : null,
  };
}

/** 9개 컬럼 조합으로 unique key 생성 */
function rowKey(r: ParsedRow): string {
  return [
    r.addr_do,
    r.addr_si ?? "",
    r.addr_gu ?? "",
    r.addr_dong ?? "",
    r.addr_li ?? "",
    r.addr_jibun ?? "",
    r.subst_nm,
    r.mtr_no,
    r.dl_nm,
  ].join("|");
}

/**
 * 엑셀 파일(ArrayBuffer)을 파싱하고 검증
 * @throws ExcelFormatError 양식 자체가 잘못된 경우
 */
export function parseExcel(buffer: ArrayBuffer): ParseResult {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
  } catch {
    throw new ExcelFormatError(
      "엑셀 파일을 읽을 수 없습니다. 파일이 손상되었거나 비밀번호로 보호되어 있을 수 있습니다."
    );
  }

  if (workbook.SheetNames.length === 0) {
    throw new ExcelFormatError("엑셀 파일에 시트가 없습니다.");
  }

  // 첫 시트만 사용
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });

  if (rows.length === 0) {
    throw new ExcelFormatError("엑셀 시트가 비어있습니다.");
  }

  const headerMap = detectHeaderMap(rows);

  const result: ParseResult = {
    rows: [],
    totalRows: 0,
    hasStep: headerMap.hasStep,
    headerRow: headerMap.headerRow,
    skipped: {
      emptyRow: 0,
      missingAddr: 0,
      missingSubst: 0,
      missingMtr: 0,
      missingDl: 0,
      other: 0,
    },
    duplicates: 0,
    errors: [],
  };

  // 헤더 다음 행부터 데이터
  const dataStart = headerMap.headerRow + 1;
  const seen = new Map<string, ParsedRow>();

  for (let i = dataStart; i < rows.length; i++) {
    result.totalRows++;
    const parsed = parseRow(rows[i], i + 1, headerMap, result);
    if (!parsed) continue;

    const key = rowKey(parsed);
    if (seen.has(key)) {
      result.duplicates++;
    }
    seen.set(key, parsed); // 마지막 값 우선
  }

  result.rows = Array.from(seen.values());
  return result;
}

/** 사용자 친화적 결과 요약 */
export function summarizeParseResult(r: ParseResult): {
  total: number;
  ok: number;
  skipped: number;
  duplicates: number;
} {
  const totalSkipped =
    r.skipped.emptyRow +
    r.skipped.missingAddr +
    r.skipped.missingSubst +
    r.skipped.missingMtr +
    r.skipped.missingDl +
    r.skipped.other;
  return {
    total: r.totalRows,
    ok: r.rows.length,
    skipped: totalSkipped,
    duplicates: r.duplicates,
  };
}

export { ExcelFormatError, REQUIRED_HEADERS, OPTIONAL_STEP_HEADERS };
