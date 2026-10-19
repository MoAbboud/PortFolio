// Plants every bug the mutation operators can find in a challenge's reference app, runs the
// hidden tests against each one, and reports which tests caught it:
//
//   node tools/mutate.mjs challenges/sample                  the report
//   node tools/mutate.mjs challenges/sample --out data/x.jsonl   also write the dataset rows
//   node tools/mutate.mjs challenges/sample --only uncap,drop-index
//
// The report is for the author: a mutant nothing catches is a gap in the hidden tests, or a
// change that makes no difference. The rows are the analyzer's training data: each mutated
// function with the categories the tests say it broke, beside the same function unbroken.
//
// Each mutant runs in its own Node process with a time limit, because a mutated loop can spin
// forever and nothing inside one process can stop a synchronous loop.

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { applyMutant, enclosingFunction, mutants, OPERATORS, parseApp } from "../analyzer/mutate.js";
import { readApp, readJson } from "./challenge.mjs";

const RUN = path.join(path.dirname(fileURLToPath(import.meta.url)), "run.mjs");
const TIMEOUT_MS = 120000;

/** Run the hidden tests against an app in a child process. `{ results }` or `{ timedOut }`. */
async function runIsolated(challengeDir, files) {
  const dir = await mkdtemp(path.join(tmpdir(), "cvc-mutant-"));
  try {
    for (const [name, text] of Object.entries(files)) await writeFile(path.join(dir, name), text);
    return await new Promise((resolve, reject) => {
      execFile(process.execPath, [RUN, challengeDir, dir, "--json"], { timeout: TIMEOUT_MS, maxBuffer: 64 << 20 }, (error, stdout) => {
        if (error?.killed) return resolve({ timedOut: true });
        if (error) return reject(error);
        resolve({ results: JSON.parse(stdout).results });
      });
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function pool(items, size, work) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await work(items[i], i);
      }
    }),
  );
  return results;
}

/**
 * Every mutant of a challenge's reference, run against the hidden tests.
 * Returns `{ challenge, mutants: [{ ...mutant, caughtBy, labels, status }] }`, status being
 * "caught", "survived" or "timeout".
 */
export async function labelMutants(challengeDir, { only, concurrency = Math.max(1, availableParallelism() - 1), onProgress } = {}) {
  const meta = await readJson(path.join(challengeDir, "challenge.json"));
  const files = await readApp(path.join(challengeDir, "hidden/reference"), meta.files);
  const found = mutants(files).filter((m) => !only || only.includes(m.operator));
  let done = 0;
  const labelled = await pool(found, concurrency, async (mutant) => {
    const outcome = await runIsolated(challengeDir, applyMutant(files, mutant));
    onProgress?.(++done, found.length);
    if (outcome.timedOut) return { ...mutant, status: "timeout", caughtBy: [], labels: [] };
    const failed = outcome.results.filter((r) => r.status === "fail");
    return {
      ...mutant,
      status: failed.length ? "caught" : "survived",
      caughtBy: failed.map((r) => r.id),
      labels: [...new Set(failed.map((r) => r.category))].sort(),
    };
  });
  return { challenge: meta, files, mutants: labelled };
}

/**
 * Dataset rows: for each mutant of app.js, the function it sits in before and after, and the
 * categories the tests say it broke; and each function of the reference once, unbroken.
 * Mutants that survived or timed out are kept but marked, so training can leave them out.
 */
export function datasetRows({ challenge, files, mutants: labelled }) {
  const source = `challenge:${challenge.id}@${challenge.version}`;
  const app = files["app.js"];
  const rows = [];
  for (const statement of parseApp(app).body) {
    const window = enclosingFunction(app, statement.start);
    if (window.name) rows.push({ kind: "clean", source, function: window.name, code: app.slice(window.start, window.end), labels: [] });
  }
  for (const m of labelled) {
    const row = { kind: "mutant", source, mutant: m.id, operator: m.operator, declared: m.category, file: m.file, line: m.line, status: m.status, caught_by: m.caughtBy, labels: m.labels };
    if (m.file === "app.js") {
      const window = enclosingFunction(app, m.start);
      const shift = m.replacement.length - (m.end - m.start);
      const mutated = applyMutant(files, m)["app.js"];
      row.function = window.name;
      row.before = app.slice(window.start, window.end);
      row.code = mutated.slice(window.start, window.end + shift);
    } else {
      row.before = files[m.file];
      row.code = applyMutant(files, m)[m.file];
    }
    rows.push(row);
  }
  return rows;
}

function report({ challenge, mutants: labelled }) {
  const lines = [];
  const scored = labelled.filter((m) => m.status !== "timeout");
  const caught = scored.filter((m) => m.status === "caught").length;
  lines.push(`${challenge.id}: ${labelled.length} mutants, ${caught} caught, ${scored.length - caught} survived, ${labelled.length - scored.length} timed out`);
  lines.push(`mutation score ${(100 * caught / Math.max(1, scored.length)).toFixed(0)}% - how much of what can go wrong the hidden tests notice`);
  lines.push("");
  lines.push("operator          mutants  caught  declared       categories the tests saw");
  for (const operator of Object.keys(OPERATORS)) {
    const mine = labelled.filter((m) => m.operator === operator);
    if (!mine.length) continue;
    const seen = [...new Set(mine.flatMap((m) => m.labels))].sort().join(", ") || "-";
    lines.push(`${operator.padEnd(17)} ${String(mine.length).padStart(7)} ${String(mine.filter((m) => m.status === "caught").length).padStart(7)}  ${OPERATORS[operator].category.padEnd(13)}  ${seen}`);
  }
  const survivors = labelled.filter((m) => m.status !== "caught");
  if (survivors.length) {
    lines.push("");
    lines.push("Not caught - a gap in the hidden tests, or a change that makes no difference:");
    for (const m of survivors) lines.push(`  ${m.status === "timeout" ? "TIMEOUT " : ""}${m.id}: ${JSON.stringify(m.replacement.slice(0, 70))}`);
  }
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--out" && args[args.indexOf(a) - 1] !== "--only");
  if (!dir) {
    console.error("usage: node tools/mutate.mjs <challenge folder> [--out rows.jsonl] [--only op1,op2]");
    process.exit(2);
  }
  const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
  const started = Date.now();
  const labelled = await labelMutants(path.resolve(dir), {
    only,
    onProgress: (n, total) => process.stderr.write(`\r  ${n}/${total} mutants run`),
  });
  process.stderr.write("\n");
  console.log(report(labelled));
  if (out) {
    const rows = datasetRows(labelled);
    await mkdir(path.dirname(path.resolve(out)), { recursive: true });
    await writeFile(out, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    console.log(`\n${rows.length} rows written to ${out}`);
  }
  console.log(`(${((Date.now() - started) / 1000).toFixed(0)} s)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
