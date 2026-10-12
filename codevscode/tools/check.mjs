// What a player would see when their app runs - load errors, schema errors, crashes - as JSON:
//
//   node tools/check.mjs path/to/app     ->  ["app.js does not load: ...", ...]  or  []
//
// The harness uses it to give a helper the same feedback a player gets from the workspace.

import { checkApp } from "../runner/check.js";
import { appLoader, readApp, sql } from "./challenge.mjs";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node tools/check.mjs <app folder>");
  process.exit(2);
}
const files = await readApp(dir);
const problems = await checkApp({ SQL: await sql(), loadApp: appLoader(files["app.js"]), schema: files["schema.sql"] });
process.stdout.write(JSON.stringify(problems));
