import * as net from './netwatch.js?v=__V__';
import { modelQuestion, FALLBACK_QUESTIONS } from './clerk.js?v=__V__';

net.install();

const params = new URLSearchParams(location.search);
const MOCK = params.has('mock');

// ---------------------------------------------------------------- models
// All are Google's open-weight Gemma models, converted to ONNX by the
// Hugging Face community so they can run in a browser.
const MODELS = [
  {
    key: 'gemma3-1b', id: 'onnx-community/gemma-3-1b-it-ONNX',
    name: 'Gemma 3 · 1B', size: { f16: '≈ 760 MB', f32: '≈ 860 MB' }, dtype: { f16: 'q4f16', f32: 'q4' }, needs: 'webgpu',
    blurb: 'Recommended. Quick on its feet and good at short, kind questions.',
  },
  {
    key: 'gemma4-e2b', id: 'onnx-community/gemma-4-E2B-it-ONNX',
    name: 'Gemma 4 · E2B', size: { f16: '≈ 3.1 GB', f32: '≈ 3.6 GB' }, dtype: { f16: 'q4f16', f32: 'q4' }, needs: 'webgpu',
    blurb: 'The newest Gemma. Better with nuance and with languages other than English. A big download that needs a recent graphics card.',
  },
  {
    // No model at all. In testing, Gemma 3 270M on the CPU loaded in over a
    // minute and then answered "Okay, I understand." plus broken words instead of
    // asking anything, so a browser without WebGPU gets hand-written
    // questions rather than a clerk that only pretends to listen.
    key: 'paper', id: null,
    name: 'The paper clerk', size: { f16: 'no download', f32: 'no download' }, needs: 'any',
    blurb: 'No model. Asks from a short list of questions written by hand, so it works in any browser, right away.',
  },
];

// ---------------------------------------------------------------- dom
const $ = (s) => document.querySelector(s);
const screens = [...document.querySelectorAll('.screen')];
function show(name) {
  for (const s of screens) s.hidden = s.dataset.screen !== name;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const first = document.querySelector(`[data-screen="${name}"] input, [data-screen="${name}"] textarea`);
  if (first && name !== 'draft') setTimeout(() => first.focus({ preventScroll: true }), 300);
}

if (MOCK) $('#testmode').hidden = false;
const repo = document.querySelector('meta[name="repo"]')?.content;
if (repo) $('#repo-link').href = repo;

// Online / offline badge: the best proof is to unplug.
function updateOnline() { $('#offline').hidden = navigator.onLine; }
addEventListener('online', updateOnline);
addEventListener('offline', updateOnline);
updateOnline();

