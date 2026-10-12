import assert from "node:assert/strict";
import { test } from "node:test";

import { applyEdits } from "../runner/edits.js";
import { checkAppSource } from "../runner/source.js";

const HANDLE = "export async function handle(request, db) { return { status: 200 }; }";

test("an app that imports nothing passes", () => {
  assert.deepEqual(checkAppSource(HANDLE), []);
});

test("imports and require are refused, in every form", () => {
  const forms = [
    `import fs from "node:fs";`,
    `import { readFile } from "node:fs/promises";`,
    `import * as os from "os";`,
    `import "./side-effect.js";`,
    `const fs = await import("node:fs");`,
    `const fs = require("fs");`,
  ];
  for (const line of forms) {
    assert.notDeepEqual(checkAppSource(`${line}\n${HANDLE}`), [], line);
  }
});

test("the word import inside a comment or a string is not an import", () => {
  const source = `// import fs from "node:fs"
/* require("fs") */
const message = "import this, require that";
const other = 'import("x")';
const t = \`import x from "y"\`;
${HANDLE}`;
  assert.deepEqual(checkAppSource(source), []);
});

test("edits replace text found exactly once, and leave the input alone", () => {
  const files = { "app.js": "a = 1; b = 2;" };
  const edited = applyEdits(files, [{ file: "app.js", find: "b = 2", replace: "b = 3" }]);
  assert.equal(edited["app.js"], "a = 1; b = 3;");
  assert.equal(files["app.js"], "a = 1; b = 2;");
});

test("an edit whose text is missing, repeated, or in an unknown file is refused", () => {
  const files = { "app.js": "x x" };
  assert.throws(() => applyEdits(files, [{ file: "app.js", find: "y", replace: "" }]), /found it 0 times/);
  assert.throws(() => applyEdits(files, [{ file: "app.js", find: "x", replace: "" }]), /found it 2 times/);
  assert.throws(() => applyEdits(files, [{ file: "schema.sql", find: "x", replace: "" }]), /not one of the app's files/);
});

test("a replacement containing $ patterns is inserted literally", () => {
  const edited = applyEdits({ "app.js": "A" }, [{ file: "app.js", find: "A", replace: "`${q}` $& $1" }]);
  assert.equal(edited["app.js"], "`${q}` $& $1");
});
