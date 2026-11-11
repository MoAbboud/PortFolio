// The judge's entry point, inside the sandbox container:
//
//   node --frozen-intrinsics --permission --allow-fs-read=/judge --allow-fs-read=/work \
//        /judge/judge/entry.mjs <hidden|house> /work/challenge /work/app
//
// The container keeps a submission away from the server: no network, read-only, no privileges,
// limits on memory, processes and time. This file keeps it away from its own score, because the
// app runs in the same process as the tests that grade it:
//
// - Node's frozen intrinsics stop it changing built-ins (Object.is, String.prototype.includes, a
//   toJSON on Array.prototype) that the tests rely on.
// - lockGlobals() stops it replacing a global outright (globalThis.JSON = ...), which frozen
//   intrinsics do not cover.
// - Node's permission model refuses child processes, workers, file writes and reads outside
//   /judge and /work.
// - The result is written with a writeSync captured before any submitted code exists, behind a
//   nonce that arrives on stdin and lives only in this module's scope - not in argv, the
//   environment or a file. Anything the app prints without it is ignored.

import { readSync, writeSync } from "node:fs";

const write = writeSync;
const stringify = JSON.stringify;
const nonce = readNonce();
lockGlobals();

const [kind, challengeDir, appDir] = process.argv.slice(2);
const { loadModuleArray, loadTests, readApp, readJson, runOnApp } = await import("../tools/challenge.mjs");

let results;
try {
  const meta = await readJson(`${challengeDir}/challenge.json`);
  const tests =
    kind === "house"
      ? await loadModuleArray(`${challengeDir}/hidden/house-findings.js`)
      : await loadTests(`${challengeDir}/hidden/tests`);
  const files = await readApp(appDir, meta.files);
  results = await runOnApp(files, tests);
} catch (error) {
  report({ error: String(error && error.message ? error.message : error) });
  process.exit(0);
}
report({ results });
// Exit now: a submission can leave timers or open handles that would keep the process alive.
process.exit(0);

/** One line: the nonce, a space, the JSON. Built from strings only, so no toJSON can run. */
function report(value) {
  let body;
  if (value.error !== undefined) {
    body = `{"error":${stringify(value.error)}}`;
  } else {
    const rows = [];
    for (let i = 0; i < value.results.length; i++) {
      const r = value.results[i];
      rows[rows.length] =
        `{"id":${stringify(String(r.id))},"category":${stringify(String(r.category))},` +
        `"requirement":${r.requirement === null ? "null" : stringify(String(r.requirement))},` +
        `"status":${stringify(String(r.status))},"message":${stringify(String(r.message))}}`;
    }
    body = `{"results":[${rows.join(",")}]}`;
  }
  write(1, `\n${nonce} ${body}\n`);
}

/** The first line on stdin. The worker writes it and closes stdin; the app never sees it. */
function readNonce() {
  const buffer = Buffer.alloc(256);
  let text = "";
  for (;;) {
    let n;
    try {
      n = readSync(0, buffer, 0, buffer.length, null);
    } catch (error) {
      if (error.code === "EAGAIN") continue;
      if (error.code === "EOF") break;
      throw error;
    }
    if (n === 0) break;
    text += buffer.toString("utf8", 0, n);
    if (text.includes("\n")) break;
  }
  const value = text.split("\n")[0].trim();
  if (!/^[0-9a-f]{32}$/.test(value)) {
    write(2, "judge: no nonce on stdin\n");
    process.exit(2);
  }
  return value;
}

/**
 * Make every global binding read-only and non-configurable. Node defines some globals lazily
 * (an accessor that replaces itself on first use), so each one is read first.
 */
function lockGlobals() {
  for (const key of Reflect.ownKeys(globalThis)) {
    try {
      void globalThis[key];
    } catch {
      // A global that throws on access is left as it is.
    }
  }
  for (const key of Reflect.ownKeys(globalThis)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    if (!descriptor || !descriptor.configurable) continue;
    if ("value" in descriptor) descriptor.writable = false;
    descriptor.configurable = false;
    try {
      Object.defineProperty(globalThis, key, descriptor);
    } catch {
      // Left as it is; frozen intrinsics still protect what it points to.
    }
  }
}
