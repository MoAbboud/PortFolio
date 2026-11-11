// What a player would see when their app runs - load errors, schema errors, crashes - as JSON:
//
//   node tools/check.mjs path/to/app                        ->  ["app.js does not load: ...", ...]  or  []
//   node tools/check.mjs path/to/app challenges/sample      also walks the challenge's public smoke.json
//
// The harness uses it to give a helper the same feedback a player gets from the workspace.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { checkApp } from "../runner/check.js";
import { appLoader, readApp, sql } from "./challenge.mjs";

const [dir, challengeDir] = process.argv.slice(2);
if (!dir) {
  console.error("usage: node tools/check.mjs <app folder> [challenge folder]");
  process.exit(2);
}
let smoke;
if (challengeDir) {
  try {
    smoke = JSON.parse(await readFile(path.join(challengeDir, "public/smoke.json"), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const files = await readApp(dir);
const problems = await checkApp({ SQL: await sql(), loadApp: appLoader(files["app.js"]), schema: files["schema.sql"], smoke });
process.stdout.write(JSON.stringify(problems));
