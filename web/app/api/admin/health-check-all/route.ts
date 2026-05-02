/**
 * POST /api/admin/health-check-all
 *
 * 외부 서비스 헬스체크 일괄 호출 (관리자 페이지 [전체 새로고침] 전용).
 *
 * 흐름:
 *   1. admin 인증
 *   2. manifest.services 중 sampleRequest 있는 항목 전부 병렬 호출
 *   3. 각 서비스: { ok, status, elapsedMs, healthLevel } 반환
 *      - healthLevel: "ok" | "nodata" | "error" (HTTP + 응답 본문 패턴 분석)
 *
 * 사용처: 외부 서비스 탭 진입 시 + [전체 새로고침] 버튼
 *
 * 보안: admin 외 차단. external-test 와 동일하게 placeholder 치환 후 외부 호출.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { MANIFEST } from "@/app/admin/api-manager/_lib/manifest.generated";
import type {
  CollectedExternalService,
  ExternalSampleRequest,
} from "@/app/admin/api-manager/_lib/types";

export type HealthLevel = "ok" | "nodata" | "error" | "unsupported";

export interface ServiceHealthResult {
  serviceId: string;
  serviceName: string;
  healthLevel: HealthLevel;
  /** HTTP status code (외부 호출 결과). unsupported 면 0 */
  status: number;
  elapsedMs: number;
  /** 응답 요약 메시지 — UI 표시용 (예: "OK", "NODATA_ERROR", "401 Unauthorized") */
  summary: string;
  /** 응답 본문 일부 (디버그용, 200자) */
  bodyPreview: string;
  checkedAt: string;
}

export const meta = {
  source: "manifest sampleRequest 일괄 호출",
  cache: "no-store",
  auth: "admin" as const,
  inputs: [],
  outputSchema: "{ ok, results: ServiceHealthResult[] }",
  externalDeps: [],
  notes:
    "외부 서비스 탭 진입 시 자동 호출 + [전체 새로고침] 버튼으로 수동 호출. sampleRequest 미정의 서비스는 unsupported.",
};

export async function POST() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: "관리자 권한이 필요합니다." },
      { status: 403 },
    );
  }

  const checkedAt = new Date().toISOString();
  const tasks = MANIFEST.services.map((s) => checkOne(s, checkedAt));
  const results = await Promise.all(tasks);

  return NextResponse.json(
    { ok: true, results },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function checkOne(
  service: CollectedExternalService,
  checkedAt: string,
): Promise<ServiceHealthResult> {
  if (!service.sampleRequest) {
    return {
      serviceId: service.id,
      serviceName: service.name,
      healthLevel: "unsupported",
      status: 0,
      elapsedMs: 0,
      summary: "헬스체크 미지원 (sampleRequest 정의 X)",
      bodyPreview: "",
      checkedAt,
    };
  }

  const sample = service.sampleRequest;
  const url = buildUrl(sample);
  const headers = substituteRecord(sample.headers ?? {});
  const init: RequestInit = {
    method: sample.method,
    headers,
    cache: "no-store",
  };

  const t0 = performance.now();
  try {
    const res = await fetch(url, init);
    const elapsedMs = performance.now() - t0;
    const text = await res.text();
    const bodyPreview = text.slice(0, 200);

    // healthLevel 판정 — HTTP + 응답 본문 패턴
    let healthLevel: HealthLevel;
    let summary: string;
    if (!res.ok) {
      healthLevel = "error";
      summary = `${res.status} ${res.statusText}`;
    } else {
      // Hyphen 처럼 HTTP 200 + 본문 errCd 로 실패 표현하는 케이스 우선 판정
      const hyphenErr = matchHyphenErrCd(text);
      if (hyphenErr) {
        healthLevel = hyphenErr.level;
        summary = hyphenErr.summary;
      } else {
        // 200 OK 라도 NODATA 패턴 감지
        const lower = text.toLowerCase();
        const isNoData =
          lower.includes("nodata_error") ||
          /<resultcode>03<\/resultcode>/i.test(text) ||
          /"resultcode"\s*:\s*"03"/i.test(text) ||
          /<totalcnt>0<\/totalcnt>/i.test(text);
        if (isNoData) {
          healthLevel = "nodata";
          summary = "200 OK · NODATA";
        } else {
          healthLevel = "ok";
          summary = "200 OK";
        }
      }
    }

    return {
      serviceId: service.id,
      serviceName: service.name,
      healthLevel,
      status: res.status,
      elapsedMs,
      summary,
      bodyPreview,
      checkedAt,
    };
  } catch (err) {
    const elapsedMs = performance.now() - t0;
    const message = err instanceof Error ? err.message : String(err);
    return {
      serviceId: service.id,
      serviceName: service.name,
      healthLevel: "error",
      status: 0,
      elapsedMs,
      summary: `네트워크 실패: ${message.slice(0, 80)}`,
      bodyPreview: "",
      checkedAt,
    };
  }
}

/** sampleRequest URL + fixedQuery + sample 기본값(inputs) → 최종 URL. placeholder 치환. */
function buildUrl(sample: ExternalSampleRequest): string {
  const baseUrl = substitute(sample.url);
  const fixedQuery = substituteRecord(sample.fixedQuery ?? {});
  const sampleInputs: Record<string, string> = {};
  for (const i of sample.inputs ?? []) {
    if (i.sample) sampleInputs[i.name] = i.sample;
  }
  const allQuery = { ...fixedQuery, ...sampleInputs };
  if (Object.keys(allQuery).length === 0) return baseUrl;
  const qs = new URLSearchParams(allQuery).toString();
  return baseUrl + (baseUrl.includes("?") ? "&" : "?") + qs;
}

function substitute(text: string): string {
  return text.replace(/\{([A-Z_][A-Z0-9_]*)\}/g, (_, key) => {
    const v = process.env[key];
    return v ?? "";
  });
}

function substituteRecord(rec: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) out[k] = substitute(v);
  return out;
}