// ---------------------------------------------------------------- netwatch ui
const fmtBytes = (b) => b < 1024 ? `${b} bytes` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`;
net.onChange((s) => {
  const el = $('#netwatch'); const t = $('#net-text'); const n = $('#net-num');
  el.className = 'meter ' + s.phase;
  if (s.phase === 'asleep') { n.textContent = '–'; t.textContent = 'The clerk is asleep.'; }
  else if (s.phase === 'downloading') { n.textContent = 'IN'; t.textContent = 'Downloading the clerk.'; }
  else if (s.phase === 'silent') { n.textContent = '0'; t.textContent = 'No requests since the clerk arrived.'; }
  else { n.textContent = String(s.afterCount); t.textContent = `${s.afterCount} request(s) since the clerk arrived, to ${s.afterHosts.join(', ')}`; }
  el.title = t.textContent;
});

// ---------------------------------------------------------------- model picker
let gpuOK = false;
let f16OK = false; // some graphics cards can't do 16-bit float math in shaders
async function detectGPU() {
  if (params.has('cpu')) { gpuOK = false; f16OK = false; return; } // ?cpu: act like a browser without WebGPU
  if (MOCK) { gpuOK = true; f16OK = true; return; } // test mode pretends, so every clerk can be walked through
  try {
    const adapter = navigator.gpu && await navigator.gpu.requestAdapter();
    gpuOK = !!adapter;
    f16OK = !!adapter && adapter.features.has('shader-f16');
  } catch { gpuOK = false; f16OK = false; }
}
// Which build of the weights fits this device: 4-bit weights with 16-bit math
// where the GPU supports it, 4-bit weights with 32-bit math where it doesn't.
const variant = () => (f16OK ? 'f16' : 'f32');
function renderModels() {
  const box = $('#models');
  box.querySelectorAll('.model').forEach((n) => n.remove());
  // Phones start with the paper clerk: an 800 MB model is a lot to ask of one.
  const phone = navigator.userAgentData?.mobile ?? /Android|iPhone|iPad/i.test(navigator.userAgent);
  const firstAvail = phone || !gpuOK ? MODELS.find((m) => m.key === 'paper') : MODELS[0];
  for (const m of MODELS) {
    const ok = m.needs === 'any' || gpuOK;
    const label = document.createElement('label');
    label.className = 'model' + (ok ? '' : ' disabled');
    label.innerHTML = `<input type="radio" name="model" value="${m.key}" ${ok ? '' : 'disabled'} ${m === firstAvail ? 'checked' : ''}>
      <strong>${m.name}</strong><span class="size">${m.size[variant()] || m.size.f32}</span><span class="meta">${m.blurb}</span>`;
    box.appendChild(label);
  }
  $('#device-note').textContent = gpuOK
    ? 'This browser has WebGPU, so the clerk can use your graphics card.'
    : 'This browser has no WebGPU, so Gemma can\'t run here. The paper clerk can. To meet Gemma, use Chrome or Edge on a laptop or desktop.';
  $('#branch').textContent = 'Branch: this browser · ' + (gpuOK ? 'WebGPU' : 'paper only');
}

// ---------------------------------------------------------------- worker
const worker = new Worker(new URL('./ghost-worker.js?v=__V__' + (MOCK ? '&mock' : ''), import.meta.url), { type: 'module' });
let pending = new Map();
let nextId = 1;
let onProgress = () => {};
let onReady = () => {};
let onLoadError = () => {};

worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'net') return net.recordFromWorker(m.url, m.method);
  if (m.type === 'progress') return onProgress(m);
  if (m.type === 'ready') return onReady(m);
  const p = pending.get(m.id);
  if (m.type === 'error') {
    if (p) { pending.delete(m.id); p.reject(new Error(m.message)); }
    else onLoadError(new Error(m.message));
    return;
  }
  if (!p) return;
  if (m.type === 'token') p.onToken?.(m.text);
  if (m.type === 'done') { pending.delete(m.id); p.resolve(m.text); }
};

function ask(messages, options = {}, onToken) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onToken });
    worker.postMessage({ type: 'generate', id, messages, options });
  });
}

// ---------------------------------------------------------------- wake
let chosen = null;
function log(line) {
  const el = $('#load-log');
  el.textContent += (el.textContent ? '\n' : '') + '> ' + line;
}
$('#wake').addEventListener('click', () => {
  if ($('#wake').disabled) return;
  $('#wake').disabled = true;
  const key = document.querySelector('input[name="model"]:checked')?.value;
  chosen = MODELS.find((m) => m.key === key) || MODELS.at(-1);
  show('loading');
  $('#load-log').textContent = '';
  if (!chosen.id) {
    log('clerk requested: the paper clerk (no model, nothing to download)');
    fontsReady.then(() => {
      net.setPhase('silent');
      log('at the desk');
      $('#ghost-hello').textContent = 'Good evening. Who is the letter for?';
      setTimeout(() => show('who'), 600);
    });
    return;
  }
  const device = 'webgpu';
  const dtype = chosen.dtype[variant()];
  log(`clerk requested: ${chosen.name} (${chosen.id})`);
  log(`graphics card found (WebGPU${f16OK ? ', 16-bit' : ', 32-bit'})`);
  net.setPhase('downloading');
  const started = performance.now();
  let lastPhase = '';
  onProgress = (p) => {
    const bar = $('#load-bar');
    if (p.status === 'compiling' || p.status === 'warming') {
      bar.firstElementChild.style.width = '100%';
      if (lastPhase !== p.status) log(p.status === 'warming' ? 'clerk is clearing its throat' : 'files in hand, setting up on this device');
      lastPhase = p.status;
      $('#load-status').textContent = 'Nearly at the desk.';
      return;
    }
    if (p.total > 0) {
      if (lastPhase !== 'download') { log('fetching the model files'); lastPhase = 'download'; }
      const pct = Math.min(100, (p.loaded / p.total) * 100);
      bar.firstElementChild.style.width = pct.toFixed(1) + '%';
      bar.setAttribute('aria-valuenow', pct.toFixed(0));
      $('#load-status').textContent = `${fmtBytes(p.loaded)} of ${fmtBytes(p.total)}. On a second visit this comes from your browser's own storage.`;
      if (p.loaded >= p.total && lastPhase === 'download') {
        lastPhase = 'unpacking';
        log('all files here, setting the clerk up on your graphics card (this can take a minute)');
        $('#load-status').textContent = 'Setting up on this device. The bigger the clerk, the longer this takes.';
      }
    }
  };
  onReady = async (m) => {
    await fontsReady;
    net.setPhase('silent');
    const secs = ((performance.now() - started) / 1000).toFixed(0);
    log(`at the desk after ${secs} s`);
    console.info(`[dlo] clerk ready on ${m.device} in ${secs}s (${m.model})`);
    $('#ghost-hello').textContent = 'Good evening. Who is the letter for?';
    setTimeout(() => show('who'), 600);
  };
  onLoadError = (err) => {
    console.error(err);
    log('the clerk could not come down: ' + err.message);
    $('#load-status').textContent = chosen.key === 'gemma3-1b'
      ? 'Try again, or choose the paper clerk, which needs no model.'
      : 'Try Gemma 3 1B, which is smaller, or the paper clerk, which needs no model.';
    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = 'Choose another clerk';
    back.onclick = () => location.reload();
    $('#load-status').after(back);
  };
  worker.postMessage({ type: 'load', model: chosen.id, dtype, device });
});

