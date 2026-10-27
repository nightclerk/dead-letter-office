// Static privacy check: The Dead Letter Office's own code must not reference any outside
// server, except plain links a person can choose to click. (The model files
// are fetched from Hugging Face by Transformers.js, by model id.)
// The runtime check lives in tests/smoke.mjs.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const files = ['index.html', 'sw.js'];
for (const dir of ['js', 'css']) for (const f of await readdir(dir)) files.push(join(dir, f));

const URL_RE = /https?:\/\/[^\s"'`)<>]+/g;
let problems = 0;
for (const file of files) {
  let text = await readFile(file, 'utf8');
  // Plain <a href="..."> links are allowed: they only load if a person clicks them.
  if (file.endsWith('.html')) text = text.replace(/<a\b[^>]*\bhref="https?:\/\/[^"]*"[^>]*>/g, '<a>');
  // Comments explain things; they don't run.
  text = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
  for (const m of text.matchAll(URL_RE)) {
    if (m[0].startsWith('http://www.w3.org/')) continue; // XML namespace names, never fetched
    console.error(`✗ ${file}: outside URL in code: ${m[0]}`);
    problems++;
  }
}
// The worker must load Transformers.js and ONNX Runtime from our own copies.
const worker = await readFile('js/ghost-worker.js', 'utf8');
if (!worker.includes("'../vendor/transformers.min.js'") || !worker.includes('wasmPaths')) {
  console.error('✗ js/ghost-worker.js must use the vendored Transformers.js and ONNX Runtime files');
  problems++;
}
if (problems) { console.error(`${problems} problem(s). The clerk must not phone home.`); process.exit(1); }
console.log(`✓ privacy check passed: ${files.length} files, no outside servers in code`);
