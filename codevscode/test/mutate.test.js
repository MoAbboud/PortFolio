import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyMutant, enclosingFunction, mutants, OPERATORS, parseApp } from "../analyzer/mutate.js";
import { datasetRows, labelMutants } from "../tools/mutate.mjs";

const TINY = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "tiny");

/** The mutated app.js for every mutant of one operator. */
function mutated(source, operator, schema = "") {
  const files = { "app.js": source, "schema.sql": schema };
  return mutants(files)
    .filter((m) => m.operator === operator)
    .map((m) => applyMutant(files, m)[m.file]);
}

test("sql-from-text pastes each parameter into the query in turn", () => {
  const app = `export async function handle(r, db) { return db.all("SELECT * FROM t WHERE a = ? AND b = ?", [r.a, r.b]); }`;
  assert.deepEqual(mutated(app, "sql-from-text"), [
    "export async function handle(r, db) { return db.all(`SELECT * FROM t WHERE a = '${r.a}' AND b = ?`, [r.b]); }",
    "export async function handle(r, db) { return db.all(`SELECT * FROM t WHERE a = ? AND b = '${r.b}'`, [r.a]); }",
  ]);
});

test("sql-from-text keeps backslashes and backticks in the SQL intact, and drops an emptied array", () => {
  const app = "export async function handle(r, db) { return db.all(\"SELECT * FROM t WHERE x LIKE ? ESCAPE '\\\\' AND y = '`'\", [r.q]); }";
  const [only] = mutated(app, "sql-from-text");
  assert.equal(only, "export async function handle(r, db) { return db.all(`SELECT * FROM t WHERE x LIKE '${r.q}' ESCAPE '\\\\' AND y = '\\`'`); }");
  parseApp(only);
});

test("drop-condition removes an AND column = ? and its parameter", () => {
  const app = `export async function handle(r, db) { return db.get("SELECT * FROM notes WHERE id = ? AND user_id = ?", [r.id, r.user]); }`;
  assert.deepEqual(mutated(app, "drop-condition"), [
    `export async function handle(r, db) { return db.get("SELECT * FROM notes WHERE id = ?", [r.id]); }`,
  ]);
});

test("uncap, weak-random, drop-lowercase, drop-trim and drop-await each make their one change", () => {
  const app = [
    "export async function handle(r) {",
    "  const n = Math.min(r.limit, MAX);",
    "  const bytes = crypto.getRandomValues(new Uint8Array(8));",
    "  const e = r.email.trim().toLowerCase();",
    "  return await work(n, bytes, e);",
    "}",
  ].join("\n");
  assert.match(mutated(app, "uncap")[0], /const n = r\.limit;/);
  assert.match(mutated(app, "weak-random")[0], /const bytes = new Uint8Array\(8\);/);
  assert.match(mutated(app, "drop-lowercase")[0], /const e = r\.email\.trim\(\);/);
  assert.match(mutated(app, "drop-trim")[0], /const e = r\.email\.toLowerCase\(\);/);
  assert.match(mutated(app, "drop-await")[0], /return work\(n, bytes, e\);/);
  assert.equal(mutated("export const n = Math.min(1, MAX);", "uncap").length, 0, "no variable to keep: no mutant");
});

test("flip-boundary swaps exactly the operator", () => {
  const app = "export function handle(a, b) { return a <= b && b > 2; }";
  assert.deepEqual(mutated(app, "flip-boundary"), [
    "export function handle(a, b) { return a < b && b > 2; }",
    "export function handle(a, b) { return a <= b && b >= 2; }",
  ]);
});

test("wrong-status changes status codes in reply calls and status properties", () => {
  const app = "export function handle() { if (x) return fail(404, 'no'); return { status: 201, body: {} }; }";
  assert.deepEqual(mutated(app, "wrong-status"), [
    "export function handle() { if (x) return fail(400, 'no'); return { status: 201, body: {} }; }",
    "export function handle() { if (x) return fail(404, 'no'); return { status: 200, body: {} }; }",
  ]);
});

test("drop-guard removes an if that only returns, and leaves an if with an else", () => {
  const app = "export function handle(r) { if (!r.ok) return 1; if (r.a) { return 2; } if (r.b) return 3; else return 4; }";
  assert.deepEqual(mutated(app, "drop-guard"), [
    "export function handle(r) {  if (r.a) { return 2; } if (r.b) return 3; else return 4; }",
    "export function handle(r) { if (!r.ok) return 1;  if (r.b) return 3; else return 4; }",
  ]);
});

test("schema operators remove an index and a UNIQUE, but not the UNIQUE of a unique index", () => {
  const schema = "CREATE TABLE u (email TEXT NOT NULL UNIQUE);\nCREATE INDEX a ON u (email);\nCREATE UNIQUE INDEX b ON u (email);\n";
  const files = { "app.js": "export function handle() {}", "schema.sql": schema };
  const found = mutants(files);
  const index = found.filter((m) => m.operator === "drop-index").map((m) => applyMutant(files, m)["schema.sql"]);
  assert.equal(index.length, 2);
  assert.ok(!index[0].includes("CREATE INDEX a"));
  const unique = found.filter((m) => m.operator === "drop-unique").map((m) => applyMutant(files, m)["schema.sql"]);
  assert.deepEqual(unique, [schema.replace(" UNIQUE)", ")")]);
});

test("every mutant has a unique id, a declared category, and app.js mutants all parse", () => {
  const app = `export async function handle(r, db) {
    if (!r.a) return fail(400, "x");
    if (!r.b) return fail(400, "y");
    return db.all("SELECT * FROM t WHERE a = ? AND b = ?", [r.a, r.b]);
  }`;
  const files = { "app.js": app, "schema.sql": "" };
  const found = mutants(files);
  assert.equal(new Set(found.map((m) => m.id)).size, found.length);
  for (const m of found) {
    assert.equal(m.category, OPERATORS[m.operator].category);
    parseApp(applyMutant(files, m)["app.js"]);
  }
});

test("the enclosing function is the top-level function around a position", () => {
  const app = "const A = 1;\nexport async function handle() { return helper(); }\nfunction helper() { return A; }\n";
  assert.equal(enclosingFunction(app, app.indexOf("return A")).name, "helper");
  assert.equal(enclosingFunction(app, app.indexOf("helper()")).name, "handle");
  assert.deepEqual(enclosingFunction(app, 3), { start: 0, end: app.length, name: null });
});

test("on the tiny fixture, mutants are labelled by the tests that catch them, and rows are written", async () => {
  const labelled = await labelMutants(TINY, { concurrency: 4 });
  const uncap = labelled.mutants.find((m) => m.operator === "uncap");
  assert.equal(uncap.status, "caught");
  assert.deepEqual(uncap.caughtBy, ["efficiency/capped"]);
  assert.deepEqual(uncap.labels, ["efficiency"]);
  assert.ok(labelled.mutants.every((m) => ["caught", "survived", "timeout"].includes(m.status)));

  const rows = datasetRows(labelled);
  const clean = rows.filter((r) => r.kind === "clean");
  assert.deepEqual(clean.map((r) => r.function), ["handle"]);
  const row = rows.find((r) => r.mutant === uncap.id);
  assert.equal(row.function, "handle");
  assert.ok(row.before.includes("Math.min(") && !row.code.includes("Math.min("));
  assert.equal(row.source, "challenge:tiny@1");
});
