// Copy the text-reading engine files (Tesseract.js worker and LSTM cores, pinned in package.json) from
// node_modules into public/ocr, so the site serves them itself: no third-party request at run time.
// The English language data (eng.traineddata.gz, tessdata_fast, Apache-2.0) is committed in public/ocr.
// Runs before `dev` and `build`; the copied files are git-ignored.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'ocr');
mkdirSync(out, { recursive: true });

const files = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js/dist/worker.min.js.LICENSE.txt', 'worker.min.js.LICENSE.txt'],
  ['tesseract.js/LICENSE.md', 'LICENSE-tesseract.js.md'],
  ['tesseract.js-core/LICENSE', 'LICENSE-tesseract.js-core.txt'],
  // The worker picks one by browser support (relaxed SIMD → SIMD → plain), LSTM engine only.
  ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
];
for (const [from, to] of files) copyFileSync(join(root, 'node_modules', from), join(out, to));
console.log(`ocr: ${files.length} files → public/ocr`);