/**
 * Hyphen 응답은 HTTP 200 + 본문에 errCd 로 인증실패/권한없음을 표현.
 * 의뢰자가 "프로그램 오류 vs 결제 만료"를 직관적으로 구분할 수 있도록
 * errCd 별로 healthLevel 과 summary 를 분기.
 *
 * 매핑은 lib/hyphen/types.ts HYPHEN_ERR_CD_MAP 과 의미 맞춤:
 *   200    → ok        ("정상")
 *   407    → ok        ("매물 0건 — 정상 응답")
 *   HDM006 → error     ("인증실패 — 결제 만료 의심")
 *   HDM009 → error     ("키 오류 — 변조/만료")
 *   HDM012 → error     ("권한없음 — 멤버십 미가입")
 *   HDM016 → nodata    ("테스트 모드 레이트리밋 — 20초 후 재시도")
 *   기타   → error     ("알 수 없는 errCd")
 *
 * Hyphen 외 서비스는 errCd 키가 없어서 null 반환 → 기존 로직(NODATA/ok) 그대로.
 */
function matchHyphenErrCd(
  text: string,
): { level: HealthLevel; summary: string } | null {
  const m = text.match(/"errCd"\s*:\s*"([^"]+)"/);
  if (!m) return null;
  const errCd = m[1];
  switch (errCd) {
    case "200":
      return { level: "ok", summary: "200 OK · errCd=200" };
    case "407":
      return { level: "ok", summary: "200 OK · errCd=407 (매물 0건)" };
    case "HDM006":
      return {
        level: "error",
        summary: "HDM006 인증실패 — 결제 만료 의심",
      };
    case "HDM009":
      return {
        level: "error",
        summary: "HDM009 키 오류 — 변조/만료",
      };
    case "HDM012":
      return {
        level: "error",
        summary: "HDM012 권한없음 — 멤버십 미가입",
      };
    case "HDM016":
      return {
        level: "nodata",
        summary: "HDM016 테스트 레이트리밋 — 20초 후 재시도",
      };
    default:
      return { level: "error", summary: `errCd=${errCd}` };
  }
}
