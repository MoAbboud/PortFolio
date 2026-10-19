import assert from "node:assert/strict";
import { test } from "node:test";

import { appLoader, runOnApp, sql } from "../tools/challenge.mjs";
import { EPOCH, STEP_MS, runTests } from "../runner/runner.js";

const NOTES_SCHEMA = "CREATE TABLE notes (id INTEGER PRIMARY KEY, owner INTEGER, title TEXT);";

/** Run one test body against an app given as source. Returns the single result. */
async function runBody(appSource, run, schema = NOTES_SCHEMA) {
  const [result] = await runOnApp({ "app.js": appSource, "schema.sql": schema }, [
    { id: "correctness/x", category: "correctness", requirement: null, title: "x", run },
  ]);
  return result;
}

const ECHO = `export async function handle(request) { return { status: 200, body: request }; }`;

test("a request reaches the app normalised: method, path, query, lower-case headers, body text, time", async () => {
  let seen;
  const result = await runBody(ECHO, async (t) => {
    seen = (await t.request("post", "/notes?limit=5&q=a%20b", {
      body: { title: "x" },
      token: "abc",
      headers: { "X-Thing": "1" },
    })).body;
  });
  assert.equal(result.status, "pass", result.message);
  assert.equal(seen.method, "POST");
  assert.equal(seen.path, "/notes");
  assert.deepEqual(seen.query, { limit: "5", q: "a b" });
  assert.equal(seen.headers.authorization, "Bearer abc");
  assert.equal(seen.headers["x-thing"], "1");
  assert.equal(seen.headers["content-type"], "application/json");
  assert.equal(seen.body, '{"title":"x"}');
  assert.equal(seen.time, EPOCH + STEP_MS);
});

test("the clock moves one step per request, and advance() moves it further", async () => {
  const times = [];
  const result = await runBody(ECHO, async (t) => {
    times.push((await t.request("GET", "/")).body.time);
    t.equal(t.now(), EPOCH + 2 * STEP_MS, "now() is the next request's time");
    t.advance(60000);
    times.push((await t.request("GET", "/")).body.time);
  });
  assert.equal(result.status, "pass", result.message);
  assert.deepEqual(times, [EPOCH + STEP_MS, EPOCH + 2 * STEP_MS + 60000]);
});

test("raw sends a body exactly as given", async () => {
  let body;
  await runBody(ECHO, async (t) => {
    body = (await t.request("POST", "/", { raw: "{broken" })).body.body;
  });
  assert.equal(body, "{broken");
});

test("an app that throws answers 500, and the test sees why", async () => {
  let response;
  const result = await runBody(`export async function handle() { throw new Error("boom"); }`, async (t) => {
    response = await t.request("GET", "/");
  });
  assert.equal(result.status, "pass", result.message);
  assert.equal(response.status, 500);
  assert.equal(response.crashed, "boom");
});

test("a response that is not a response becomes a 500", async () => {
  const cases = [
    "return undefined;",
    "return { status: 99 };",
    "return { status: 200.5 };",
    "return { status: 200, body: { n: 10n } };",
  ];
  for (const body of cases) {
    let response;
    await runBody(`export async function handle() { ${body} }`, async (t) => {
      response = await t.request("GET", "/");
    });
    assert.equal(response.status, 500, body);
    assert.ok(response.crashed, body);
  }
});

test("each test gets a fresh module and a fresh database", async () => {
  const app = `
    let calls = 0;
    export async function handle(request, db) {
      calls += 1;
      db.run("INSERT INTO notes (owner, title) VALUES (1, 'x')");
      return { status: 200, body: { calls, rows: db.all("SELECT id FROM notes").length } };
    }`;
  const seen = [];
  const run = async (t) => {
    seen.push((await t.request("GET", "/")).body);
  };
  const results = await runOnApp({ "app.js": app, "schema.sql": NOTES_SCHEMA }, [
    { id: "correctness/a", category: "correctness", requirement: null, title: "a", run },
    { id: "correctness/b", category: "correctness", requirement: null, title: "b", run },
  ]);
  assert.ok(results.every((r) => r.status === "pass"));
  assert.deepEqual(seen, [{ calls: 1, rows: 1 }, { calls: 1, rows: 1 }]);
});

test("queries are counted, and resetQueries starts again", async () => {
  const app = `export async function handle(request, db) {
    db.all("SELECT 1"); db.get("SELECT 2"); db.run("INSERT INTO notes (owner) VALUES (1)");
    return { status: 200 };
  }`;
  const result = await runBody(app, async (t) => {
    await t.request("GET", "/");
    t.equal(t.queries(), 3, "after one request");
    t.equal(t.queryLog()[0].sql, "SELECT 1", "first query logged");
    t.resetQueries();
    t.equal(t.queries(), 0, "after reset");
  });
  assert.equal(result.status, "pass", result.message);
});

