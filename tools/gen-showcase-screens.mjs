/**
 * Opening-demo showcase screens: UI written in HTML + photos.
 *
 * The UI (text, buttons, icons) lives in `tools/demo-screens/*.html`, because
 * diffusion models garble small text and code doesn't. Only the photo/art
 * content inside the screens is generated (`tools/demo-photos/*.jpg`, made
 * locally with FLUX.3 Image Klein). The backdrop `public/demo/stage.jpg` is
 * drawn procedurally by `tools/stage_bg.py`.
 *
 * Output is JPEG so no generator metadata travels with the files.
 *
 * Usage: node tools/gen-showcase-screens.mjs [name ...]
 * Output: public/demo/<name>.jpg
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, 'demo-screens');
const OUT = path.join(HERE, '..', 'public', 'demo');

// Phone 894×1958, laptop 1600×1057 (the sizes the demo project expects).
const PHONE = { width: 447, height: 979, deviceScaleFactor: 2 };
const LAPTOP = { width: 1280, height: 846, deviceScaleFactor: 1.25 };

const SCREENS = {
  wander: PHONE,
  aura: PHONE,
  forma: PHONE,
  lumen: LAPTOP,
};

const want = process.argv.slice(2);
const list = want.length ? want : Object.keys(SCREENS);
const browser = await puppeteer.launch({ headless: true });
for (const name of list) {
  const page = await browser.newPage();
  await page.setViewport(SCREENS[name]);
  await page.goto(pathToFileURL(path.join(SRC, `${name}.html`)).href, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 300));
  const file = path.join(OUT, `${name}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
  console.log('wrote', file);
  await page.close();
}
await browser.close();
