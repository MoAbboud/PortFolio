// The problems a player sees the moment their app runs: it does not load, its schema does not
// run, it has no handle(), or it crashes - on a plain request, or while the player uses it the
// way the interface describes (the challenge's public walk-through, smoke.json). The workspace
// shows these as soon as the files change, and the harness feeds them back to a helper the way
// a player would. Only crashes are reported, never whether an answer was right: that is what
// the hidden tests are for, and they stay hidden.
//
// Shared by the browser and Node: nothing here may import a Node module.

import { wrapDatabase } from "./db.js";
import { EPOCH, STEP_MS } from "./runner.js";

/** Requests that any app should answer without crashing, whatever it does with them. */
const PROBES = [
  { method: "GET", path: "/" },
  { method: "POST", path: "/", body: {} },
];

/**
 * Problems with an app, as sentences, or an empty list when it loads and answers.
 * `loadApp` and `schema` are as for runTests. `smoke`, when given, is the challenge's
 * walk-through: `{ steps: [{ method, path, body, auth, keep }] }`. A step's path may use
 * `{name}` for a value kept from an earlier answer (`keep: { name: "field" }`), and `auth`
 * sends the kept `token` as a bearer token.
 */
export async function checkApp({ SQL, loadApp, schema, smoke }) {
  const raw = new SQL.Database();
  try {
    try {
      raw.exec(schema);
    } catch (error) {
      return [`schema.sql does not run: ${messageOf(error)}`];
    }
    let app;
    try {
      app = await loadApp();
    } catch (error) {
      return [`app.js does not load: ${messageOf(error)}`];
    }
    if (!app || typeof app.handle !== "function") return ["app.js does not export a function called handle."];
    const { db } = wrapDatabase(raw);
    let clock = EPOCH;
    const kept = {};
    const problems = [];
    const steps = [...PROBES, ...(smoke?.steps ?? [])];
    for (const step of steps) {
      const path = step.path.replace(/\{(\w+)\}/g, (_, name) => String(kept[name] ?? name));
      const headers = step.auth && kept.token !== undefined ? { authorization: `Bearer ${kept.token}` } : {};
      clock += STEP_MS;
      const request = Object.freeze({
        method: step.method,
        path,
        query: {},
        headers,
        body: step.body === undefined ? "" : JSON.stringify(step.body),
        time: clock,
      });
      let response;
      try {
        response = await app.handle(request, db);
      } catch (error) {
        problems.push(`${step.method} ${path} crashed: ${messageOf(error)}`);
        continue;
      }
      if (!response || !Number.isInteger(response.status)) {
        problems.push(`handle() answered ${step.method} ${path} without a { status, body } object.`);
        continue;
      }
      for (const [name, field] of Object.entries(step.keep ?? {})) {
        const value = response.body?.[field];
        if (value !== undefined) kept[name] = value;
      }
    }
    return problems;
  } finally {
    raw.close();
  }
}

function messageOf(error) {
  return error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
}
