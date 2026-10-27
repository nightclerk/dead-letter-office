// End-to-end smoke test in test mode (?mock): no model is downloaded.
// It walks through the whole flow and checks the privacy promise:
// after the ghost wakes, the page must make zero network requests,
// and before that it may only load its own files.
//
// Run: node tests/smoke.mjs   (needs the `playwright` package and Chromium)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = fileURLToPath(new URL('..', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (path === '' || path.endsWith('/')) path += 'index.html';
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage();
const requests = [];
let woke = false;
page.on('request', (r) => requests.push({ url: r.url(), afterWake: woke }));
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

function check(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('ok -', msg); }

try {
  await page.goto(origin + '/?mock');
  await page.waitForSelector('[data-screen="intro"]:not([hidden])');
  check(await page.isVisible('#testmode'), 'test mode banner is shown');
  await page.click('#wake');
  await page.waitForSelector('[data-screen="who"]:not([hidden])', { timeout: 15000 });
  woke = true;
  check((await page.textContent('#net-num')).trim() === '0', 'counter shows 0 requests once awake');

  await page.fill('#who-name', 'Saba');
  await page.fill('#who-rel', 'my grandfather');
  await page.fill('#who-memory', 'He whistled the same three notes every time he came through the door.');
  await page.click('#who-form button[type=submit]');
  for (let i = 0; i < 3; i++) {
    await page.waitForSelector('#answer-btn:not([disabled])', { timeout: 10000 });
    const q = (await page.textContent('#ghost-question')).trim();
    check(q.endsWith('?'), `question ${i + 1} is a question: "${q}"`);
    await page.fill('#answer', `Answer number ${i + 1}.`);
    await page.click('#answer-btn');
  }
  await page.waitForSelector('#done-btn:not([disabled])', { timeout: 10000 });
  const draft = await page.inputValue('#letter');
  check(draft.startsWith('Dear Saba'), 'letter draft starts with "Dear Saba"');
  await page.click('#done-btn');
  await page.click('#burn-btn');
  await page.waitForSelector('[data-screen="after"]:not([hidden])', { timeout: 20000 });
  check((await page.inputValue('#letter')) === '', 'letter is wiped after burning');
  check((await page.textContent('#after-proof')).includes('Outgoing mail while you wrote: 0'), 'after screen reports 0 requests');

  const after = requests.filter((r) => r.afterWake);
  check(after.length === 0, `no requests after wake (${after.map((r) => r.url).join(', ') || 'none'})`);
  const foreign = requests.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith('data:') && !r.url.startsWith('blob:'));
  check(foreign.length === 0, `only own files loaded (${foreign.map((r) => r.url).join(', ') || 'none foreign'})`);
  check(errors.length === 0, `no page errors (${errors.join(' | ') || 'none'})`);
} catch (e) {
  console.error('FAIL:', e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
