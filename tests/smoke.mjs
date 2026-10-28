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
const context = await browser.newContext();
const page = await context.newPage();
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

  // A second letter, in Hebrew, using every other path: skip, ready early,
  // one more question, go back and edit, return to sender (download).
  await page.click('#again-btn');
  await page.waitForSelector('[data-screen="who"]:not([hidden])');
  await page.fill('#who-name', 'סבתא רחל');
  await page.fill('#who-rel', '');
  await page.fill('#who-memory', 'היא תמיד שרה במטבח כשהיא בישלה מרק.');
  await page.click('#who-form button[type=submit]');
  await page.waitForSelector('#answer-btn:not([disabled])');
  check(/[\u0590-\u05FF]/.test(await page.textContent('#ghost-question')), 'a Hebrew letter gets a Hebrew question');
  await page.click('#skip-btn');
  await page.waitForSelector('#answer-btn:not([disabled])');
  await page.fill('#answer', 'ריח של שמיר וסלרי.');
  await page.click('#ready-btn');
  await page.waitForSelector('#done-btn:not([disabled])');
  let heb = await page.inputValue('#letter');
  check(heb.startsWith('סבתא רחל,') && heb.includes('ריח של שמיר וסלרי.') && !heb.includes('Dear'), 'Hebrew letter keeps the words as written, no English frame');
  check((await page.getAttribute('#letter', 'dir')) === 'rtl', 'Hebrew letter is right-to-left');
  await page.click('#rewrite-btn');
  await page.waitForSelector('#answer-btn:not([disabled])');
  check(await page.isVisible('[data-screen="ask"]'), 'one more question is offered');
  await page.fill('#answer', 'היא קראה לי "ציפור".');
  await page.click('#answer-btn');
  await page.waitForSelector('#done-btn:not([disabled])');
  heb = await page.inputValue('#letter');
  check(heb.includes('ציפור'), 'the extra answer is in the letter');
  await page.click('#done-btn');
  await page.click('#back-btn');
  check(await page.isVisible('[data-screen="draft"]'), 'go back and edit returns to the letter');
  await page.click('#done-btn');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#keep-btn')]);
  check(download.suggestedFilename().endsWith('.txt'), `return to sender saves a file (${download.suggestedFilename()})`);
  await page.waitForSelector('[data-screen="after"]:not([hidden])');
  check((await page.textContent('#pm-how')).includes('RETURNED TO SENDER'), 'postmark says returned to sender');

  const after2 = requests.filter((r) => r.afterWake);
  check(after2.length === 0, `still no requests after wake (${after2.map((r) => r.url).join(', ') || 'none'})`);
  check(errors.length === 0, `no page errors (${errors.join(' | ') || 'none'})`);

  // Offline: the office must open with the internet switched off.
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => null);
  const controlled = await page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller));
  check(controlled, 'service worker controls the page');
  await context.setOffline(true);
  await page.reload();
  check(await page.isVisible('[data-screen="intro"]').catch(() => false), 'the office opens offline');
  await context.setOffline(false);

  // Phone width: nothing may stick out sideways on any screen.
  const phone = await browser.newPage({ viewport: { width: 360, height: 740 } });
  await phone.goto(origin + '/?mock');
  const overflow = async (name) => {
    const o = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(o <= 0, `no sideways scroll on a phone: ${name}`);
  };
  await phone.waitForSelector('[data-screen="intro"]:not([hidden])'); await overflow('front desk');
  await phone.click('#wake'); await phone.waitForSelector('[data-screen="who"]:not([hidden])'); await overflow('form');
  await phone.fill('#who-name', 'Saba'); await phone.fill('#who-memory', 'He whistled.');
  await phone.click('#who-form button[type=submit]'); await phone.waitForSelector('#answer-btn:not([disabled])'); await overflow('question');
  await phone.click('#ready-btn'); await phone.waitForSelector('#done-btn:not([disabled])'); await overflow('letter');
  await phone.click('#done-btn'); await overflow('dispatch');
  await phone.click('#burn-btn'); await phone.waitForSelector('[data-screen="after"]:not([hidden])', { timeout: 20000 }); await overflow('postmark');

  // A browser without WebGPU: only the paper clerk (no model) is offered,
  // its questions are the hand-written ones, and it never asks the worker.
  const paper = await browser.newPage();
  const paperReq = []; let paperWoke = false;
  paper.on('request', (r) => { if (paperWoke) paperReq.push(r.url()); });
  await paper.goto(origin + '/?mock&cpu');
  await paper.waitForSelector('[data-screen="intro"]:not([hidden])');
  check(await paper.isChecked('input[value="paper"]'), 'without WebGPU the paper clerk is chosen');
  check(await paper.isDisabled('input[value="gemma3-1b"]'), 'without WebGPU Gemma is not offered');
  await paper.click('#wake');
  await paper.waitForSelector('[data-screen="who"]:not([hidden])', { timeout: 10000 });
  paperWoke = true;
  await paper.fill('#who-name', 'Saba'); await paper.fill('#who-memory', 'He whistled.');
  await paper.click('#who-form button[type=submit]');
  await paper.waitForSelector('#answer-btn:not([disabled])');
  const pq = (await paper.textContent('#ghost-question')).trim();
  check(pq === 'What is a sound that still brings them back to you?', `the paper clerk asks a hand-written question ("${pq}")`);
  await paper.fill('#answer', 'The kettle.');
  await paper.click('#ready-btn');
  await paper.waitForSelector('#done-btn:not([disabled])');
  check((await paper.inputValue('#letter')).includes('The kettle.'), 'the paper clerk sets down the letter');
  check(paperReq.length === 0, `the paper clerk makes no requests (${paperReq.join(', ') || 'none'})`);
} catch (e) {
  console.error('FAIL:', e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
