import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { BRIDGE, previewDocument, toRequest } from "../web/bridge.js";
import { escapeHtml, renderMarkdown } from "../web/markdown.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("markdown: headings shift down a level, paragraphs, lists, bold and code", () => {
  const html = renderMarkdown("# Team notes\n\nHi! We **need** `notes`.\n\n- one\n- two\n  continued");
  assert.equal(html, "<h2>Team notes</h2>\n<p>Hi! We <strong>need</strong> <code>notes</code>.</p>\n<ul><li>one</li><li>two continued</li></ul>");
});

test("markdown: tables and fenced code", () => {
  const html = renderMarkdown("| A | B |\n| --- | --- |\n| `x` | y |\n\n```\nconst a = 1 < 2;\n```");
  assert.equal(html, '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td><code>x</code></td><td>y</td></tr></tbody></table>\n<pre><code>const a = 1 &lt; 2;</code></pre>');
});

test("markdown: nothing in a challenge file can become markup", () => {
  const html = renderMarkdown('<script>alert(1)</script> **<img src=x onerror=alert(1)>** `<b>`');
  assert.ok(!/<script|<img|<b>/.test(html), html);
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});

test("the sample's brief and interface render without leaving any raw markdown table or fence", async () => {
  for (const name of ["brief.md", "interface.md"]) {
    const html = renderMarkdown(await readFile(path.join(ROOT, "challenges/sample/public", name), "utf8"));
    assert.ok(!html.includes("```") && !html.includes("| ---"), name);
  }
});

test("the bridge goes in at the top of the head, or the top of the page", () => {
  const withHead = previewDocument('<!doctype html><html><head><meta charset="utf-8"><script>early()</script></head></html>');
  assert.ok(withHead.indexOf(BRIDGE) < withHead.indexOf("early()"));
  assert.ok(withHead.startsWith('<!doctype html><html><head><script>'));
  assert.ok(previewDocument("<p>no head</p>").startsWith(BRIDGE));
  assert.ok(previewDocument("").startsWith(BRIDGE));
});

test("a bridge message becomes the same request shape the runner uses", () => {
  const request = toRequest(
    { url: "/notes?limit=5&q=a%20b", method: "post", headers: { Authorization: "Bearer t", "Content-Type": "application/json" }, body: '{"x":1}' },
    1234,
  );
  assert.deepEqual(request, {
    method: "POST",
    path: "/notes",
    query: { limit: "5", q: "a b" },
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: '{"x":1}',
    time: 1234,
  });
  assert.deepEqual(toRequest({ url: "http://anything.example/signup" }, 1), { method: "GET", path: "/signup", query: {}, headers: {}, body: "", time: 1 });
});

test("the vendored sql.js is byte for byte the version the judge runs", async () => {
  for (const name of ["sql-wasm-browser.js", "sql-wasm-browser.wasm"]) {
    const vendored = await readFile(path.join(ROOT, "web/vendor", name));
    const installed = await readFile(path.join(ROOT, "node_modules/sql.js/dist", name));
    assert.ok(vendored.equals(installed), `${name} differs from node_modules - copy it again (web/vendor/README.md)`);
  }
});
