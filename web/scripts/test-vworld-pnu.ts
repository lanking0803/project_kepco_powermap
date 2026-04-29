/**
 * VWorld 가 캠코 PNU 를 인식하는지 검증.
 */

import * as fs from "fs";
import * as path from "path";

// env 먼저 로드 — VWorld 모듈 import 전에
const envPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envPath)) {
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

async function run() {
  // 동적 import — env 설정 후
  const { getParcelByPnu } = await import("../lib/vworld/parcel");

  const cases = [
    { label: "광주 농성동 391-15", pnu: "2914010600003910015" },
    { label: "강릉 포남동 1067-33", pnu: "5115011100010670033" },
    { label: "성남 율동 산69-1", pnu: "4113510400100690001" },
    { label: "경산 신석리 산154", pnu: "4729037025101540000" },
  ];

  for (const tc of cases) {
    const t0 = Date.now();
    try {
      const r = await getParcelByPnu(tc.pnu);
      const dt = Date.now() - t0;
      if (!r) {
        console.log(`[${tc.label}] PNU=${tc.pnu}  → null (${dt}ms)`);
      } else {
        console.log(
          `[${tc.label}] PNU=${tc.pnu}  → 매칭 OK  지번=${r.jibun.jibun}  area=${r.geometry?.area_m2 ?? "?"}㎡  (${dt}ms)`,
        );
      }
    } catch (e) {
      console.log(`[${tc.label}] [ERR] ${e instanceof Error ? e.message : e}`);
    }
  }
}

run();
