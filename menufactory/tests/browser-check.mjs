// Every venue in every look, in a real headless Chrome, served as plain files the way Pages
// serves them. For each venue x look x motion level x width:
//
//   - the page loads with no script errors
//   - the venue's name and the open-now line are on screen
//   - the motion button is there, visible, and says the right thing
//   - nothing scrolls sideways
//   - axe-core finds no WCAG 2.1 A or AA violations
//   - a screenshot is kept in tests/output/
//
// Then, once per venue: the button switches the level and the choice survives a reload, and a
// device set to reduce motion starts on "less".
//
//   npm run check
//
// Chrome: the installed one (CHROME=<path> to override), as codevscode's end-to-end check does.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { startServer } from '../tools/serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'output');
const AXE = fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const WIDTHS = [390, 1280];
const LEVELS = ['more', 'less'];

const CHROME = process.env.CHROME ?? (process.platform === 'win32'
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  : '/usr/bin/google-chrome');

const venues = fs.readdirSync(path.join(ROOT, 'venues'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const looks = fs.readdirSync(path.join(ROOT, 'looks'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const server = await startServer(0);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: process.env.CI ? ['--no-sandbox'] : [] });

const failures = [];
let checks = 0;
const fail = (where, what) => failures.push(`${where}: ${what}`);

// Every page gets its own fresh context, so a motion choice saved on one page cannot leak
// into the next.
async function openPage({ width, level, reduce = false }) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.once('close', () => context.close().catch(() => {}));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`));
  await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }]);
  if (level) await page.evaluateOnNewDocument((l) => localStorage.setItem('motion-level', l), level);
  return { page, errors };
}

async function waitForLook(page) {
  await page.waitForSelector('.motion-toggle', { timeout: 15000 });
  // Let the first animation frames run so screenshots show the look as a guest sees it.
  await new Promise((r) => setTimeout(r, 600));
}

for (const slug of venues) {
  const venue = JSON.parse(fs.readFileSync(path.join(ROOT, 'venues', slug, 'venue.json'), 'utf8'));
  for (const look of looks) {
    for (const level of LEVELS) {
      for (const width of WIDTHS) {
        const where = `${slug} / ${look} / ${level} / ${width}px`;
        const { page, errors } = await openPage({ width, level });
        try {
          await page.goto(`${base}/venues/${slug}/?look=${look}`, { waitUntil: 'networkidle0' });
          await waitForLook(page);
          checks += 1;

          const state = await page.evaluate(() => {
            const button = document.querySelector('.motion-toggle');
            const rect = button?.getBoundingClientRect();
            return {
              motion: document.documentElement.dataset.motion,
              text: document.body.innerText,
              h1: document.querySelector('h1')?.textContent ?? '',
              button: button?.textContent ?? null,
              buttonVisible: !!rect && rect.width > 0 && rect.height > 0 && rect.bottom <= innerHeight && rect.right <= innerWidth,
              sideways: document.documentElement.scrollWidth - innerWidth,
            };
          });

          if (errors.length) fail(where, `script errors: ${errors.join(' | ')}`);
          if (state.motion !== level) fail(where, `motion level is ${state.motion}, expected ${level}`);
          if (!state.h1.includes(venue.name)) fail(where, `h1 is "${state.h1}", not the venue name`);
          if (!/(Open now|Closing soon|Closed)/.test(state.text)) fail(where, 'no open-now line on the page');
          if (state.button !== (level === 'more' ? 'Less motion' : 'More motion')) fail(where, `motion button says "${state.button}"`);
          if (!state.buttonVisible) fail(where, 'motion button is not visible on screen');
          if (state.sideways > 0) fail(where, `scrolls sideways by ${state.sideways}px`);

          await page.addScriptTag({ content: AXE });
          const axe = await page.evaluate(async () => {
            const result = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
            return result.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.help}`);
          });
          if (axe.length) fail(where, `accessibility: ${axe.join('; ')}`);

          await page.screenshot({ path: path.join(OUT, `${slug}-${look}-${level}-${width}.png`), fullPage: true });
        } catch (error) {
          fail(where, error.message);
        } finally {
          await page.close();
        }
      }
    }
  }

  // The button switches the level, and the choice survives a reload.
  {
    const where = `${slug} / motion button`;
    const { page } = await openPage({ width: 390 });
    try {
      await page.goto(`${base}/venues/${slug}/`, { waitUntil: 'networkidle0' });
      await waitForLook(page);
      checks += 1;
      const before = await page.evaluate(() => document.documentElement.dataset.motion);
      await page.click('.motion-toggle');
      const after = await page.evaluate(() => document.documentElement.dataset.motion);
      await page.reload({ waitUntil: 'networkidle0' });
      await waitForLook(page);
      const reloaded = await page.evaluate(() => document.documentElement.dataset.motion);
      if (before !== 'more') fail(where, `started on ${before}, expected more`);
      if (after !== 'less') fail(where, `after one click the level is ${after}, expected less`);
      if (reloaded !== 'less') fail(where, `after a reload the level is ${reloaded}, expected the choice to be remembered`);
    } catch (error) {
      fail(where, error.message);
    } finally {
      await page.close();
    }
  }

  // A device set to reduce motion starts on "less" without anyone pressing anything.
  {
    const where = `${slug} / device reduce-motion`;
    const { page } = await openPage({ width: 390, reduce: true });
    try {
      await page.goto(`${base}/venues/${slug}/`, { waitUntil: 'networkidle0' });
      await waitForLook(page);
      checks += 1;
      const level = await page.evaluate(() => document.documentElement.dataset.motion);
      if (level !== 'less') fail(where, `a reduce-motion device started on ${level}`);
    } catch (error) {
      fail(where, error.message);
    } finally {
      await page.close();
    }
  }
}

await browser.close();
server.close();

console.log(`${checks} page checks across ${venues.length} venue(s) and ${looks.length} look(s); screenshots in tests/output/`);
if (failures.length) {
  console.error(`\n${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('all passed');
