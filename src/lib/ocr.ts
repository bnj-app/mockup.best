/**
 * TEXT READING ENGINE (Tesseract.js, Apache-2.0) for Find focus areas.
 *
 * Everything is served by this site from /ocr (tools/copy-ocr.mjs): the worker, the LSTM core the
 * browser supports, and the English fast model. No third-party request, nothing leaves the device.
 * Nothing is downloaded on page load: the engine is prepared when Auto-motion opens (one worker,
 * reused), and Find never waits for it longer than the text pass budget (lib/ocrRefine.ts) — if it
 * is not ready yet, the pixel result is used.
 */

import type { Worker } from 'tesseract.js';
import { makeTextPass, type OcrEngine } from '@/lib/ocrRefine';
import { setScanRefiner } from '@/components/scene/autoMotion';

/** Give up preparing the engine after this long (download + start); Find keeps the pixel result. */
const SETUP_TIMEOUT_MS = 8000;

let workerP: Promise<Worker | null> | null = null;
let psm: 'line' | 'block' | null = null;
let state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
/** Engine state (tests and diagnostics). */
export const textReaderState = () => state;

function prepare(): Promise<Worker | null> {
  if (workerP) return workerP;
  state = 'loading';
  workerP = (async () => {
    try {
      const T = await import('tesseract.js');
      const setup = T.createWorker('eng', T.OEM.LSTM_ONLY, {
        workerPath: '/ocr/worker.min.js',
        corePath: '/ocr/',
        langPath: '/ocr',
        gzip: true,
        // A same-origin worker file (no blob: URL); the model is cached in IndexedDB after first use.
        workerBlobURL: false,
      });
      const timeout = new Promise<null>((r) => setTimeout(() => r(null), SETUP_TIMEOUT_MS));
      const worker = await Promise.race([setup, timeout]);
      if (!worker) {
        // Too slow: let it finish in the background for the next Find, but do not hold this one.
        void setup
          .then((w) => {
            workerP = Promise.resolve(w);
            state = 'ready';
          })
          .catch(() => {
            workerP = null;
            state = 'failed';
          });
        return null;
      }
      state = 'ready';
      return worker;
    } catch {
      workerP = null;
      state = 'failed';
      return null;
    }
  })();
  return workerP;
}

/** Read one crop: a single line when it is short and wide, otherwise a block. */
const engine: OcrEngine = async (crop) => {
  const worker = await prepare();
  if (!worker) throw new Error('text engine unavailable');
  const want = crop.height / Math.max(1, crop.width) < 0.35 ? 'line' : 'block';
  if (want !== psm) {
    const { PSM } = await import('tesseract.js');
    await worker.setParameters({ tessedit_pageseg_mode: want === 'line' ? PSM.SINGLE_LINE : PSM.SINGLE_BLOCK });
    psm = want;
  }
  const { data } = await worker.recognize(crop);
  return { text: data.text, conf: data.confidence };
};

let enabled = false;
/** Turn the text pass on for Find focus areas and start preparing the engine in the background. */
export function enableTextReading() {
  if (!enabled) {
    enabled = true;
    setScanRefiner(makeTextPass(engine));
  }
  void prepare();
}