// ---------------------------------------------------------------- the letter
const letter = { name: '', rel: '', items: [], questions: [] };
let maxQ = 3; // the clerk asks three questions; you can ask for one more

// In Hebrew the small models misread too much (in testing, Gemma turned a
// grandmother's Friday chicken soup into pork sausage), so a Hebrew letter
// gets questions written by hand instead of generated ones.
const HEBREW_QUESTIONS = [
  'איזה ריח מחזיר אותך אליהם גם היום?',
  'מה הם היו אומרים תמיד, משהו שאף אחד אחר לא אמר?',
  'איפה היה המקום שלהם בבית, ומה הם עשו שם?',
  'איזה צליל עדיין מזכיר לך אותם?',
  'מה לא הספקת להגיד להם?',
];
const isHebrew = () => /[\u0590-\u05FF]/.test(letter.name + letter.items.map((i) => i.a).join(' '));

// The clerk never writes a word of your letter. In testing, Gemma asked to
// write a whole letter gave a grandfather a favourite song nobody had
// mentioned. So the model only asks questions, and the letter is made from
// your answers, word for word. For English, "he" and "his" are turned into
// "you" and "your" with plain grammar rules, no model involved.
function pronounSwap(t) {
  return t.replace(/\b(He|She)\b/g, 'You').replace(/\b(he|she)\b/g, 'you')
    .replace(/\b(His|Her)\b/g, 'Your').replace(/\b(his|her)\b/g, 'your')
    .replace(/\bhim\b/g, 'you').replace(/\b(himself|herself)\b/g, 'yourself')
    .replace(/\b([Yy]ou) (was|is|has|does)\b/g, (m, y, v) => y + ' ' + ({ was: 'were', is: 'are', has: 'have', does: 'do' })[v]);
}
const isLatin = (t) => !/[^\u0000-ɏ -⁯‘-‟]/.test(t);
const faceThem = (t) => (isLatin(t) ? pronounSwap(t) : t);

const isRTL = (s) => /[֐-׿؀-ۿ]/.test(s);

// The clerk types its words out, like a night clerk at a typewriter.
function clerkType(el, text) {
  el.classList.remove('thinking');
  el.dir = isRTL(text) ? 'rtl' : 'auto';
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = text; return Promise.resolve(); }
  el.textContent = '';
  el.classList.add('typing');
  const chars = [...text];
  let i = 0;
  return new Promise((resolve) => {
    (function tick() {
      el.textContent += chars[i++];
      if (i < chars.length) setTimeout(tick, /[,.?!]/.test(chars[i - 1]) ? 140 : 22 + Math.random() * 26);
      else { el.classList.remove('typing'); resolve(); }
    })();
  });
}

$('#who-form').addEventListener('submit', (e) => {
  e.preventDefault();
  letter.name = $('#who-name').value.trim();
  letter.rel = $('#who-rel').value.trim();
  letter.items = [{ q: null, a: $('#who-memory').value.trim() }];
  letter.questions = [];
  maxQ = 3;
  nextQuestion();
});

