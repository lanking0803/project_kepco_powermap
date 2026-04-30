/**
 * 법제처 OPEN API — 자치법규(조례) 검색 래퍼.
 *
 * 엔드포인트: http://www.law.go.kr/DRF/lawSearch.do?target=ordin
 *
 * 검증 (2026-04-29):
 *   - section=ordinNm 으로 자치법규명 매칭만 가능 (본문/지자체기관명 검색 X)
 *   - org 파라미터 무시됨 → query 에 지자체명 포함 필수
 *   - 검색 패턴: "{광역명} 도시계획", "{기초명} 도시계획" 또는 "{기초명} 군계획"
 *   - IP 등록 미완료 시 "사용자 정보 검증에 실패" 응답
 *
 * 설계 원칙:
 *   - 단순 fetch + XML 정규식 파싱 (조례 응답 평탄, DOMParser 불필요)
 *   - 모듈 scope Map 캐시 (key = query, TTL = 24h)
 *   - 호출자가 지자체기관명 매칭 필터링 책임 (route.ts 가 처리)
 */

const LAW_OC = process.env.LAW_OC || "";
const SEARCH_URL = "http://www.law.go.kr/DRF/lawSearch.do";
const SERVICE_URL = "https://www.law.go.kr/DRF/lawService.do";
const TIMEOUT_MS = 5000;

/** 캐시 TTL — 조례는 거의 안 변함 (24h) */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** 법제처 응답에서 영업가치 있는 필드만 추출 (응답 13~15필드 중 7개) */
export interface LawOrdinance {
  /** 자치법규ID — lawService.do?ID=... */
  id: string;
  /** 자치법규일련번호 (MST) — lawService.do?MST=... */
  mst: string;
  /** 자치법규명 — 예: "충청남도 도시계획 조례" */
  name: string;
  /** 지자체기관명 — "충청남도" 또는 "충청남도 부여군" */
  organ: string;
  /** 자치법규종류 — "조례" | "규칙" | etc */
  kind: string;
  /** 공포일자 (YYYYMMDD) */
  promulgationDate: string;
  /** 시행일자 (YYYYMMDD) */
  effectiveDate: string;
  /** 본문 HTML 직링크 (origin 포함, 새 창 열기 가능) */
  detailUrl: string;
}

interface CacheEntry {
  rows: LawOrdinance[];
  expiresAt: number;
}
const queryCache = new Map<string, CacheEntry>();

/**
 * 자치법규 검색 — query 로 자치법규명(제목) 매칭.
 *
 * @param query 검색어 — "충청남도 도시계획" 식
 * @param display 페이지 크기 (기본 50, 최대 100)
 */
