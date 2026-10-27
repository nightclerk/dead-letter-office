# Vendored libraries

The Dead Letter Office serves these files itself so it never depends on a CDN and keeps working offline.

| File | From | License |
|---|---|---|
| `transformers.min.js` | [@huggingface/transformers](https://github.com/huggingface/transformers.js) 4.3.2 | Apache-2.0 (`LICENSE.transformers.txt`) |
| `ort-wasm-simd-threaded.asyncify.{mjs,wasm}` | [onnxruntime-web](https://github.com/microsoft/onnxruntime) 1.31.0-dev.20260914 | MIT |

They are not committed to git. `npm ci --ignore-scripts && npm run vendor` copies them from the exact npm versions in `package-lock.json`; the deploy workflow does this on every release.
