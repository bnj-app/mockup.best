/**
 * TEXT READING ENGINE (Tesseract.js, Apache-2.0) for Find focus areas.
 *
 * Everything is served by this site from /ocr (tools/copy-ocr.mjs): the worker, the LSTM core the
 * browser supports, and the English fast model. No third-party request, nothing leaves the device.
 * Nothing is downloaded on page load: the engine is prepared when Auto-motion opens (one worker,
 * reused; the model is kept in IndexedDB for the next visit), and Find never waits for it longer than
 * the text pass budget (lib/ocrRefine.ts) — if it is not ready yet, the pixel result is used.
 *
 * A worker whose model download fails never finishes starting and cannot be stopped. So the model is
 * checked (HEAD) before a worker is started, a failed start is reported through `errorHandler`, and
 * starts are limited per session; a failure is retried on the next user action, not per candidate.
 */

import type { Worker } from 'tesseract.js';
import { makeTextPass, type OcrEngine } from '@/lib/ocrRefine';
import { setScanRefiner, type ScanRefiner } from '@/components/scene/autoMotion';

/** After this long (download + start) Find stops waiting; a slow setup still finishes for later. */
const SETUP_TIMEOUT_MS = 8000;
/** Engine starts allowed per session: a worker that failed to start cannot be stopped, so few. */
const MAX_WORKER_STARTS = 2;
const MODEL_URL = '/ocr/eng.traineddata.gz';

type ReaderState = 'idle' | 'loading' | 'ready' | 'failed' | 'unsupported';
let state: ReaderState = 'idle';
/** Engine state (tests and diagnostics). */
export const textReaderState = () => state;

let worker: Worker | null = null;
let setupP: Promise<Worker | null> | null = null;
let slow = false;
let starts = 0;
/** One new setup per user action (opening Auto-motion, each Find), never one per candidate. */
let mayStart = false;
let psm: 'line' | 'block' | null = null;

/** Is the model there (no body downloaded)? A missing file or an HTML fallback page must not reach a worker. */
async function checkModel(): Promise<void> {
  let r: Response;
  try {
    r = await fetch(MODEL_URL, { method: 'HEAD', cache: 'no-store' });
  } catch {
    // Offline: the worker may still have the model in IndexedDB; a failure is caught below.
    return;
  }
  if (!r.ok || /text\/html/i.test(r.headers.get('content-type') ?? '')) throw new Error(`text model: HTTP ${r.status}`);
}

async function startWorker(): Promise<Worker> {
  const T = await import('tesseract.js');
  psm = null;
  starts += 1;
  return new Promise<Worker>((resolve, reject) => {
    T.createWorker('eng', T.OEM.LSTM_ONLY, {
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr/',
      langPath: '/ocr',
      gzip: true,
      // A same-origin worker file (no blob: URL).
      workerBlobURL: false,
      // Setup errors reject here (some never settle the library's promise); later job errors reject
      // their own job. Without a handler the library also throws each one as an uncaught error.
      errorHandler: (e: unknown) => {
        if (state === 'loading') reject(e);
      },
    }).then(resolve, reject);
  });
}

function prepare(): Promise<Worker | null> {
  if (worker) return Promise.resolve(worker);
  if (setupP) return slow ? Promise.resolve(null) : setupP;
  if (!mayStart || state === 'unsupported') return Promise.resolve(null);
  mayStart = false;
  if (typeof WebAssembly !== 'object' || starts >= MAX_WORKER_STARTS) {
    state = 'unsupported';
    return Promise.resolve(null);
  }
  state = 'loading';
  slow = false;
  const timer = setTimeout(() => (slow = true), SETUP_TIMEOUT_MS);
  setupP = checkModel()
    .then(startWorker)
    .then(
      (w) => {
        worker = w;
        state = 'ready';
        return w;
      },
      () => {
        // A failed download is retried on the next action; a failed engine start only once more.
        state = starts >= MAX_WORKER_STARTS ? 'unsupported' : 'failed';
        return null;
      },
    )
    .finally(() => {
      clearTimeout(timer);
      setupP = null;
      slow = false;
    });
  return setupP;
}

/** Read one crop: a single line when it is short and wide, otherwise a block. */
const engine: OcrEngine = async (crop) => {
  const w = await prepare();
  if (!w) throw new Error('text engine unavailable');
  const want = crop.height / Math.max(1, crop.width) < 0.35 ? 'line' : 'block';
  if (want !== psm) {
    const { PSM } = await import('tesseract.js');
    await w.setParameters({ tessedit_pageseg_mode: want === 'line' ? PSM.SINGLE_LINE : PSM.SINGLE_BLOCK });
    psm = want;
  }
  const { data } = await w.recognize(crop);
  return { text: data.text, conf: data.confidence };
};

const textPass = makeTextPass(engine);
const refine: ScanRefiner = (scan, source, size) => {
  mayStart = true;
  return textPass(scan, source, size);
};

let enabled = false;
/** Turn the text pass on for Find focus areas and start preparing the engine in the background. */
export function enableTextReading() {
  if (!enabled) {
    enabled = true;
    setScanRefiner(refine);
  }
  mayStart = true;
  void prepare();
}
