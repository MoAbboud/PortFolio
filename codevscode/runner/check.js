// The problems a player sees the moment their app runs: it does not load, its schema does not
// run, it has no handle(), or it crashes on a plain request. The workspace shows these as soon
// as the files change, and the harness feeds them back to a helper the way a player would -
// never anything from the hidden tests.
//
// Shared by the browser and Node: nothing here may import a Node module.

import { wrapDatabase } from "./db.js";
import { EPOCH } from "./runner.js";

/** Requests that any app should answer without crashing, whatever it does with them. */
const PROBES = [
  { method: "GET", path: "/" },
  { method: "POST", path: "/", body: "{}" },
];

/**
 * Problems with an app, as sentences, or an empty list when it loads and answers.
 * `loadApp` and `schema` are as for runTests.
 */
export async function checkApp({ SQL, loadApp, schema }) {
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
    const problems = [];
    for (const probe of PROBES) {
      const request = Object.freeze({ query: {}, headers: {}, body: "", time: EPOCH, ...probe });
      try {
        const response = await app.handle(request, db);
        if (!response || !Number.isInteger(response.status)) {
          problems.push(`handle() answered ${probe.method} ${probe.path} without a { status, body } object.`);
        }
      } catch (error) {
        problems.push(`handle() crashed on ${probe.method} ${probe.path}: ${messageOf(error)}`);
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
