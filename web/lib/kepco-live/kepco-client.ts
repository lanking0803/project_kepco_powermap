/**
 * KEPCO retrieveMeshNo (search_capacity) 단건 호출.
 *
 * 단건 lookup 전용 — 대량 크롤링은 crawler/api_client.py 가 담당.
 * 대량용 복잡 회피 로직 (세션 주기적 재생성, 1000건마다 휴식 등) 은 빼고
 * 단건에 필요한 최소만 구현:
 *   - UA 7종 회전
 *   - 브라우저 위장 헤더 (Referer/Origin/X-Requested-With)
 *   - 세션 쿠키 cache 5분 TTL (첫 호출 시 EWM092D00 GET 으로 획득)
 *   - 5xx + 네트워크 에러 시 3회 재시도 (1s/2s/4s 지수 백오프, 세션 재생성)
 *
 * 빈 dlt_resultList 는 정상 응답 (호출자 측에서 후보 다음 시도).
 */

const BASE_URL = "https://online.kepco.co.kr";
const SEARCH_PATH = "/ew/cpct/retrieveMeshNo";
const ADDR_GBN_PATH = "/ew/cpct/retrieveAddrGbn";
const SESSION_PATH = "/EWM092D00";

const SESSION_TTL_MS = 5 * 60 * 1000;
const RETRY_DELAYS_MS = [1000, 2000, 4000];
const DEFAULT_TIMEOUT_MS = 30_000;

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
];

const COMMON_HEADERS = {
  "Content-Type": "application/json",
  Referer: `${BASE_URL}${SESSION_PATH}`,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  Origin: BASE_URL,
  "X-Requested-With": "XMLHttpRequest",
};

export interface KepcoFieldInput {
  do: string;
  si: string;
  gu: string;
  lidong: string;
  li: string;
}

/** KEPCO retrieveMeshNo dlt_resultList 행. KEPCO 가 number/string 혼용해서 응답. */
export interface KepcoCapacityRow {
  SUBST_NM: string; SUBST_CD: string;
  MTR_NO: string;
  DL_NM: string; DL_CD: string;
  SUBST_CAPA: number | string;
  SUBST_PWR: number | string;
  G_SUBST_CAPA: number | string;
  MTR_CAPA: number | string;
  MTR_PWR: number | string;
  G_MTR_CAPA: number | string;
  DL_CAPA: number | string;
  DL_PWR: number | string;
  G_DL_CAPA: number | string;
  // STEP 데이터 (있을 때만)
  JS_SUBST_PWR?: number; JS_MTR_PWR?: number; JS_DL_PWR?: number;
  VOL_1?: number; VOL_2?: number; VOL_3?: number;
}

interface SessionCache {
  cookie: string;
  ua: string;
  fetchedAt: number;
}

let sessionCache: SessionCache | null = null;

/** 테스트에서 세션 cache 강제 초기화 — production 사용 금지. */
export function __resetSessionForTest() {
  sessionCache = null;
}

function pickUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function extractCookies(setCookieHeader: string | null): string {
  if (!setCookieHeader) return "";
  // 쉼표 구분된 여러 Set-Cookie 를 분리하되,
  // Expires=Mon, 01 Jan 2026... 의 쉼표는 유지해야 한다.
  // 단순화: 'name=value; ...' 패턴마다 첫 토큰만 추출
  const parts = setCookieHeader.split(/,(?=\s*[A-Za-z0-9_-]+=)/);
  return parts
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function getOrInitSession(): Promise<SessionCache> {
  const now = Date.now();
  if (sessionCache && now - sessionCache.fetchedAt < SESSION_TTL_MS) {
    return sessionCache;
  }
  const ua = pickUserAgent();
  const r = await fetch(`${BASE_URL}${SESSION_PATH}`, {
    method: "GET",
    headers: { ...COMMON_HEADERS, "User-Agent": ua },
  });
  const cookie = extractCookies(r.headers.get("set-cookie"));
  sessionCache = { cookie, ua, fetchedAt: now };
  return sessionCache;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface CallOpts {
  /** 외부 abort signal (사용자 취소 등) */
  signal?: AbortSignal;
  /** 호출당 타임아웃 (기본 30s) */
  timeoutMs?: number;
}

export async function callKepcoSearch(
  fields: KepcoFieldInput,
  jibun: string,
  opts?: CallOpts,
): Promise<KepcoCapacityRow[]> {
  const body = {
    dma_reqParam: {
      searchCondition: "address",
      do: fields.do,
      si: fields.si,
      gu: fields.gu,
      lidong: fields.lidong,
      li: fields.li,
      jibun,
    },
  };

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const session = await getOrInitSession();
      const timeoutSignal = AbortSignal.timeout(opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const signal = opts?.signal
        ? AbortSignal.any([opts.signal, timeoutSignal])
        : timeoutSignal;

      const r = await fetch(`${BASE_URL}${SEARCH_PATH}`, {
        method: "POST",
        headers: {
          ...COMMON_HEADERS,
          "User-Agent": session.ua,
          ...(session.cookie ? { Cookie: session.cookie } : {}),
        },
        body: JSON.stringify(body),
        signal,
      });

      if (r.status >= 500) {
        throw new Error(`KEPCO ${r.status}`);
      }
      if (!r.ok) {
        // 4xx 는 재시도 안 함 (입력 문제)
        throw new Error(`KEPCO ${r.status}: ${(await r.text()).slice(0, 200)}`);
      }

      const json = (await r.json()) as { dlt_resultList?: KepcoCapacityRow[] };
      return Array.isArray(json.dlt_resultList) ? json.dlt_resultList : [];
    } catch (e) {
      lastErr = e;
      const wait = RETRY_DELAYS_MS[attempt];
      if (wait == null) break;
      // 4xx (재시도 무의미) 는 즉시 throw
      if (e instanceof Error && /KEPCO 4\d\d/.test(e.message)) break;
      sessionCache = null; // 세션 재생성 트리거
      await sleep(wait);
    }
  }
  throw lastErr ?? new Error("KEPCO call failed");
}

/**
 * KEPCO retrieveAddrGbn (gbn=4) — 마을 단위 지번 목록 조회.
 *
 * 주변 지번 미수집 시 사용자가 "지번 목록 불러오기" 누르면 호출.
 * 5필드(do/si/gu/lidong/li) 로 그 마을의 KEPCO 보유 지번 배열 반환.
 *
 * 응답 예: [{ ADDR_JIBUN: "3-12" }, { ADDR_JIBUN: "산15-2" }, ...]
 * 빈 배열 = 정상 응답 (KEPCO 미보유 마을).
 */
export async function callKepcoAddrGbn(
  fields: KepcoFieldInput,
  opts?: CallOpts,
): Promise<string[]> {
  const body = {
    dma_addrGbn: {
      gbn: 4,
      addr_do: fields.do,
      addr_si: fields.si,
      addr_gu: fields.gu,
      addr_lidong: fields.lidong,
      addr_li: fields.li,
      addr_jibun: "",
    },
  };

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const session = await getOrInitSession();
      const timeoutSignal = AbortSignal.timeout(opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const signal = opts?.signal
        ? AbortSignal.any([opts.signal, timeoutSignal])
        : timeoutSignal;

      const r = await fetch(`${BASE_URL}${ADDR_GBN_PATH}`, {
        method: "POST",
        headers: {
          ...COMMON_HEADERS,
          "User-Agent": session.ua,
          ...(session.cookie ? { Cookie: session.cookie } : {}),
        },
        body: JSON.stringify(body),
        signal,
      });

      if (r.status >= 500) {
        throw new Error(`KEPCO ${r.status}`);
      }
      if (!r.ok) {
        throw new Error(`KEPCO ${r.status}: ${(await r.text()).slice(0, 200)}`);
      }

      const json = (await r.json()) as {
        dlt_addrGbn?: { ADDR_JIBUN?: string }[];
      };
      const list = Array.isArray(json.dlt_addrGbn) ? json.dlt_addrGbn : [];
      return list
        .map((row) => (row?.ADDR_JIBUN ?? "").trim())
        .filter((s) => s.length > 0);
    } catch (e) {
      lastErr = e;
      const wait = RETRY_DELAYS_MS[attempt];
      if (wait == null) break;
      if (e instanceof Error && /KEPCO 4\d\d/.test(e.message)) break;
      sessionCache = null;
      await sleep(wait);
    }
  }
  throw lastErr ?? new Error("KEPCO addrGbn call failed");
}
