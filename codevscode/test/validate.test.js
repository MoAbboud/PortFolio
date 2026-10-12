import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { validateChallenge } from "../tools/validate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.join(HERE, "..", "challenges", "sample");
const TINY = path.join(HERE, "fixtures", "tiny");

const copies = [];
after(() => Promise.all(copies.map((dir) => rm(dir, { recursive: true, force: true }))));

/** A copy of the tiny fixture, changed by `change(dir)`, then validated. */
async function validateChanged(change) {
  const dir = await mkdtemp(path.join(tmpdir(), "codevscode-"));
  copies.push(dir);
  await cp(TINY, dir, { recursive: true });
  await change(dir);
  return validateChallenge(dir);
}

async function editJson(file, change) {
  const value = JSON.parse(await readFile(file, "utf8"));
  change(value);
  await writeFile(file, JSON.stringify(value));
}

async function replaceIn(file, find, replace) {
  const text = await readFile(file, "utf8");
  assert.ok(text.includes(find), `${find} should be in ${file}`);
  await writeFile(file, text.replace(find, replace));
}

test("the sample challenge is valid: the reference passes everything, every bug fails exactly its tests", async () => {
  const { errors, notes } = await validateChallenge(SAMPLE);
  assert.deepEqual(errors, []);
  assert.ok(notes.includes("starter: 0 of 40 tests pass"), notes.join("\n"));
  assert.equal(notes.filter((note) => note.startsWith("bug ")).length, 6);
});

test("the tiny fixture is valid", async () => {
  assert.deepEqual((await validateChallenge(TINY)).errors, []);
});

test("a bug that fails fewer tests than it lists is caught", async () => {
  const { errors } = await validateChanged((dir) =>
    editJson(path.join(dir, "hidden/bugs.json"), (bugs) => bugs[0].fails.push("correctness/add-and-list")),
  );
  assert.deepEqual(errors, ["bug uncapped: should fail correctness/add-and-list but passes"]);
});

test("a bug that breaks more than it lists is caught", async () => {
  const { errors } = await validateChanged((dir) =>
    editJson(path.join(dir, "hidden/bugs.json"), (bugs) => {
      bugs[0].edits.push({ file: "app.js", find: 'return { status: 400, body: { error: "Send JSON." } };', replace: "throw new Error('x');" });
    }),
  );
  assert.deepEqual(errors, ["bug uncapped: also fails practicality/bad-json, which it does not list"]);
});

test("a reference that fails a test is caught", async () => {
  const { errors } = await validateChanged((dir) =>
    replaceIn(path.join(dir, "hidden/reference/app.js"), "status: 201", "status: 200"),
  );
  // The bug is applied to the broken reference too, so it reports an extra failure as well.
  assert.ok(
    errors.includes("reference fails correctness/add-and-list: adding: expected 201, got 200"),
    errors.join("\n"),
  );
});

test("a house finding the reference fails is caught", async () => {
  const { errors } = await validateChanged((dir) =>
    replaceIn(path.join(dir, "hidden/house-findings.js"), "status, 400", "status, 201"),
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^house finding house\/empty-word fails on the reference/);
});

test("a requirement with too few phrasings, or tests that do not point back to it, is caught", async () => {
  const { errors } = await validateChanged(async (dir) => {
    await editJson(path.join(dir, "hidden/requirements.json"), (requirements) => {
      requirements[0].phrasings.pop();
      requirements[0].tests = ["practicality/bad-json"];
    });
  });
  assert.deepEqual(errors, [
    "requirement cap: needs at least 3 phrasings of the question that unlocks it, has 2",
    'requirement cap: lists test practicality/bad-json, but that test says its requirement is null',
    "requirement cap: test efficiency/capped checks it but is not in its tests list",
  ]);
});

test("a test whose id does not start with its category, or names a missing requirement, is caught", async () => {
  const { errors } = await validateChanged(async (dir) => {
    await replaceIn(path.join(dir, "hidden/tests/all.js"), 'id: "security/no-injection"', 'id: "safety/no-injection"');
    await replaceIn(path.join(dir, "hidden/tests/all.js"), 'requirement: "cap"', 'requirement: "nope"');
  });
  assert.ok(errors.includes('test safety/no-injection: the id must start with its category, "security/"'), errors.join("\n"));
  assert.ok(errors.some((e) => e.startsWith('test efficiency/capped: requirement "nope" is not in requirements.json')), errors.join("\n"));
});

test("a split other than train or held_out is caught", async () => {
  const { errors } = await validateChanged((dir) =>
    editJson(path.join(dir, "challenge.json"), (meta) => {
      meta.split = "test";
    }),
  );
  assert.deepEqual(errors, ["challenge.json: split must be one of train, held_out"]);
});

test("a missing file is named", async () => {
  const { errors } = await validateChanged((dir) => rm(path.join(dir, "hidden/bugs.json")));
  assert.deepEqual(errors, ["missing hidden/bugs.json"]);
});

test("a script that reveals an unknown requirement is caught", async () => {
  const { errors } = await validateChanged((dir) =>
    editJson(path.join(dir, "hidden/scripts/one.json"), (script) => {
      script.revealed = ["cap", "ghost"];
    }),
  );
  assert.deepEqual(errors, ["script one.json: reveals ghost, which is not a requirement"]);
});
