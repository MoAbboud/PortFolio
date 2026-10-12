// Checks a challenge is complete and consistent before anyone plays it:
//
//   node tools/validate.mjs challenges/sample
//
// - every file the format needs is there, and every id points at something real;
// - the reference app passes every hidden test and every house finding;
// - each planted bug, applied to the reference, fails exactly the tests it says it fails -
//   no fewer (the tests would miss it) and no more (it would break something else too).
//
// Exits 1 if anything is wrong. Also exported for test/validate.test.js.

import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { CATEGORIES } from "../runner/runner.js";
import { applyEdits } from "../runner/edits.js";
import { loadModuleArray, loadTests, readApp, readJson, runOnApp } from "./challenge.mjs";

const SPLITS = ["train", "held_out"];
const MIN_PHRASINGS = 3;

/** Validate one challenge folder. Returns `{ errors, notes }`, both lists of sentences. */
export async function validateChallenge(dir) {
  const errors = [];
  const notes = [];
  const fail = (message) => errors.push(message);

  // challenge.json
  let meta;
  try {
    meta = await readJson(path.join(dir, "challenge.json"));
  } catch (error) {
    return { errors: [`challenge.json: ${error.message}`], notes };
  }
  if (typeof meta.id !== "string" || !meta.id) fail("challenge.json: id must be a non-empty string");
  if (!Number.isInteger(meta.version) || meta.version < 1) fail("challenge.json: version must be a whole number from 1");
  if (typeof meta.title !== "string" || !meta.title) fail("challenge.json: title is missing");
  if (!(meta.time_limit_minutes > 0)) fail("challenge.json: time_limit_minutes must be above 0");
  if (!SPLITS.includes(meta.split)) fail(`challenge.json: split must be one of ${SPLITS.join(", ")}`);
  if (meta.public === true && meta.split === "held_out") {
    fail("challenge.json: a public challenge cannot be held out - its hidden half is readable by anyone, a model's training data included");
  }
  const files = Array.isArray(meta.files) ? meta.files : [];
  for (const name of ["app.js", "schema.sql"]) {
    if (!files.includes(name)) fail(`challenge.json: files must include ${name}`);
  }
  for (const category of CATEGORIES) {
    if (typeof meta.weights?.[category] !== "number") fail(`challenge.json: weights.${category} must be a number`);
  }

  // Files the format needs.
  const required = [
    "public/brief.md",
    "public/interface.md",
    ...files.map((name) => `public/starter/${name}`),
    "hidden/requirements.json",
    ...files.map((name) => `hidden/reference/${name}`),
    "hidden/tests",
    "hidden/bugs.json",
    "hidden/house-findings.js",
    "hidden/scripts",
  ];
  for (const relative of required) {
    try {
      await access(path.join(dir, relative));
    } catch {
      fail(`missing ${relative}`);
    }
  }
  if (errors.length) return { errors, notes };

  // Tests.
  const tests = await loadTests(path.join(dir, "hidden/tests"));
  const requirements = await readJson(path.join(dir, "hidden/requirements.json"));
  const requirementIds = new Set(requirements.map((r) => r.id));
  const testIds = new Map();
  for (const test of tests) {
    const label = `test ${test.id ?? "(no id)"}`;
    if (typeof test.id !== "string") fail(`${label}: id must be a string`);
    else if (testIds.has(test.id)) fail(`${label}: the id is used twice`);
    else testIds.set(test.id, test);
    if (!CATEGORIES.includes(test.category)) fail(`${label}: category must be one of ${CATEGORIES.join(", ")}`);
    else if (typeof test.id === "string" && !test.id.startsWith(`${test.category}/`)) {
      fail(`${label}: the id must start with its category, "${test.category}/"`);
    }
    if (test.requirement !== null && !requirementIds.has(test.requirement)) {
      fail(`${label}: requirement ${JSON.stringify(test.requirement)} is not in requirements.json (use null for a checklist test)`);
    }
    if (typeof test.title !== "string" || !test.title) fail(`${label}: title is missing`);
    if (typeof test.run !== "function") fail(`${label}: run must be a function`);
  }
  for (const category of CATEGORIES) {
    if (!tests.some((test) => test.category === category)) fail(`no ${category} tests`);
  }

  // Hidden requirements.
  const seen = new Set();
  for (const requirement of requirements) {
    const label = `requirement ${requirement.id ?? "(no id)"}`;
    if (typeof requirement.id !== "string" || !requirement.id) fail(`${label}: id must be a string`);
    if (seen.has(requirement.id)) fail(`${label}: the id is used twice`);
    seen.add(requirement.id);
    if (!CATEGORIES.includes(requirement.category)) fail(`${label}: category must be one of ${CATEGORIES.join(", ")}`);
    const phrasings = Array.isArray(requirement.phrasings) ? requirement.phrasings : [];
    if (phrasings.length < MIN_PHRASINGS) {
      fail(`${label}: needs at least ${MIN_PHRASINGS} phrasings of the question that unlocks it, has ${phrasings.length}`);
    }
    if (typeof requirement.answer !== "string" || !requirement.answer.trim()) fail(`${label}: answer is missing`);
    const listed = Array.isArray(requirement.tests) ? requirement.tests : [];
    if (!listed.length) fail(`${label}: no tests check it`);
    for (const id of listed) {
      const test = testIds.get(id);
      if (!test) fail(`${label}: lists test ${id}, which does not exist`);
      else if (test.requirement !== requirement.id) fail(`${label}: lists test ${id}, but that test says its requirement is ${JSON.stringify(test.requirement)}`);
    }
    for (const test of tests) {
      if (test.requirement === requirement.id && !listed.includes(test.id)) {
        fail(`${label}: test ${test.id} checks it but is not in its tests list`);
      }
    }
  }
  if (errors.length) return { errors, notes };

  // The reference passes everything.
  const reference = await readApp(path.join(dir, "hidden/reference"), files);
  const referenceResults = await runOnApp(reference, tests);
  const referenceFailures = referenceResults.filter((r) => r.status === "fail");
  for (const result of referenceFailures) fail(`reference fails ${result.id}: ${result.message}`);
  notes.push(`reference: ${referenceResults.length - referenceFailures.length} of ${referenceResults.length} tests pass`);

  // Each planted bug fails exactly what it says.
  const bugs = await readJson(path.join(dir, "hidden/bugs.json"));
  const bugIds = new Set();
  for (const bug of bugs) {
    const label = `bug ${bug.id ?? "(no id)"}`;
    if (typeof bug.id !== "string" || bugIds.has(bug.id)) fail(`${label}: needs a unique id`);
    bugIds.add(bug.id);
    if (!CATEGORIES.includes(bug.category)) fail(`${label}: category must be one of ${CATEGORIES.join(", ")}`);
    if (typeof bug.title !== "string" || !bug.title) fail(`${label}: title is missing`);
    const expected = Array.isArray(bug.fails) ? bug.fails : [];
    if (!expected.length) fail(`${label}: fails must list at least one test - a bug no test catches cannot be found by anyone`);
    for (const id of expected) if (!testIds.has(id)) fail(`${label}: fails lists ${id}, which does not exist`);
    let planted;
    try {
      planted = applyEdits(reference, bug.edits ?? []);
    } catch (error) {
      fail(`${label}: ${error.message}`);
      continue;
    }
    const results = await runOnApp(planted, tests);
    const actual = results.filter((r) => r.status === "fail").map((r) => r.id).sort();
    const want = [...expected].sort();
    const missed = want.filter((id) => !actual.includes(id));
    const extra = actual.filter((id) => !want.includes(id));
    if (missed.length) fail(`${label}: should fail ${missed.join(", ")} but passes`);
    if (extra.length) fail(`${label}: also fails ${extra.join(", ")}, which it does not list`);
    if (!missed.length && !extra.length) notes.push(`${label}: fails exactly ${actual.join(", ")}`);
  }

  // House findings pass on the reference.
  const findings = await loadModuleArray(path.join(dir, "hidden/house-findings.js"));
  const findingIds = new Set();
  for (const finding of findings) {
    const label = `house finding ${finding.id ?? "(no id)"}`;
    if (typeof finding.id !== "string" || !finding.id.startsWith("house/") || findingIds.has(finding.id)) {
      fail(`${label}: needs a unique id starting "house/"`);
    }
    findingIds.add(finding.id);
    if (!CATEGORIES.includes(finding.category)) fail(`${label}: category must be one of ${CATEGORIES.join(", ")}`);
    if (typeof finding.claim !== "string" || !finding.claim) fail(`${label}: claim is missing`);
    if (typeof finding.run !== "function") fail(`${label}: run must be a function`);
  }
  const findingResults = await runOnApp(reference, findings);
  for (const result of findingResults) {
    if (result.status === "fail") fail(`house finding ${result.id} fails on the reference, so it claims something the challenge does not ask for: ${result.message}`);
  }
  notes.push(`house findings: ${findings.length}, all checked against the reference`);

  // Scripted conversations for the harness.
  const scriptDir = path.join(dir, "hidden/scripts");
  const scripts = (await readdir(scriptDir)).filter((name) => name.endsWith(".json"));
  if (!scripts.length) fail("hidden/scripts: no scripted conversations");
  for (const name of scripts) {
    const script = await readJson(path.join(scriptDir, name));
    const label = `script ${name}`;
    if (`${script.id}.json` !== name) fail(`${label}: id must match the file name`);
    if (!Array.isArray(script.messages) || !script.messages.length || !script.messages.every((m) => typeof m === "string" && m.trim())) {
      fail(`${label}: messages must be a non-empty list of non-empty strings`);
    }
    for (const id of script.revealed ?? []) {
      if (!requirementIds.has(id)) fail(`${label}: reveals ${id}, which is not a requirement`);
    }
  }

  // The starter, for information: it should pass almost nothing.
  const starter = await readApp(path.join(dir, "public/starter"), files);
  const starterResults = await runOnApp(starter, tests);
  const starterPasses = starterResults.filter((r) => r.status === "pass").length;
  notes.push(`starter: ${starterPasses} of ${starterResults.length} tests pass`);

  return { errors, notes };
}

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node tools/validate.mjs <challenge folder>");
    process.exit(2);
  }
  const started = Date.now();
  const { errors, notes } = await validateChallenge(path.resolve(dir));
  for (const note of notes) console.log(`  ${note}`);
  for (const error of errors) console.error(`  ERROR ${error}`);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (errors.length) {
    console.error(`${dir}: ${errors.length} problem(s) (${seconds} s)`);
    process.exit(1);
  }
  console.log(`${dir}: valid (${seconds} s)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
