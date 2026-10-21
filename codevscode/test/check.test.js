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
    "GET / crashed: Unexpected end of JSON input",
    "POST / crashed: Cannot read properties of undefined (reading 'y')",
  ]);
  assert.deepEqual(await check(`export function handle() { return "ok"; }`), [
    "handle() answered GET / without a { status, body } object.",
    "handle() answered POST / without a { status, body } object.",
  ]);
});

test("the walk-through reports crashes along the way, with kept values filled in, and nothing else", async () => {
  const smoke = {
    steps: [
      { method: "POST", path: "/login", body: {}, keep: { token: "token" } },
      { method: "POST", path: "/notes", auth: true, body: { title: "x" }, keep: { id: "id" } },
      { method: "GET", path: "/notes/{id}", auth: true },
    ],
  };
  const app = `export async function handle(r) {
    if (r.path === "/login") return { status: 200, body: { token: "t1" } };
    if (r.path === "/notes") return { status: 201, body: { id: 7, auth: r.headers.authorization } };
    if (r.path === "/notes/7" && r.headers.authorization === "Bearer t1") throw new Error("readNote is not defined");
    return { status: 404, body: { error: "no" } };
  }`;
  const problems = await checkApp({ SQL: await sql(), loadApp: appLoader(app), schema: "", smoke });
  assert.deepEqual(problems, ["GET /notes/7 crashed: readNote is not defined"]);
  // A wrong answer is not a problem the walk-through reports: only crashes are.
  const wrong = `export async function handle() { return { status: 500, body: { error: "oops" } }; }`;
  assert.deepEqual(await checkApp({ SQL: await sql(), loadApp: appLoader(wrong), schema: "", smoke }), []);
});
