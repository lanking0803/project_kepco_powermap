/**
 * API 관리자 페이지 — 메타 타입 정의 (단일 진실원).
 *
 * 흐름:
 *   route.ts 안의 `export const meta` (또는 metaGET/metaPOST/...) → scanner AST 추출
 *   → manifest.generated.ts → 관리 페이지가 import
 *
 * 외부 서비스도 같은 패턴: `_lib/services/<id>.ts` 의 `export const meta`.
 */

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export type AuthLevel = "user" | "admin" | "system" | "none";

/** 입력 파라미터 메타 (라이브 테스트 폼 자동 생성용) */
export interface MetaInput {
  /** 파라미터 이름 (GET=querystring key, POST/PATCH=body field) */
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  /** 호출 즉시 작동하는 실값 (테스트 폼 기본값) */
  sample: string;
  description?: string;
}

/** 단일 endpoint × 단일 메서드의 메타 — `export const meta` / `metaGET` / ... */
export interface EndpointMeta {
  /** "DB" | "VWorld" | "RTMS 토지" | "건축물대장" 등 자유문자열 */
  source: string;
  /** "no-store" | "s-maxage=86400" 등 — 응답에 적용되는 캐시 정책 */
  cache: string;
  auth: AuthLevel;
  /** 입력 파라미터 (GET=querystring, POST/PATCH=body field 양쪽 통용) */
  inputs?: MetaInput[];
  /** 응답 스키마 요약 (자유서식, 1~2줄) */
  outputSchema: string;
  /** 의존하는 외부 서비스 id (services/<id>.ts 의 id 와 매칭) */
  externalDeps?: string[];
  /** 특이사항 메모 (markdown 허용) */
  notes?: string;
  /** 위험 작업 — 라이브 테스트 전 confirm 강제 (DELETE / 파괴적 POST 등) */
  dangerous?: boolean;
  /** 위험 사유 — confirm 화면에 표시 */
  dangerNote?: string;
}

/** 외부 서비스 메타 — _lib/services/<id>.ts 가 export */
export interface ExternalServiceMeta {
  /** 식별자 — endpoint meta 의 externalDeps 에서 참조 */
  id: string;
  name: string;
  category: "geocoding" | "data.go.kr" | "infra" | "scraping";
  consoleUrl: string;
  /** process.env 의 키 이름들 (서버 컴포넌트가 읽어 표시) */
  envKeys?: string[];
  /** 만료일 "YYYY-MM-DD" | null (무기한) */
  expiry?: string | null;
  dailyLimit?: string;
  /** 발급/등록 절차 (markdown 허용) */
  issueGuide: string;
  usageExample?: string;
  notes?: string;
}

/** scanner 가 수집한 endpoint × method 단위 메타 */
export interface CollectedEndpoint {
  /** "/api/capa/by-jibun" */
  path: string;
  /** "capa-by-jibun" — externalDeps consumedBy 매칭용 식별자 */
  id: string;
  /** "app/api/capa/by-jibun/route.ts" — 프로젝트 root 기준 상대 (vscode 점프용) */
  filePath: string;
  methods: Array<{
    method: HttpMethod;
    /** metaXXX (있으면) > meta (있으면) > null */
    meta: EndpointMeta | null;
    /** 1-base 줄 번호 (vscode://file/...:line). 0 이면 미정의 */
    metaLine: number;
    /** 코드에 정의된 export 이름 ("meta" | "metaGET" | ...) — 없으면 null */
    metaExportName: string | null;
  }>;
}

/** 외부 서비스 + scanner 가 자동 추가한 정보 */
export interface CollectedExternalService extends ExternalServiceMeta {
  filePath: string;
  metaLine: number;
  /** scanner 자동 계산: 이 서비스를 externalDeps 에 포함하는 endpoint id 들 */
  consumedBy: string[];
}

/** scanner 의 최종 산출물 */
export interface GeneratedManifest {
  endpoints: CollectedEndpoint[];
  services: CollectedExternalService[];
  /** scanner 가 발견한 문제 (meta 미정의, 잘못된 externalDeps 참조 등) */
  warnings: string[];
}
