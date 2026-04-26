/**
 * 환경변수 등록 상태 + 마스킹 표시값 server-side 조립.
 *
 * 페이지 (Server Component) 에서 호출:
 *   const keyMap = collectServerKeys(SERVICES);
 *
 * 키 자체는 process.env 에만 존재 → 클라이언트로는 마스킹된 표시값 + 길이만 전달.
 * 토글 시 전체 노출은 별도 server action 또는 환경변수 직접 조회 (로컬 한정 컨텍스트).
 *
 * ⚠ 절대 클라이언트 컴포넌트에서 import 금지 — 서버 전용.
 */

import type { CollectedExternalService } from "./types";

export interface KeyStatus {
  /** 환경변수 이름 (예: "KAKAO_REST_KEY") */
  name: string;
  /** .env.local 또는 환경에 등록되어 있는지 */
  present: boolean;
  /** 마스킹된 표시값 — 키 길이가 짧으면 "*" 8개 / 충분하면 앞4 + "..." + 뒤4 */
  masked: string | null;
  /** 키 길이 (bytes, ASCII 기준) — 가짜 키 식별 보조 */
  length: number;
  /** 전체 값 — ⚠ 토글 노출용. 로컬 한정이라 안전하지만 절대 로깅/전송 금지 */
  raw: string | null;
}

/** 키 단건 마스킹 — "abcd...wxyz" 형태 (24자 이상) 또는 "********" (짧은 경우) */
export function maskKey(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.length <= 12) return "*".repeat(8);
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

/** 단일 환경변수 → KeyStatus */
export function readEnvKey(name: string): KeyStatus {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) {
    return { name, present: false, masked: null, length: 0, raw: null };
  }
  const trimmed = raw.trim();
  return {
    name,
    present: true,
    masked: maskKey(trimmed),
    length: trimmed.length,
    raw: trimmed,
  };
}

/** 서비스별 envKeys 들을 일괄 읽어 매핑 */
export function collectServerKeys(
  services: CollectedExternalService[],
): Record<string, KeyStatus[]> {
  const out: Record<string, KeyStatus[]> = {};
  for (const svc of services) {
    const keys = (svc.envKeys ?? []).map(readEnvKey);
    out[svc.id] = keys;
  }
  return out;
}

/** 표시값 (raw 제거) — 클라이언트 컴포넌트로 전달 가능한 형태 */
export interface KeyStatusPublic {
  name: string;
  present: boolean;
  masked: string | null;
  length: number;
}

export function toPublic(s: KeyStatus): KeyStatusPublic {
  return { name: s.name, present: s.present, masked: s.masked, length: s.length };
}

export function toPublicMap(
  m: Record<string, KeyStatus[]>,
): Record<string, KeyStatusPublic[]> {
  const out: Record<string, KeyStatusPublic[]> = {};
  for (const [k, v] of Object.entries(m)) {
    out[k] = v.map(toPublic);
  }
  return out;
}
