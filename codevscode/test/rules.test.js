// runner/ and helper/ are loaded by the browser as well as by Node, so they may import only
// their own files.
// A Node import in there would work in every test and then fail in the player's browser.

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// Every folder whose modules the browser loads.
const SHARED = ["runner", "helper"];

/** Every import specifier in a module's source. */
export function importsOf(source) {
  const specifiers = [];
  for (const match of source.matchAll(/^\s*(?:import|export)\b[^"'`;]*?from\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/gm)) {
    specifiers.push(match[1] ?? match[2] ?? match[3]);
  }
  return specifiers;
}

/** Problems with a runner file's imports and globals. */
export function runnerProblems(source) {
  const problems = [];
  for (const specifier of importsOf(source)) {
    if (!/^\.\/[\w-]+\.js$/.test(specifier)) problems.push(`imports ${specifier}`);
  }
  // Comments and string literals are blanked first: an error message may say "require()".
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, '""');
  const globals = { process: /\bprocess\./, Buffer: /\bBuffer\./, require: /\brequire\s*\(/, __dirname: /\b__dirname\b/ };
  for (const [name, pattern] of Object.entries(globals)) {
    if (pattern.test(code)) problems.push(`uses ${name}`);
  }
  return problems;
}

test("runner/ and helper/ import only their own files and use no Node globals", async () => {
  for (const folder of SHARED) {
    const names = (await readdir(path.join(ROOT, folder))).filter((name) => name.endsWith(".js"));
    assert.ok(names.length >= 2, `${folder}/ should hold the shared modules`);
    for (const name of names) {
      const source = await readFile(path.join(ROOT, folder, name), "utf8");
      assert.deepEqual(runnerProblems(source), [], `${folder}/${name}`);
    }
  }
});

test("the check itself catches each thing it is meant to", () => {
  assert.deepEqual(runnerProblems(`import fs from "node:fs";`), ["imports node:fs"]);
  assert.deepEqual(runnerProblems(`import { x } from "../tools/challenge.mjs";`), ["imports ../tools/challenge.mjs"]);
  assert.deepEqual(runnerProblems(`const m = await import("sql.js");`), ["imports sql.js"]);
  assert.deepEqual(runnerProblems(`export { y } from "path";`), ["imports path"]);
  assert.deepEqual(runnerProblems(`const b = Buffer.from("x");`), ["uses Buffer"]);
  assert.deepEqual(runnerProblems(`if (process.env.X) {}`), ["uses process"]);
  assert.deepEqual(runnerProblems(`const r = require("fs");`), ["uses require"]);
  assert.deepEqual(runnerProblems(`import { a } from "./db.js";`), []);
  assert.deepEqual(runnerProblems(`const m = "do not require() this"; // process.exit`), []);
});
