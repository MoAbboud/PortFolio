import assert from "node:assert/strict";
import { test } from "node:test";

import { checkApp } from "../runner/check.js";
import { appLoader, sql } from "../tools/challenge.mjs";

async function check(app, schema = "") {
  return checkApp({ SQL: await sql(), loadApp: appLoader(app), schema });
}

const GOOD = `export async function handle(request) { return { status: 404, body: { error: "no" } }; }`;

test("an app that loads and answers has no problems", async () => {
  assert.deepEqual(await check(GOOD, "CREATE TABLE t (x);"), []);
});

test("each kind of problem a player would see is reported in plain words", async () => {
  assert.deepEqual(await check(GOOD, "CREATE TABLE ("), ['schema.sql does not run: near "(": syntax error']);
  assert.deepEqual(await check(`import crypto from "crypto";\n${GOOD}`), ["app.js does not load: app.js must not import anything."]);
  assert.match((await check("export async function handle( {"))[0], /^app\.js does not load: /);
  assert.deepEqual(await check("export const x = 1;"), ["app.js does not export a function called handle."]);
  assert.deepEqual(await check(`export async function handle(r) { return JSON.parse(r.body).x.y; }`), [
    "handle() crashed on GET /: Unexpected end of JSON input",
    "handle() crashed on POST /: Cannot read properties of undefined (reading 'y')",
  ]);
  assert.deepEqual(await check(`export function handle() { return "ok"; }`), [
    "handle() answered GET / without a { status, body } object.",
    "handle() answered POST / without a { status, body } object.",
  ]);
});
