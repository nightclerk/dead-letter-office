// Copies the exact library files the Dead Letter Office serves itself, so the app never
// depends on a CDN. Run after changing the Transformers.js version.
import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('vendor', { recursive: true });
const files = [
  ['node_modules/@huggingface/transformers/dist/transformers.min.js', 'vendor/transformers.min.js'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs', 'vendor/ort-wasm-simd-threaded.asyncify.mjs'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm', 'vendor/ort-wasm-simd-threaded.asyncify.wasm'],
];
for (const [from, to] of files) { await copyFile(from, to); console.log('copied', to); }
