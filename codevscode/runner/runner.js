// Runs a challenge's tests against an app. The same code runs in a browser worker (the
// player's local tests and the static prototype), in the validator, and in the judge's
// container, so a test passes or fails for the same reason everywhere.
//
// Shared by the browser and Node: nothing here may import a Node module. test/rules.test.js
// checks that.

import { wrapDatabase } from "./db.js";

/** The clock every test starts at: 2026-01-01T00:00:00Z. Requests carry it, never Date.now. */
export const EPOCH = Date.UTC(2026, 0, 1);

/** How far the clock moves with each request, so "newest first" always has an answer. */
export const STEP_MS = 1000;

export const CATEGORIES = Object.freeze([
  "correctness",
  "security",
  "efficiency",
  "practicality",
]);

/** Raised by the assertions. Its message is written for a player to read. */
export class TestFailure extends Error {
  constructor(message) {
    super(message);
    this.name = "TestFailure";
  }
}

/**
 * Run tests against one app.
 *
 * - `SQL`: an initialised sql.js module.
 * - `loadApp`: returns a freshly loaded copy of the app module each call. Every test gets a
 *   new module and a new database, so nothing leaks from one test into the next.
 * - `schema`: the app's schema.sql.
 * - `tests`: an array of `{ id, category, requirement, title, run(t) }`.
 *
 * Returns one result per test: `{ id, category, requirement, status, message }`, status
 * being "pass" or "fail". A test that throws anything other than an assertion fails with
 * what it threw.
 */
export async function runTests({ SQL, loadApp, schema, tests }) {
  const results = [];
  for (const test of tests) {
    results.push(await runOne({ SQL, loadApp, schema, test }));
  }
  return results;
}

async function runOne({ SQL, loadApp, schema, test }) {
  const result = {
    id: test.id,
    category: test.category,
    requirement: test.requirement ?? null,
    status: "pass",
    message: "",
  };
  const raw = new SQL.Database();
  try {
    try {
      raw.exec(schema);
    } catch (error) {
      throw new TestFailure(`schema.sql did not run: ${messageOf(error)}`);
    }
    let app;
    try {
      app = await loadApp();
    } catch (error) {
      throw new TestFailure(`app.js did not load: ${messageOf(error)}`);
    }
    if (!app || typeof app.handle !== "function") {
      throw new TestFailure("app.js does not export a function called handle");
    }
    const { db, log } = wrapDatabase(raw);
    await test.run(makeContext({ raw, db, log, app }));
  } catch (error) {
    result.status = "fail";
    result.message =
      error instanceof TestFailure ? error.message : `the test hit an error: ${messageOf(error)}`;
  } finally {
    raw.close();
  }
  return result;
}

function makeContext({ raw, db, log, app }) {
  let clock = EPOCH;

  const t = {
    /** The time the next request will carry, in milliseconds. */
    now: () => clock + STEP_MS,

    /** Move the clock on, for anything that depends on time passing. */
    advance(ms) {
      clock += ms;
    },

    /**
     * Send one request to the app and return its normalised response.
     *
     * `body` is sent as JSON; `raw` sends a string exactly as given (for broken JSON);
     * `token` becomes an `Authorization: Bearer` header.
     */
    async request(method, target, { body, raw: rawBody, token, headers = {} } = {}) {
      const [path, queryString = ""] = target.split("?");
      const sent = {};
      for (const [name, value] of Object.entries(headers)) sent[name.toLowerCase()] = value;
      let text = "";
      if (rawBody !== undefined) {
        text = rawBody;
      } else if (body !== undefined) {
        text = JSON.stringify(body);
        sent["content-type"] ??= "application/json";
      }
      if (token !== undefined) sent.authorization = `Bearer ${token}`;
      clock += STEP_MS;
      const request = Object.freeze({
        method: method.toUpperCase(),
        path,
        query: Object.freeze(Object.fromEntries(new URLSearchParams(queryString))),
        headers: Object.freeze(sent),
        body: text,
        time: clock,
      });
      let response;
      try {
        response = await app.handle(request, db);
      } catch (error) {
        // What a real server would do with an uncaught error. The player sees why.
        return { status: 500, body: null, crashed: messageOf(error) };
      }
      return normalise(response);
    },

    /** How many queries the app has made since the last resetQueries(). */
    queries: () => log.length,

    resetQueries() {
      log.length = 0;
    },

    /** The queries the app has made since the last resetQueries(). */
    queryLog: () => log.map((entry) => ({ ...entry })),

    /**
     * Queries since the last resetQueries() that SQLite answered by reading a whole table of
     * at least `minRows` rows, rather than going to the rows it needed through an index.
     */
    fullScans(minRows = 0) {
      const found = [];
      for (const { sql, params } of log) {
        for (const table of scannedTables(raw, sql, params)) {
          const rows = countRows(raw, table);
          if (rows >= minRows) found.push({ table, rows, sql });
        }
      }
      return found;
    },

    /** Read-only views of the database, for tests about what is stored. */
    inspect: Object.freeze({
      tables: () => tableNames(raw),
      /** Every stored value as text, blobs decoded too, from every table. */
      storedText: () => storedText(raw),
    }),

    equal(actual, expected, what) {
      if (!Object.is(actual, expected)) {
        throw new TestFailure(`${what}: expected ${show(expected)}, got ${show(actual)}`);
      }
    },

    oneOf(actual, allowed, what) {
      if (!allowed.some((value) => Object.is(value, actual))) {
        throw new TestFailure(
          `${what}: expected one of ${allowed.map(show).join(", ")}, got ${show(actual)}`,
        );
      }
    },

    ok(value, what) {
      if (!value) throw new TestFailure(what);
    },
  };
  return Object.freeze(t);
}