test("run reports changes and the inserted id", async () => {
  let reply;
  await runBody(
    `export async function handle(request, db) {
      const a = db.run("INSERT INTO notes (owner) VALUES (?)", [1]);
      const b = db.run("UPDATE notes SET title = :t", { ":t": "x" });
      return { status: 200, body: { a, b } };
    }`,
    async (t) => {
      reply = (await t.request("GET", "/")).body;
    },
  );
  assert.deepEqual(reply, { a: { changes: 1, lastId: 1 }, b: { changes: 1, lastId: 1 } });
});

test("fullScans finds a query that reads a whole table, and not one that uses an index", async () => {
  const app = `export async function handle(request, db) {
    if (request.path === "/fill") {
      for (let i = 0; i < 150; i++) db.run("INSERT INTO notes (owner, title) VALUES (?, ?)", [i % 3, "t" + i]);
      return { status: 200 };
    }
    if (request.path === "/by-owner") return { status: 200, body: db.all("SELECT id FROM notes WHERE owner = ?", [1]) };
    return { status: 200, body: db.get("SELECT id FROM notes WHERE id = ?", [5]) };
  }`;
  const result = await runBody(app, async (t) => {
    await t.request("POST", "/fill");
    t.resetQueries();
    await t.request("GET", "/by-owner");
    const scans = t.fullScans(100);
    t.equal(scans.length, 1, "scans without an index on owner");
    t.equal(scans[0].table, "notes", "scanned table");
    t.equal(scans[0].rows, 150, "rows in the scanned table");
    t.equal(t.fullScans(1000).length, 0, "nothing is a scan of a 1000-row table");
    t.resetQueries();
    await t.request("GET", "/by-id");
    t.equal(t.fullScans(0).length, 0, "a primary key lookup is not a scan");
  });
  assert.equal(result.status, "pass", result.message);

  const indexed = await runBody(
    app,
    async (t) => {
      await t.request("POST", "/fill");
      t.resetQueries();
      await t.request("GET", "/by-owner");
      t.equal(t.fullScans(0).length, 0, "scans with an index on owner");
    },
    `${NOTES_SCHEMA} CREATE INDEX by_owner ON notes (owner);`,
  );
  assert.equal(indexed.status, "pass", indexed.message);
});

test("storedText reads every value, blobs included", async () => {
  let values;
  await runBody(
    `export async function handle(request, db) {
      db.run("INSERT INTO notes (owner, title) VALUES (1, 'plain')");
      db.run("CREATE TABLE secrets (b BLOB)");
      db.run("INSERT INTO secrets (b) VALUES (?)", [new TextEncoder().encode("hidden")]);
      return { status: 200 };
    }`,
    async (t) => {
      await t.request("GET", "/");
      values = t.inspect.storedText();
    },
  );
  assert.ok(values.includes("plain"));
  assert.ok(values.includes("hidden"));
});

test("a failed assertion fails the test with its message; any other error says so", async () => {
  const failed = await runBody(ECHO, async (t) => t.equal(1, 2, "one and two"));
  assert.equal(failed.status, "fail");
  assert.equal(failed.message, "one and two: expected 2, got 1");

  const oneOf = await runBody(ECHO, async (t) => t.oneOf(200, [403, 404], "status"));
  assert.equal(oneOf.message, "status: expected one of 403, 404, got 200");

  const broken = await runBody(ECHO, async () => {
    throw new TypeError("x is not a function");
  });
  assert.equal(broken.message, "the test hit an error: x is not a function");
});

test("a schema that does not run, an app that does not load, and a missing handle each fail clearly", async () => {
  const schema = await runBody(ECHO, async () => {}, "CREATE TABLE (");
  assert.match(schema.message, /^schema\.sql did not run/);

  const load = await runBody("export async function handle( {", async () => {});
  assert.match(load.message, /^app\.js did not load/);

  const missing = await runBody("export const nothing = 1;", async () => {});
  assert.equal(missing.message, "app.js does not export a function called handle");

  const imports = await runBody(`import fs from "node:fs";\n${ECHO}`, async () => {});
  assert.equal(imports.message, "app.js did not load: app.js must not import anything.");
});

test("the runner takes any loader, which is how the browser will use it", async () => {
  const results = await runTests({
    SQL: await sql(),
    loadApp: appLoader(ECHO),
    schema: "",
    tests: [{ id: "correctness/x", category: "correctness", requirement: "r", title: "x", run: async () => {} }],
  });
  assert.deepEqual(results, [
    { id: "correctness/x", category: "correctness", requirement: "r", status: "pass", message: "" },
  ]);
});
