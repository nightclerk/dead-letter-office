// The question test bench: runs the clerk's real prompt (js/clerk.js) over a
// fixed set of invented memories, two questions each, and counts what comes
// back. Everything runs in this tab, like the office itself.
import { modelQuestion, FALLBACK_QUESTIONS } from './clerk.js?v=__V__';

const MODELS = {
  'gemma3-1b': { id: 'onnx-community/gemma-3-1b-it-ONNX', name: 'Gemma 3 · 1B' },
  'gemma4-e2b': { id: 'onnx-community/gemma-4-E2B-it-ONNX', name: 'Gemma 4 · E2B' },
};

// Invented people, written the way a visitor might write. Each has a first
// memory and the answer they give to the clerk's first question.
export const MEMORIES = [
  ['Grandpa Avi', 'my grandfather', 'Every Friday he peeled oranges in one long spiral and gave me the peel.', "At the kitchen table, on top of yesterday's newspaper."],
  ['Mom', '', 'She hummed while she ironed shirts on Sunday nights.', 'Old Beatles songs, mostly. She never knew all the words.'],
  ['Dad', '', 'He drove me to swim practice at six in the morning and never once complained.', 'He always had a thermos of black coffee between his knees.'],
  ['Aunt Miriam', 'my aunt', 'She sent me a postcard from every city she visited.', 'I kept them all in a shoebox under my bed.'],
  ['Leo', 'my best friend', 'We built a treehouse together when we were ten.', 'It leaked every time it rained and we loved it anyway.'],
  ['Grandma June', 'my grandmother', 'She kept a jar of butterscotch candies on top of the piano.', 'She played hymns badly and laughed at herself.'],
  ['Mr. Okafor', 'my teacher', 'He read a poem out loud at the end of every class.', 'His voice got very quiet for the sad ones.'],
  ['Nana', '', 'She grew tomatoes on the balcony of a tiny apartment.', 'She talked to them every morning in Italian.'],
  ['Uncle Dov', 'my uncle', 'He told terrible jokes at every family dinner.', 'The one about the penguin, every single time.'],
  ['Sara', 'my sister', 'She cut my hair in the bathroom when we were kids.', 'She always made the fringe crooked on purpose.'],
  ['Grandpa Joe', 'my grandfather', 'He fished on the lake every summer morning before anyone else was awake.', 'He let me hold the net and pretend I caught them.'],
  ['Mom', '', 'She left notes in my lunchbox until I was sixteen.', 'They always ended with a little drawn heart.'],
  ['Grandma Rachel', 'my grandmother', 'She sang in the kitchen every Friday while the soup cooked.', 'Always the same old Yiddish song, a little off key.'],
  ['Tom', 'my husband', 'He made pancakes every Saturday, shaped like the letters of my name.', 'He always burned the first one and ate it himself.'],
  ['Maya', 'my friend', 'She danced in the rain outside the hospital the day she got good news.', 'I was too shy to join her. I wish I had.'],
  ['Dad', '', 'He fixed everything in the house with duct tape.', 'Even my glasses once, before a school photo.'],
];

const $ = (s) => document.querySelector(s);
const STOP = new Set('the and was his her she him they them their with when what where did that this for from you your every always about like into onto once used would were have had who which there then than just very '.split(' '));
const words = (t) => new Set((t.toLowerCase().match(/\p{L}+/gu) || []).filter((w) => w.length > 2 && !STOP.has(w)));
// Does the question pick up at least one content word from what was written?
const picksUp = (q, text, name) => {
  const nameWords = words(name);
  const src = words(text);
  return [...words(q)].some((w) => src.has(w) && !nameWords.has(w));
};

let worker; let nextId = 1; const pending = new Map();
function start(model, dtype) {
  worker = new Worker(new URL('./ghost-worker.js?v=__V__', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') return resolve();
      if (m.type === 'progress' && m.total > 0) $('#status').textContent = `Loading ${Math.round((m.loaded / m.total) * 100)}%`;
      if (m.type === 'error' && !m.id) return reject(new Error(m.message));
      const p = pending.get(m.id);
      if (!p) return;
      if (m.type === 'error') { pending.delete(m.id); p.reject(new Error(m.message)); }
      if (m.type === 'done') { pending.delete(m.id); p.resolve(m.text); }
    };
    worker.postMessage({ type: 'load', model, dtype, device: 'webgpu' });
  });
}
const ask = (messages, options) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  worker.postMessage({ type: 'generate', id, messages, options });
});

function row(cells) {
  const tr = document.createElement('tr');
  for (const c of cells) { const td = document.createElement('td'); td.textContent = c; tr.appendChild(td); }
  $('#rows').appendChild(tr);
}

$('#run').addEventListener('click', async () => {
  $('#run').disabled = true;
  const key = $('#model').value;
  const adapter = navigator.gpu && await navigator.gpu.requestAdapter();
  if (!adapter) { $('#status').textContent = 'This bench needs WebGPU.'; return; }
  const dtype = adapter.features.has('shader-f16') ? 'q4f16' : 'q4';
  $('#status').textContent = 'Loading the clerk…';
  await start(MODELS[key].id, dtype);
  const results = [];
  for (const [i, [name, rel, memory, answer]] of MEMORIES.entries()) {
    const letter = { name, rel, items: [{ q: null, a: memory }], questions: [] };
    for (let turn = 1; turn <= 2; turn++) {
      $('#status').textContent = `Memory ${i + 1} of ${MEMORIES.length}, question ${turn}`;
      const t0 = performance.now();
      const { q, raws } = await modelQuestion(letter, ask);
      const secs = (performance.now() - t0) / 1000;
      const r = { memory: i + 1, turn, q, raws, tries: raws.length, secs, picksUp: q ? picksUp(q, turn === 1 ? memory : answer, name) : false };
      results.push(r);
      row([`${i + 1}.${turn}`, turn === 1 ? memory : answer, q || '(none: hand-written fallback)', r.tries, secs.toFixed(1), r.picksUp ? 'yes' : 'no']);
      // Like the office: if nothing usable came back, a hand-written question is asked instead.
      letter.questions.push(q || FALLBACK_QUESTIONS.find((f) => !letter.questions.includes(f)));
      if (turn === 1) letter.items.push({ q: letter.questions.at(-1), a: answer });
    }
  }
  const n = results.length;
  const usable = results.filter((r) => r.q);
  const first = results.filter((r) => r.q && r.tries === 1).length;
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const summary = {
    model: MODELS[key].name, dtype, questions: n,
    usable: usable.length, firstTry: first, fallback: n - usable.length,
    picksUpAWord: usable.filter((r) => r.picksUp).length,
    medianSecs: +med(results.map((r) => r.secs)).toFixed(1),
  };
  window.BENCH = { summary, results };
  $('#status').textContent = `${summary.model} (${dtype}): ${summary.usable}/${n} usable questions, ${summary.firstTry} on the first try, ${summary.fallback} fell back to a hand-written one. ${summary.picksUpAWord} of the usable ones pick up a word from what was just written. Median ${summary.medianSecs} s per question.`;
  worker.terminate();
});
