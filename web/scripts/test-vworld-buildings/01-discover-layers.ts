export {};
/**
 * VWorld WFS GetCapabilities — 등록 키에서 사용 가능한 "건물" 관련 레이어 식별.
 *
 * VWorld 는 키마다 활성 레이어가 다름. 공식 문서엔 layer name 표준 X.
 * → 실제 GetCapabilities 응답에서 typeName 목록 추출 → "buld|build|house|건물"
 *   키워드 필터링 → 후보 레이어 출력.
 *
 * 실행:
 *   cd web && npx tsx --env-file=.env.local scripts/test-vworld-buildings/01-discover-layers.ts
 */

const VWORLD_KEY = process.env.VWORLD_KEY ?? "";
const WFS_URL = "https://api.vworld.kr/req/wfs";
const TIMEOUT_MS = 15000;
const REFERER = "https://sunlap.kr";

async function getCapabilities(): Promise<string> {
  const params = new URLSearchParams({
    key: VWORLD_KEY,
    domain: "sunlap.kr",
    service: "WFS",
    version: "2.0.0",
    request: "GetCapabilities",
  });
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${WFS_URL}?${params.toString()}`, {
      signal: ctl.signal,
      headers: { Referer: REFERER },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

interface FeatureType {
  name: string;
  title: string;
  abstract?: string;
}

function parseFeatureTypes(xml: string): FeatureType[] {
  // 단순 정규식 파서 — DOMParser 없이 동작.
  const out: FeatureType[] = [];
  const ftRegex = /<FeatureType[^>]*>([\s\S]*?)<\/FeatureType>/g;
  let m: RegExpExecArray | null;
  while ((m = ftRegex.exec(xml)) !== null) {
    const block = m[1];
    const name = /<Name>([^<]+)<\/Name>/.exec(block)?.[1] ?? "";
    const title = /<Title>([^<]*)<\/Title>/.exec(block)?.[1] ?? "";
    const abs = /<Abstract>([^<]*)<\/Abstract>/.exec(block)?.[1];
    if (name) out.push({ name, title, abstract: abs });
  }
  return out;
}

function isBuildingCandidate(ft: FeatureType): boolean {
  const hay = `${ft.name} ${ft.title} ${ft.abstract ?? ""}`.toLowerCase();
  return /buld|build|house|건물|주택|housereg|brbase/.test(hay);
}

async function main() {
  if (!VWORLD_KEY) {
    console.error("❌ VWORLD_KEY 미설정");
    process.exit(1);
  }
  console.log(`VWORLD_KEY ${VWORLD_KEY.slice(0, 6)}…  domain=sunlap.kr`);
  console.log("GetCapabilities 호출…");

  const xml = await getCapabilities();
  console.log(`응답 ${xml.length} bytes`);

  const types = parseFeatureTypes(xml);
  console.log(`총 FeatureType ${types.length} 개`);

  const candidates = types.filter(isBuildingCandidate);
  console.log(`\n=== 건물 후보 ${candidates.length} 개 ===`);
  candidates.forEach((ft, i) => {
    console.log(
      `\n[${i + 1}] ${ft.name}\n    title: ${ft.title}${ft.abstract ? `\n    abstract: ${ft.abstract.slice(0, 200)}` : ""}`,
    );
  });

  if (candidates.length === 0) {
    console.log("\n⚠️ 키워드 매칭 0건 — 전체 레이어 목록 출력");
    types.forEach((ft, i) =>
      console.log(`  [${i + 1}] ${ft.name}  (${ft.title})`),
    );
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