async function nextQuestion() {
  if (letter.questions.length >= maxQ) return writeDraft();
  show('ask');
  const qel = $('#ghost-question');
  $('#ask-count').textContent = `Question ${letter.questions.length + 1} of ${maxQ}`;
  $('#answer').value = '';
  setAskBusy(true);
  qel.textContent = ''; qel.classList.add('thinking');
  let q = null;
  if (isHebrew() || !chosen.id) {
    await new Promise((r) => setTimeout(r, 900));
    q = (isHebrew() ? HEBREW_QUESTIONS : FALLBACK_QUESTIONS).find((h) => !letter.questions.includes(h)) || null;
  }
  if (!q && chosen.id) {
    try { q = (await modelQuestion(letter, ask)).q; } catch (err) { console.error(err); }
  }
  if (!q) q = FALLBACK_QUESTIONS.find((f) => !letter.questions.includes(f)) || FALLBACK_QUESTIONS.at(-1);
  letter.questions.push(q);
  await clerkType(qel, q);
  setAskBusy(false);
  $('#answer').dir = isRTL(letter.items.map((i) => i.a).join(' ')) ? 'rtl' : 'auto';
  $('#answer').focus({ preventScroll: true });
}

function setAskBusy(b) { ['#answer-btn', '#skip-btn', '#ready-btn'].forEach((s) => ($(s).disabled = b)); }

$('#ask-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const a = $('#answer').value.trim();
  if (a) letter.items.push({ q: letter.questions.at(-1), a });
  nextQuestion();
});
$('#skip-btn').addEventListener('click', () => nextQuestion());
$('#ready-btn').addEventListener('click', () => {
  const a = $('#answer').value.trim();
  if (a) letter.items.push({ q: letter.questions.at(-1), a });
  writeDraft();
});

// The letter sheet grows with the letter, so the whole page burns at once.
function fitLetter() {
  const ta = $('#letter');
  ta.style.height = 'auto';
  ta.style.height = Math.max(420, ta.scrollHeight + 8) + 'px';
}
$('#letter').addEventListener('input', fitLetter);