/** Validate what the app returned and make it a plain, JSON-safe object. */
function normalise(response) {
  if (!response || typeof response !== "object") {
    return { status: 500, body: null, crashed: "handle() did not return a response object" };
  }
  const { status } = response;
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    return { status: 500, body: null, crashed: `handle() returned status ${show(status)}` };
  }
  let body = null;
  if (response.body !== undefined) {
    try {
      body = JSON.parse(JSON.stringify(response.body));
    } catch (error) {
      return { status: 500, body: null, crashed: `the response body is not JSON: ${messageOf(error)}` };
    }
  }
  return { status, body };
}

function scannedTables(raw, sql, params) {
  let statement;
  try {
    statement = raw.prepare(`EXPLAIN QUERY PLAN ${sql}`);
  } catch {
    // A query that does not prepare failed when the app ran it; that is not a scan.
    return [];
  }
  const tables = new Set(tableNames(raw));
  const scanned = [];
  try {
    if (params !== undefined && (Array.isArray(params) ? params.length : true)) {
      statement.bind(params);
    }
    while (statement.step()) {
      const { detail } = statement.getAsObject();
      // "SCAN notes", "SCAN notes USING INDEX ..." (a whole index, in order) and the older
      // "SCAN TABLE notes" all read every row. "SEARCH ..." goes to the rows it needs.
      const match = /^SCAN (?:TABLE )?(\w+)/.exec(String(detail));
      if (match && tables.has(match[1])) scanned.push(match[1]);
    }
  } finally {
    statement.free();
  }
  return scanned;
}

function tableNames(raw) {
  const result = raw.exec(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  return result.length ? result[0].values.map((row) => row[0]) : [];
}

function countRows(raw, table) {
  return raw.exec(`SELECT count(*) FROM "${table.replaceAll('"', '""')}"`)[0].values[0][0];
}

function storedText(raw) {
  const decoder = new TextDecoder();
  const values = [];
  for (const table of tableNames(raw)) {
    const result = raw.exec(`SELECT * FROM "${table.replaceAll('"', '""')}"`);
    if (!result.length) continue;
    for (const row of result[0].values) {
      for (const value of row) {
        if (typeof value === "string") values.push(value);
        else if (value instanceof Uint8Array) values.push(decoder.decode(value));
      }
    }
  }
  return values;
}

function show(value) {
  if (typeof value === "string") return JSON.stringify(value.length > 80 ? `${value.slice(0, 77)}...` : value);
  if (value === undefined) return "nothing";
  try {
    const text = JSON.stringify(value);
    return text.length > 80 ? `${text.slice(0, 77)}...` : text;
  } catch {
    return String(value);
  }
}

function messageOf(error) {
  return error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
}
