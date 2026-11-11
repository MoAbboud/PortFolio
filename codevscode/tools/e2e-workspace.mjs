// End-to-end check of the workspace in a real headless Chrome - stage 4a. Needs the server running
// (docker compose up -d) and Chrome: CHROME=<path to chrome> and CVC_BASE=<url> override the
// defaults. npm run e2e
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BASE = process.env.CVC_BASE ?? "http://localhost:8020";
const reference = Object.fromEntries(
  ["app.js", "schema.sql", "index.html"].map((n) => [n, readFileSync(`${ROOT}/challenges/sample/hidden/reference/${n}`, "utf8")]),
);

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
const step = (label, value) => console.log(`${label.padEnd(34)} ${value}`);

await page.goto(`${BASE}/play/sample`);
await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
step("title / clock", `${await page.$eval("#challenge-title", (e) => e.textContent)} / ${await page.$eval("#clock", (e) => e.textContent)}`);
step("starter walk-through", await page.$eval("html", (e) => e.dataset.check));

// Ask the client.
await page.type("#ask-text", "Should accounts lock after too many failed logins?");
await page.click("#ask-form button");
await page.waitForFunction(() => document.querySelector("#answers li:not(.empty)"), { timeout: 15000 });
step("question unlocked", (await page.$eval("#answers", (e) => e.textContent)).slice(0, 60) + "...");

// Put the reference app in the editor, file by file, the way typing would.
for (const [name, text] of Object.entries(reference)) {
  await page.click(`#tabs button[data-file="${name}"]`);
  await page.$eval("#editor", (editor, value) => {
    editor.value = value;
    editor.dispatchEvent(new Event("input"));
  }, text);
}
await page.click("#try");
await page.waitForFunction(() => !document.querySelector("#problems").textContent.includes("Checking"), { timeout: 20000 });
step("reference walk-through", await page.$eval("html", (e) => e.dataset.check));

// Run it and use it inside the sandboxed preview: everything goes through the bridge.
await page.click("#run");
await page.waitForFunction(() => document.querySelector("#preview-status").textContent.startsWith("Running"), { timeout: 20000 });
const frame = await (await page.$("#preview")).contentFrame();
await frame.waitForSelector("#login");
await frame.type('input[name="email"]', "ana@example.com");
await frame.type('input[name="password"]', "correct horse 1");
await frame.click('button[value="signup"]');
await frame.waitForSelector("#new:not([hidden])", { timeout: 15000 });
step("signed up and logged in", "yes");
await frame.type('input[name="title"]', "Shopping");
await frame.type('textarea[name="body"]', "milk, eggs");
await frame.click("#new button");
await frame.waitForFunction(() => document.querySelector("#notes").textContent.includes("Shopping"), { timeout: 15000 });
step("note saved and listed", (await frame.$eval("#notes", (e) => e.textContent)).trim().slice(0, 40));

// An endless loop: the worker is stopped and the page says so.
await page.click('#tabs button[data-file="app.js"]');
await page.$eval("#editor", (editor) => {
  editor.value = "export async function handle() { for (;;) {} }";
  editor.dispatchEvent(new Event("input"));
});
await page.click("#try");
await page.waitForFunction(() => !document.querySelector("#problems").textContent.includes("Checking"), { timeout: 20000 });
step("endless loop", (await page.$eval("#problems", (e) => e.textContent)).slice(0, 70));

// The draft survived: reload and the editor still holds the loop.
await page.reload();
await page.waitForSelector('html[data-ready="1"]', { timeout: 30000 });
step("draft kept across a reload", (await page.$eval("#editor", (e) => e.value)).includes("for (;;)") ? "yes" : "NO");

step("page errors", errors.length ? errors.join(" | ") : "none");
await browser.close();