async function writeDraft() {
  show('draft');
  const ta = $('#letter');
  ta.readOnly = true;
  ta.dir = isRTL(letter.items.map((i) => i.a).join(' ')) ? 'rtl' : 'auto';
  $('#rewrite-btn').disabled = true; $('#done-btn').disabled = true;
  $('#draft-note').textContent = 'Putting your words in order.';
  const paras = letter.items.map((it) => faceThem(it.a).replace(/\s+$/, ''))
    .map((p) => (/[.!?…"”'’)]$/.test(p) ? p : p + '.'));
  const latin = isLatin(letter.items.map((i) => i.a).join(' ') + letter.name);
  const full = latin
    ? `Dear ${letter.name},\n\n${paras.join('\n\n')}\n\nI remember. I wanted you to know that.\n`
    : `${letter.name},\n\n${paras.join('\n\n')}\n`;
  // Set it down at typing speed, so it feels written rather than pasted.
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  ta.value = '';
  for (let i = 0; i < full.length && !reduce; i += 3) {
    ta.value = full.slice(0, i);
    if (i % 60 === 0) fitLetter();
    await new Promise((r) => setTimeout(r, 12));
  }
  ta.value = full;
  fitLetter();
  ta.readOnly = false;
  $('#draft-note').textContent = 'Every word here is yours. I only put them in order. Change anything, and add what only you can say.';
  $('#rewrite-btn').disabled = false; $('#done-btn').disabled = false;
}

$('#rewrite-btn').addEventListener('click', () => { maxQ = letter.questions.length + 1; nextQuestion(); });
$('#done-btn').addEventListener('click', () => show('farewell'));
$('#back-btn').addEventListener('click', () => show('draft'));

// ---------------------------------------------------------------- keep
$('#keep-btn').addEventListener('click', () => {
  const blob = new Blob([$('#letter').value], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `dead-letter-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  finish('kept');
});

// ---------------------------------------------------------------- burn
$('#burn-btn').addEventListener('click', async () => {
  show('draft');
  $('#draft-note').textContent = 'Sending it the old way.';
  window.scrollTo({ top: document.querySelector('.paper-wrap').offsetTop - 80, behavior: 'smooth' });
  ['#rewrite-btn', '#done-btn'].forEach((s) => ($(s).disabled = true));
  $('#letter').readOnly = true;
  await burn(document.querySelector('.airmail'));
  finish('burned');
});

function burn(paper) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = $('#embers');
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = canvas.width = canvas.clientWidth * dpr;
  const H = canvas.height = canvas.clientHeight * dpr;
  const offset = 140 * dpr; // canvas extends above the letter
  const sparks = [];
  const dur = reduce ? 600 : 5200;
  paper.classList.add('burning');
  return new Promise((resolve) => {
    const t0 = performance.now();
    function frame(t) {
      const k = Math.min(1, (t - t0) / dur);
      const eased = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const burnPct = -10 + eased * 125;
      paper.style.setProperty('--burn', burnPct + '%');
      // y of the burning edge on the canvas
      const paperH = H - offset;
      const edgeY = offset + paperH * (1 - burnPct / 100);
      if (!reduce && k < 0.97) {
        for (let i = 0; i < 3; i++) {
          sparks.push({ x: Math.random() * W, y: edgeY + (Math.random() - 0.5) * 10 * dpr, vx: (Math.random() - 0.5) * 0.6 * dpr, vy: -(0.6 + Math.random() * 1.8) * dpr, life: 1, r: (0.8 + Math.random() * 2.2) * dpr });
        }
        // flakes of ash drift up more slowly
        sparks.push({ ash: true, x: Math.random() * W, y: edgeY, vx: (Math.random() - 0.5) * 0.8 * dpr, vy: -(0.3 + Math.random() * 0.7) * dpr, life: 1, r: (1.5 + Math.random() * 3) * dpr });
      }
      ctx.clearRect(0, 0, W, H);
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx + Math.sin((t + i) / 180) * 0.25 * dpr; s.y += s.vy; s.life -= 0.012;
        if (s.life <= 0) { sparks.splice(i, 1); continue; }
        ctx.beginPath();
        ctx.fillStyle = s.ash
          ? `rgba(60, 52, 44, ${s.life * 0.55})`
          : `rgba(255, ${(70 + 140 * s.life) | 0}, ${(20 + 30 * s.life) | 0}, ${Math.min(1, s.life * 1.2)})`;
        if (s.ash) ctx.ellipse(s.x, s.y, s.r, s.r * 0.55, (t / 400 + i) % Math.PI, 0, Math.PI * 2);
        else ctx.arc(s.x, s.y, s.r * s.life + 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
      if (k < 1 || sparks.length) requestAnimationFrame(frame);
      else { ctx.clearRect(0, 0, W, H); resolve(); }
    }
    requestAnimationFrame(frame);
  });
}

function finish(how) {
  const s = net.snapshot();
  // Forget everything.
  $('#letter').value = '';
  letter.name = ''; letter.rel = ''; letter.items = []; letter.questions = [];
  ['#who-name', '#who-rel', '#who-memory', '#answer'].forEach((sel) => ($(sel).value = ''));
  const mail = document.querySelector('.airmail'); mail.classList.remove('burning'); mail.style.setProperty('--burn', '-10%');
  $('#letter').style.height = '';
  $('#letter').readOnly = false;

  const pm = document.querySelector('.postmark');
  $('#pm-how').textContent = how === 'burned' ? 'DELIVERED BY FIRE' : 'RETURNED TO SENDER';
  $('#pm-date').textContent = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  pm.classList.toggle('keep', how !== 'burned');
  pm.classList.remove('thump'); void pm.getBoundingClientRect(); pm.classList.add('thump');

  $('#after-title').textContent = how === 'burned' ? 'It\'s gone.' : 'It\'s yours.';
  $('#after-text').textContent = how === 'burned'
    ? 'The letter was here for a little while, and now it is smoke. The clerk has already forgotten it.'
    : 'The letter is saved on this device and nowhere else. The clerk has already forgotten it.';
  $('#after-proof').textContent = s.afterCount === 0
    ? `Outgoing mail while you wrote: 0. The only place this letter went was ${how === 'burned' ? 'up' : 'into your own files'}.`
    : `Outgoing mail while you wrote: ${s.afterCount}, to ${s.afterHosts.join(', ')}. That should not happen. Please report it on GitHub.`;
  show('after');
}

$('#again-btn').addEventListener('click', () => show('who'));

// ---------------------------------------------------------------- boot
if ('serviceWorker' in navigator && isSecureContext) {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('sw', e));
}
// Load every font now, while the page is still allowed to fetch its own
// files. Otherwise the Hebrew or bold face would load later, mid-letter, and
// the counter would (rightly) count it as a request after the clerk arrived.
const FACES = ['400 1em "Caslon Display"', '400 1em Caslon', 'italic 400 1em Caslon', '700 1em Caslon',
  '400 1em "Courier Prime"', '700 1em "Courier Prime"', '400 1em "Frank Ruhl"', '700 1em "Frank Ruhl"'];
const fontsReady = Promise.all(FACES.map((f) => document.fonts.load(f, f.includes('Frank') ? 'אב' : 'Ab').catch(() => null)));
await detectGPU();
renderModels();
show('intro');
