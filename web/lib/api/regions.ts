/**
 * Client-side fetch wrapper — /api/regions/sigungu.
 *
 * 모든 모드(취락지구/공매/경매/시설)의 시도·시군구 드롭다운 공통 데이터 소스.
 * 한 번 받으면 모듈 scope 메모리 캐시 — 페이지 라이프타임 동안 외부 호출 0.
 * 두 번째 호출부터 즉시 반환.
 *
 * 3중 캐시:
 *   1. 클라이언트 모듈 scope (이 파일)              — 페이지 라이프타임
 *   2. Vercel CDN (s-maxage=2592000)              — 30일
 *   3. Supabase                                    — 실제 도달은 30일에 1회
 */
import type { SigunguEntry } from "@/lib/regions/sigungu";
export type { SigunguEntry };

interface SigunguApiResponse {
  ok: boolean;
  count?: number;
  items?: SigunguEntry[];
  error?: string;
}

let cache: SigunguEntry[] | null = null;
/** 동시 호출 합치기 — 같은 마운트에서 fetch 중 또 호출 시 1번으로 합침. */
let inflight: Promise<SigunguEntry[]> | null = null;

/** /api/regions/sigungu — 시군구 약 250건. 캐시 hit 시 외부 호출 0. */
export async function fetchSigungus(): Promise<SigunguEntry[]> {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch("/api/regions/sigungu");
      const data = (await res.json()) as SigunguApiResponse;
      if (!data.ok) throw new Error(data.error || "시군구 조회 실패");
      cache = data.items ?? [];
      return cache;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** 캐시 비우기 — 보통 호출 X (행정구역 거의 안 변함). 테스트/디버깅용. */
export function clearSigunguCache(): void {
  cache = null;
}