export async function searchOrdinancesByQuery(
  query: string,
  display = 50,
): Promise<LawOrdinance[]> {
  // 진단 로그 (배포 환경 디버깅용 — sunlap.kr 조례 빈배열 사례 2026-04-30)
  const region = process.env.VERCEL_REGION ?? "local";
  const ocLen = LAW_OC.length;
  if (!LAW_OC) {
    console.error(`[Law API] LAW_OC 미설정 region=${region}`);
    return [];
  }
  const cleaned = (query || "").trim();
  if (!cleaned) return [];

  // 캐시 확인
  const cached = queryCache.get(cleaned);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.rows;
  }

  const params = new URLSearchParams({
    OC: LAW_OC,
    target: "ordin",
    type: "XML",
    query: cleaned,
    display: String(display),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const res = await fetch(`${SEARCH_URL}?${params.toString()}`, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    const elapsed = Date.now() - startedAt;
    if (!res.ok) {
      const bodyPreview = await res.text().then((t) => t.slice(0, 300));
      console.error(
        `[Law API] HTTP ${res.status} region=${region} ocLen=${ocLen} q="${cleaned}" elapsed=${elapsed}ms body="${bodyPreview}"`,
      );
      return [];
    }
    const xml = await res.text();
    const rows = parseSearchXml(xml);
    // 본문 프리뷰 — 정상 응답이지만 "사용자 정보 검증 실패" 같은 평문일 가능성 진단
    if (rows.length === 0) {
      console.error(
        `[Law API] 0 rows region=${region} ocLen=${ocLen} q="${cleaned}" elapsed=${elapsed}ms xmlPreview="${xml.slice(0, 300)}"`,
      );
    }
    queryCache.set(cleaned, {
      rows,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return rows;
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    if ((err as Error).name === "AbortError") {
      console.error(
        `[Law API] 타임아웃 ${TIMEOUT_MS}ms region=${region} q="${cleaned}" elapsed=${elapsed}ms`,
      );
    } else {
      console.error(
        `[Law API] 호출 실패 region=${region} q="${cleaned}" elapsed=${elapsed}ms err=${(err as Error).name}:${(err as Error).message}`,
      );
    }
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * lawSearch.do XML → LawOrdinance[].
 *
 * 응답 구조:
 *   <OrdinSearch>
 *     <totalCnt>N</totalCnt>
 *     <law id="1">
 *       <자치법규ID>...</자치법규ID>
 *       <자치법규일련번호>...</자치법규일련번호>
 *       <자치법규명><![CDATA[...]]></자치법규명>
 *       <지자체기관명>...</지자체기관명>
 *       <자치법규종류>조례</자치법규종류>
 *       <공포일자>YYYYMMDD</공포일자>
 *       <시행일자>YYYYMMDD</시행일자>
 *       <자치법규상세링크>/DRF/lawService.do?...</자치법규상세링크>
 *     </law>
 *     ...
 *   </OrdinSearch>
 *
 * 정규식 파싱 — 응답이 평탄(중첩 X)하고 필드명 한글이라 DOMParser 보다 단순.
 */
function parseSearchXml(xml: string): LawOrdinance[] {
  const rows: LawOrdinance[] = [];
  // 각 <law id="N"> ... </law> 블록 추출
  const lawBlocks = xml.matchAll(/<law\b[^>]*>([\s\S]*?)<\/law>/g);
  for (const m of lawBlocks) {
    const block = m[1];
    const id = extractField(block, "자치법규ID");
    const mst = extractField(block, "자치법규일련번호");
    const name = extractField(block, "자치법규명");
    const organ = extractField(block, "지자체기관명");
    const kind = extractField(block, "자치법규종류");
    const promulgationDate = extractField(block, "공포일자");
    const effectiveDate = extractField(block, "시행일자");
    const rawDetail = extractField(block, "자치법규상세링크");
    // 응답의 자치법규상세링크 = 상대경로 (`/DRF/lawService.do?...`) → 절대 URL 로
    const detailUrl = rawDetail
      ? rawDetail.startsWith("http")
        ? rawDetail
        : `https://www.law.go.kr${rawDetail}`
      : mst
        ? `${SERVICE_URL}?OC=${LAW_OC}&target=ordin&MST=${mst}&type=HTML`
        : "";

    if (!id && !mst) continue; // 식별자 없으면 skip
    rows.push({
      id,
      mst,
      name,
      organ,
      kind,
      promulgationDate,
      effectiveDate,
      detailUrl,
    });
  }
  return rows;
}

/** XML 한 블록에서 단일 필드 추출 (CDATA 자동 벗기기 + 엔티티 디코딩) */
function extractField(block: string, tag: string): string {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  const m = block.match(re);
  if (!m) return "";
  let val = m[1];
  const cdata = val.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) val = cdata[1];
  return decodeXmlEntities(val.trim());
}

/**
 * XML 엔티티 디코딩 — `&amp;` → `&` 등.
 * 법제처 응답의 자치법규상세링크가 `&amp;` 로 escape 돼있어 그대로 a href 넣으면
 * 브라우저가 `&amp;type=HTML` 을 리터럴 파라미터로 처리해 404. 디코딩 필수.
 */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** 캐시 초기화 (테스트/관리용 — 운영 호출 X) */
export function clearLawApiCache(): void {
  queryCache.clear();
}
