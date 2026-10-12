import assert from "node:assert/strict";
import { test } from "node:test";

import { buildMessages, condenseReply } from "../helper/prompt.js";
import { parseReply } from "../helper/reply.js";

const ALLOWED = ["app.js", "schema.sql", "index.html"];
const FILES = { "app.js": "export async function handle() {}\n", "schema.sql": "-- empty\n" };

function messages(overrides = {}) {
  return buildMessages({
    name: "Pixel",
    brief: "Keep notes.",
    iface: "POST /notes",
    files: FILES,
    message: "Build it.",
    ...overrides,
  });
}

test("the system message carries the name, brief, interface, revealed answers and every file whole", () => {
  const [system, user] = messages({ revealed: ["Newest first, please."] });
  assert.equal(system.role, "system");
  assert.match(system.content, /^You are Pixel, a coding helper/);
  assert.match(system.content, /## The brief\nKeep notes\./);
  assert.match(system.content, /## The interface\nPOST \/notes/);
  assert.match(system.content, /- Newest first, please\./);
  assert.match(system.content, /```js\n\/\/ file: app\.js\nexport async function handle\(\) \{\}\n```/);
  assert.match(system.content, /```sql\n-- file: schema\.sql\n-- empty\n```/);
  assert.match(system.content, /The files are: app\.js, schema\.sql\./);
  assert.deepEqual(user, { role: "user", content: "Build it." });
});

test("with nothing revealed, the helper is told so", () => {
  assert.match(messages()[0].content, /## What the client has told the player\nNothing yet\./);
});

test("history is trimmed oldest first to the budget, and never opens with the helper", () => {
  const history = [
    { role: "user", content: "a".repeat(4000) },
    { role: "assistant", content: "b".repeat(4000) },
    { role: "user", content: "c".repeat(400) },
    { role: "assistant", content: "d".repeat(400) },
  ];
  const all = messages({ history, budgetTokens: 100000 });
  assert.equal(all.length, 6);
  const trimmed = messages({ history, budgetTokens: 1200 });
  // Room for the last two turns only (about 4,800 characters less the system message).
  assert.deepEqual(trimmed.slice(1, -1).map((m) => m.content[0]), ["c", "d"]);
  const lopsided = messages({ history: history.slice(1), budgetTokens: 100000 });
  assert.equal(lopsided[1].role, "user", "a leading assistant turn is dropped");
});

test("a reply in the asked-for format gives its files, without the marker lines", () => {
  const reply = "Here you go.\n\n```js\n// file: app.js\nexport const a = 1;\n```\n\n```sql\n-- file: schema.sql\nCREATE TABLE t (x);\n```\nDone.";
  const { files, prose, skipped } = parseReply(reply, ALLOWED);
  assert.deepEqual(files, { "app.js": "export const a = 1;\n", "schema.sql": "CREATE TABLE t (x);\n" });
  assert.deepEqual(skipped, []);
  assert.equal(prose, "Here you go.\n\n[app.js]\n\n[schema.sql]\nDone.");
});

test("files named in the fence, on the line before, or only by language are all found", () => {
  const reply = [
    "```javascript app.js",
    "one",
    "```",
    "**schema.sql**",
    "```sql",
    "two",
    "```",
    "And the page:",
    "```html",
    "three",
    "```",
  ].join("\n");
  assert.deepEqual(parseReply(reply, ALLOWED).files, { "app.js": "one\n", "schema.sql": "two\n", "index.html": "three\n" });
});

test("a file that is not allowed is skipped and listed; the later of two blocks wins", () => {
  const reply = "```js\n// file: server.js\nnope\n```\n```js\n// file: app.js\nfirst\n```\n```js\n// file: app.js\nsecond\n```";
  const { files, skipped } = parseReply(reply, ALLOWED);
  assert.deepEqual(files, { "app.js": "second\n" });
  assert.deepEqual(skipped, ["server.js"]);
});

test("a reply with no code gives no files", () => {
  assert.deepEqual(parseReply("I would need to know more about the brief.", ALLOWED).files, {});
});

test("a condensed reply keeps the prose and notes which files were written", () => {
  const reply = "Added search.\n```js\n// file: app.js\nlots of code\n```\nTry it.";
  assert.equal(condenseReply(reply), "Added search.\n[wrote app.js]\nTry it.");
});
