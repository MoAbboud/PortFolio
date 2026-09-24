// Renders the resume's three published companion files from sources in this repo:
//
//   resume/og.png                        link-preview card, from tools/og.html
//   resume/icon.png                      180 px icon, from tools/icon.html
//   resume/Mohamad-Abboud-Resume.pdf     the PDF, printed from resume/index.html itself
//
//   node resume/tools/make-assets.mjs
//
// Run it after changing what the page says, and commit the outputs with the change. The PDF
// is the page's own print stylesheet with scripts off (the plain-document view, every detail
// open), so the two cannot disagree. Its root-absolute links are rewritten to the live
// domain first, because a PDF has no site to be relative to.
//
// Needs Chrome, Chromium or Edge. Set CHROME to its path if it is not found. No packages:
// it talks to the browser over the DevTools protocol with Node's built-in WebSocket.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESUME = path.resolve(HERE, '..');
const SITE = 'https://moabboud.dev';
const PORT = 9400 + Math.floor(Math.random() * 400);

const CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const chrome = CANDIDATES.find((p) => fs.existsSync(p));
if (!chrome) {
  console.error('No Chrome, Chromium or Edge found. Set CHROME to its path.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-assets-'));
const browser = spawn(chrome, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--hide-scrollbars', '--force-color-profile=srgb', 'about:blank',
], { stdio: 'ignore' });

let ws;
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch { /* not listening yet */ }
    if (!target) await sleep(200);
  }
  if (!target) throw new Error('the browser did not start');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0;
  const waiting = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (!waiting.has(msg.id)) return;
    const { resolve, reject } = waiting.get(msg.id);
    waiting.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send('Page.enable');

  async function open(file, width, height) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: pathToFileURL(file).href });
    await sleep(900); // local file, system fonts: nothing to wait on but layout
  }

  async function png(source, out, width, height) {
    await open(path.join(HERE, source), width, height);
    const { data } = await send('Page.captureScreenshot', {
      format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    fs.writeFileSync(path.join(RESUME, out), Buffer.from(data, 'base64'));
    console.log(`  ${out}  ${width} x ${height}`);
  }

  await png('og.html', 'og.png', 1200, 630);
  await png('icon.html', 'icon.png', 180, 180);

  // The PDF: the page with scripts off, which is the plain document, links made absolute.
  const html = fs.readFileSync(path.join(RESUME, 'index.html'), 'utf8')
    .replace(/href="\/(?!\/)/g, `href="${SITE}/`);
  const copy = path.join(profile, 'resume-print.html');
  fs.writeFileSync(copy, html);
  await send('Emulation.setScriptExecutionDisabled', { value: true });
  await open(copy, 1200, 900);
  const { data } = await send('Page.printToPDF', {
    printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false,
    generateDocumentOutline: true, generateTaggedPDF: true,
  });
  const pdf = Buffer.from(data, 'base64');
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  fs.writeFileSync(path.join(RESUME, 'Mohamad-Abboud-Resume.pdf'), pdf);
  console.log(`  Mohamad-Abboud-Resume.pdf  ${pages} pages, ${(pdf.length / 1024).toFixed(0)} KB`);
} finally {
  try { ws?.close(); } catch { /* already closed */ }
  browser.kill();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold a lock */ }
}
