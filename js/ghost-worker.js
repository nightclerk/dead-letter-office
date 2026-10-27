// The ghost lives here: a Web Worker that loads an open-weight Gemma model
// with Transformers.js and generates text locally (WebGPU, or WASM on CPU).
// Nothing in this file talks to any server except Hugging Face, and only to
// download the model files the first time. Every fetch is reported to the
// page so the network counter can show it.

const MOCK = new URL(self.location.href).searchParams.has('mock');

// Report every request this worker makes, before it happens.
const realFetch = self.fetch.bind(self);
self.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || String(input);
  self.postMessage({ type: 'net', url, method: (init && init.method) || 'GET' });
  return realFetch(input, init);
};

let generator = null;
let stopper = null;
let lib = null;

async function loadLib() {
  if (lib) return lib;
  lib = await import('../vendor/transformers.min.js');
  const { env } = lib;
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  // Use our own copy of the ONNX Runtime WASM files instead of a CDN.
  env.backends.onnx.wasm.wasmPaths = {
    mjs: new URL('../vendor/ort-wasm-simd-threaded.asyncify.mjs', import.meta.url).href,
    wasm: new URL('../vendor/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url).href,
  };
  return lib;
}

async function hasWebGPU() {
  try {
    if (!('gpu' in navigator)) return false;
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter;
  } catch { return false; }
}

const files = new Map(); // file -> {loaded, total}
function reportProgress(p) {
  if (p.status === 'progress' || p.status === 'download' || p.status === 'initiate' || p.status === 'done') {
    const f = files.get(p.file) || { loaded: 0, total: 0 };
    if (typeof p.total === 'number' && p.total > 0) f.total = p.total;
    if (typeof p.loaded === 'number') f.loaded = p.loaded;
    if (p.status === 'done' && f.total) f.loaded = f.total;
    files.set(p.file, f);
    let loaded = 0, total = 0;
    for (const v of files.values()) { loaded += v.loaded; total += v.total; }
    self.postMessage({ type: 'progress', file: p.file, status: p.status, loaded, total });
  } else if (p.status === 'ready') {
    self.postMessage({ type: 'progress', status: 'compiling', loaded: 1, total: 1 });
  }
}

async function load({ model, dtype, device }) {
  if (MOCK) return mockLoad();
  const { pipeline } = await loadLib();
  let dev = device;
  if (dev === 'webgpu' && !(await hasWebGPU())) dev = 'wasm';
  self.postMessage({ type: 'progress', status: 'initiate', loaded: 0, total: 0, device: dev });
  generator = await pipeline('text-generation', model, {
    dtype,
    device: dev,
    progress_callback: reportProgress,
  });
  // Warm up once so the first real question doesn't stall (shaders compile here).
  self.postMessage({ type: 'progress', status: 'warming', loaded: 1, total: 1 });
  await generator([{ role: 'user', content: 'Say hello in one word.' }], { max_new_tokens: 4, do_sample: false });
  self.postMessage({ type: 'ready', device: dev, model });
}

async function generate({ id, messages, options }) {
  if (MOCK) return mockGenerate({ id, messages, options });
  const { TextStreamer, InterruptableStoppingCriteria } = lib;
  stopper = new InterruptableStoppingCriteria();
  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text) => self.postMessage({ type: 'token', id, text }),
  });
  const started = performance.now();
  const out = await generator(messages, {
    max_new_tokens: options.max_new_tokens ?? 200,
    do_sample: options.do_sample ?? true,
    temperature: options.temperature ?? 0.7,
    top_p: options.top_p ?? 0.9,
    repetition_penalty: options.repetition_penalty ?? 1.1,
    streamer,
    stopping_criteria: stopper,
  });
  const gen = out[0].generated_text;
  const text = Array.isArray(gen) ? gen.at(-1).content : String(gen);
  self.postMessage({ type: 'done', id, text, ms: Math.round(performance.now() - started) });
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') await load(msg);
    else if (msg.type === 'generate') await generate(msg);
    else if (msg.type === 'stop') stopper?.interrupt();
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: String(err && err.message || err) });
  }
};

// ---------- Test mode (used by CI): no model, canned replies ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function mockLoad() {
  for (let i = 1; i <= 5; i++) {
    self.postMessage({ type: 'progress', status: 'progress', file: 'mock.onnx', loaded: i * 20, total: 100 });
    await sleep(60);
  }
  self.postMessage({ type: 'ready', device: 'mock', model: 'mock' });
}
async function mockGenerate({ id, messages }) {
  const prompt = messages.at(-1).content;
  const isLetter = /^Write a letter/.test(prompt);
  const name = (prompt.match(/to (.+?),/) || [, 'you'])[1];
  const text = isLetter
    ? `Dear ${name},\n\nI keep thinking about the small things. They were never small.\n\nI miss you.`
    : 'What did the kitchen sound like when they were in it?';
  for (const word of text.split(/(\s+)/)) {
    self.postMessage({ type: 'token', id, text: word });
    await sleep(8);
  }
  self.postMessage({ type: 'done', id, text, ms: 1 });
}
