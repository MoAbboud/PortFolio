// Runs a challenge's hidden tests against any app folder and prints what passed:
//
//   node tools/run.mjs challenges/sample path/to/app [--json]
//
// The folder holds the challenge's files (app.js, schema.sql, ...). Stage 1 uses this to
// score what each candidate model wrote, before the judge exists.

import path from "node:path";

import { CATEGORIES } from "../runner/runner.js";
import { loadTests, readApp, readJson, runOnApp } from "./challenge.mjs";

const [challengeDir, appDir, flag] = process.argv.slice(2);
if (!challengeDir || !appDir) {
  console.error("usage: node tools/run.mjs <challenge folder> <app folder> [--json]");
  process.exit(2);
}

const meta = await readJson(path.join(challengeDir, "challenge.json"));
const tests = await loadTests(path.join(challengeDir, "hidden/tests"));
const files = await readApp(appDir, meta.files);
const results = await runOnApp(files, tests);

if (flag === "--json") {
  console.log(JSON.stringify({ challenge: meta.id, version: meta.version, results }, null, 2));
} else {
  for (const category of CATEGORIES) {
    const mine = results.filter((r) => r.category === category);
    const passed = mine.filter((r) => r.status === "pass").length;
    console.log(`${category.padEnd(13)} ${passed} of ${mine.length}`);
    for (const r of mine) {
      if (r.status === "fail") console.log(`  FAIL ${r.id}${r.requirement ? ` [${r.requirement}]` : ""}: ${r.message}`);
    }
  }
  const passed = results.filter((r) => r.status === "pass").length;
  console.log(`total         ${passed} of ${results.length}`);
}
