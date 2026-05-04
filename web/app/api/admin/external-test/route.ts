/**
 * POST /api/admin/external-test
 *
 * 외부 서비스 라이브 호출 프록시 (관리자 페이지 [▶ 호출] 버튼 전용).
 *
 * 흐름:
 *   1. admin 인증 (requireAdmin)
 *   2. 입력 { serviceId, values } — manifest 의 service.sampleRequest 와 합쳐 외부 호출
 *   3. URL/headers/fixedQuery 의 placeholder ({ENV_KEY}) 를 process.env 값으로 치환
 *   4. 응답 raw + 메타 (status / elapsedMs / requestUrl) 반환
 *
 * 보안:
 *   - admin 외 차단 (403)
 *   - 호출 가능한 서비스 = manifest.generated.ts 에 등록된 ExternalServiceMeta 만
 *   - placeholder 치환은 서버에서만 — 클라이언트는 placeholder 형태로만 봄
 *   - 응답 body 는 가공 없이 그대로 반환 (외부 API 마다 형식 다양)
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { MANIFEST } from "@/app/admin/api-manager/_lib/manifest.generated";
import type { MetaInput } from "@/app/admin/api-manager/_lib/types";

export const meta = {
  source: "외부 서비스 라이브 호출 프록시 — manifest sampleRequest 기반",
  cache: "no-store",
  auth: "admin" as const,
  inputs: [
    {
      name: "serviceId",
      type: "string" as const,
      required: true,
      sample: "law-go-kr",
      description: "외부 서비스 id (manifest.services[].id)",
    },
    {
      name: "values",
      type: "string" as const,
      required: false,
      sample: "{}",
      description: "사용자 입력값 JSON (string 매핑) — sampleRequest.inputs 별 값",
    },
  ],
  outputSchema:
    "{ ok, status, statusText, elapsedMs, requestUrl, requestMethod, headers, bodyText, bodyJson | null, error | null }",
  externalDeps: [],
  notes:
    "관리자 외 차단. placeholder ({ENV_KEY}) 는 서버에서만 process.env 값으로 치환 — 클라이언트로 키 노출 X. 호출 가능한 서비스는 _lib/services/<id>.ts 에 sampleRequest 정의된 것만.",
};

interface RequestBody {
  serviceId?: string;
  values?: Record<string, string>;
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: "관리자 권한이 필요합니다." },
      { status: 403 },
    );
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "잘못된 JSON body 입니다." },
      { status: 400 },
    );
  }

  const serviceId = (body.serviceId || "").trim();
  if (!serviceId) {
    return NextResponse.json(
      { ok: false, error: "serviceId 가 필요합니다." },
      { status: 400 },
    );
  }
  const values = body.values || {};

  // manifest 에서 서비스 메타 찾기
  const service = MANIFEST.services.find((s) => s.id === serviceId);
  if (!service) {
    return NextResponse.json(
      { ok: false, error: `서비스 '${serviceId}' 를 찾을 수 없습니다.` },
      { status: 404 },
    );
  }
  const sample = service.sampleRequest;
  if (!sample) {
    return NextResponse.json(
      { ok: false, error: `서비스 '${serviceId}' 에 sampleRequest 가 정의되지 않았습니다.` },
      { status: 400 },
    );
  }

  // placeholder 치환 + URL/body 조립
  const url = substitute(sample.url);
  const fixedQuery = substituteRecord(sample.fixedQuery ?? {});
  const headers = substituteRecord(sample.headers ?? {});

  const inputs: MetaInput[] = sample.inputs ?? [];
  const userQuery: Record<string, string> = {};
  const userBody: Record<string, unknown> = {};
  const isBody = sample.method === "POST" || sample.method === "PATCH" || sample.method === "PUT";
  for (const input of inputs) {
    const v = values[input.name];
    if (v == null || v === "") continue;
    if (isBody) {
      if (input.type === "number") {
        const n = Number(v);
        userBody[input.name] = Number.isFinite(n) ? n : v;
      } else if (input.type === "boolean") {
        userBody[input.name] = v === "true";
      } else {
        userBody[input.name] = v;
      }
    } else {
      userQuery[input.name] = v;
    }
  }

  // 최종 URL — fixedQuery + userQuery 병합
  let requestUrl = url;
  const allQuery = { ...fixedQuery, ...userQuery };
  if (Object.keys(allQuery).length > 0) {
    const qs = new URLSearchParams(allQuery).toString();
    requestUrl = url + (url.includes("?") ? "&" : "?") + qs;
  }

  const init: RequestInit = {
    method: sample.method,
    headers,
    cache: "no-store",
  };
  if (isBody && Object.keys(userBody).length > 0) {
    init.body = JSON.stringify(userBody);
    if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
      init.headers = { ...headers, "Content-Type": "application/json" };
    }
  }

  // 외부 호출
  const t0 = performance.now();
  let status = 0;
  let statusText = "";
  let bodyText = "";
  let bodyJson: unknown | null = null;
  const respHeaders: Record<string, string> = {};
  let error: string | null = null;
  try {
    const res = await fetch(requestUrl, init);
    status = res.status;
    statusText = res.statusText;
    bodyText = await res.text();
    try {
      bodyJson = JSON.parse(bodyText);
    } catch {
      // 아니면 raw text 그대로
    }
    res.headers.forEach((v, k) => {
      respHeaders[k] = v;
    });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const elapsedMs = performance.now() - t0;

  return NextResponse.json(
    {
      ok: error === null,
      status,
      statusText,
      elapsedMs,
      requestUrl,
      requestMethod: sample.method,
      headers: respHeaders,
      bodyText,
      bodyJson,
      error,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** "{LAW_OC}" → process.env.LAW_OC. 미정의 키는 빈 문자열로 치환. */
function substitute(text: string): string {
  return text.replace(/\{([A-Z_][A-Z0-9_]*)\}/g, (_, key) => {
    const v = process.env[key];
    return v ?? "";
  });
}

function substituteRecord(rec: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) {
    out[k] = substitute(v);
  }
  return out;
}
