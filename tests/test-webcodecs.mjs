/**
 * FRAME-BY-FRAME EXPORT (WebCodecs).

 * Real-time MediaRecorder captures dropped preview frames in the file.
 * This test deliberately stalls the main thread with a long busy loop every
 * frame, then checks that output duration/frame count remain correct.
 * The real-time path would produce a shortened or skipping file.
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { ensurePro } from './pro-gate.mjs';

const URL = process.env.TEST_URL ?? 'http://localhost:5757';
const dl = path.resolve('tests/out/webcodecs');
fs.rmSync(dl, { recursive: true, force: true });
fs.mkdirSync(dl, { recursive: true });

const browser = await puppeteer.launch({
  headless: false,
  args: ['--window-size=1500,1000'],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
const cdp = await page.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
await page.evaluateOnNewDocument(() => localStorage.setItem('mockuptop:tour-seen:v1', '1'));
/*
  Pro gate: debug.setPro exists only on localhost. Without production access,
  the button stays at "Upgrade to export video", clicking does nothing,
  and the test reports a download timeout.
  ⚠️ The old unlock query value was removed because it was readable in the
  static bundle. In production, ?unlock only disables access.
*/
await page.goto(URL.replace(/\/+$/, '') + '/editor/', {
  waitUntil: 'networkidle2',
  timeout: 90000,
});
await page.waitForFunction('window.__mockuptop.state().assetsReady === true', { timeout: 60000 });

let fail = 0;
const check = (name, ok, extra = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};

check('Browser supports WebCodecs', await page.evaluate(() => 'VideoEncoder' in window));

// 2 scenes x 2 s = 4 s, without audio -> frame-by-frame path.
await page.evaluate(() => {
  window.__mockuptop.reset();
  /*
     ⚠️ New projects contain one scene; explicitly add a second scene
     to exercise multi-scene export.
     */
  window.__mockuptop.state().addShot();
  const s = window.__mockuptop.state();
  s.shots.forEach((sh) => {
    s.selectShot(sh.id);
    s.patchShot({ duration: 2 });
  });
  s.selectShot(s.shots[0].id);
  window.__mockuptop.play(false);
});
check('Pro enabled', await ensurePro(page));
await new Promise((r) => setTimeout(r, 800));

/*
  STALL THE MAIN THREAD. A ~40 ms busy loop per rAF reduces real-time recording
  from 60 to about 20 fps, shortening the file or causing skipped frames.
*/
await page.evaluate(() => {
  window.__stall = true;
  const loop = () => {
    if (!window.__stall) return;
    const t = performance.now();
    while (performance.now() - t < 40) {
      /* Intentionally busy. */
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});

const clickText = (t) =>
  page.evaluate((txt) => {
    const el = [...document.querySelectorAll('button')].find((b) =>
      b.textContent.trim().toLowerCase().startsWith(txt),
    );
    el?.click();
    return !!el;
  }, t);
await clickText('export');
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Video')?.click();
});
await new Promise((r) => setTimeout(r, 300));
// Select 30 fps: 4 s x 30 = 120 frames.
await page.evaluate(() => {
  const sel = [...document.querySelectorAll('select')].find((s) =>
    [...s.options].some((o) => o.textContent.includes('30')),
  );
  if (sel) {
    const opt = [...sel.options].find((o) => o.textContent.trim() === '30');
    if (opt) {
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
});
await new Promise((r) => setTimeout(r, 300));
await clickText('export video');
console.log('Frame-by-frame recording started (main thread stalled)…');

const file = await new Promise((resolve, reject) => {
  const to = setTimeout(() => reject(new Error('Download timeout')), 180000);
  const poll = setInterval(() => {
    const f = fs.readdirSync(dl).find((x) => x.endsWith('.mp4') || x.endsWith('.webm'));
    if (f) {
      clearTimeout(to);
      clearInterval(poll);
      resolve(path.join(dl, f));
    }
  }, 500);
});
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(() => {
  window.__stall = false;
});

const size = fs.statSync(file).size;
const b64 = fs.readFileSync(file).toString('base64');
const meta = await page.evaluate(
  (data) =>
    new Promise((res) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => res({ w: v.videoWidth, h: v.videoHeight, dur: v.duration });
      v.onerror = () => res({ error: 'decode failed' });
      v.src = `data:video/mp4;base64,${data}`;
    }),
  b64,
);
console.log(`File: ${path.basename(file)} · ${(size / 1024).toFixed(0)} KB · ${meta.w}x${meta.h} · ${Number(meta.dur).toFixed(2)}s`);
check('MP4 decodes', !meta.error, String(meta.error ?? ''));
check('Resolution is correct', meta.w === 1920 && meta.h === 1080, `${meta.w}x${meta.h}`);
check(
  'Duration is correct despite a stalled main thread',
  meta.dur > 3.8 && meta.dur < 4.25,
  `${Number(meta.dur).toFixed(2)}s (expected 4.00)`,
);

await browser.close();
console.log(fail === 0 ? '\nALL PASSED' : `\n${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
