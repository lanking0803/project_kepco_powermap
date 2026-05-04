import { readFileSync } from "fs";
const data = JSON.parse(readFileSync(0, "utf8"));
const rule = process.argv[2];
for (const f of data) {
  for (const m of f.messages) {
    if (!rule || (m.ruleId && m.ruleId.includes(rule))) {
      const file = f.filePath.replace(/^.*[\\/]web[\\/]/, "");
      console.log(`${file}:${m.line}:${m.column}  [${m.ruleId}]  ${m.message}`);
    }
  }
}
