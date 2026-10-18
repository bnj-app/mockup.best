/**
 * Export validation: does PNG output include the entire pipeline?
 *
 * Why: captureFrame once bypassed the composer and text layer with raw
 * gl.render, producing free-plan images without watermarks or blur/effects.
 * This test guards against that regression:
 *  1. Enable vignette; corners must be noticeably darker than the center.
 *  2. Watermark expectations depend on window.__mockuptop.freeForAll:
 *     • no watermark when everything is free;
 *     • a watermark on free-plan output when the paywall is enabled.
 *  3. Output must have the requested 1920×1080 dimensions.
 *
 * Detect the watermark's dark box and white text together: the lower-right
 * region must contain both very dark and very bright pixels. Checking only
 * for bright pixels would always succeed on a light scene.
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.TEST_URL ?? 'http://localhost:5757';
const dlDir = path.resolve('tests/out/export');
fs.rmSync(dlDir, { recursive: true, force: true });
fs.mkdirSync(dlDir, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1500, height: 950 },
});
const page = await browser.newPage();
const cdp = await page.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', {
  behavior: 'allow',
  downloadPath: dlDir,
  eventsEnabled: true,
});

await page.goto(URL.replace(/\/+$/, '') + '/editor/', { waitUntil: 'networkidle2', timeout: 90000 });
await page.waitForSelector('canvas');
await new Promise((r) => setTimeout(r, 2500));
// The startup demo autoplays; reset to a known empty state.
await page.evaluate(() => window.__mockuptop.reset());
await new Promise((r) => setTimeout(r, 800));
await new Promise((r) => setTimeout(r, 3000));

// Full vignette: corner/center contrast proves the effect pass ran.
await page.evaluate(() => {
  window.__mockuptop.state().addEffect('vignette', 1);
});
await new Promise((r) => setTimeout(r, 1200));

// EXPORT menu → Export image (default 1080p PNG).
const clickByText = async (text) => {
  const ok = await page.evaluate((t) => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent.trim().toLowerCase().startsWith(t.toLowerCase()),
    );
    if (!btn) return false;
    btn.click();
    return true;
  }, text);
  if (!ok) throw new Error(`Button not found: ${text}`);
};

await clickByText('export');
await new Promise((r) => setTimeout(r, 600));
await clickByText('export image');

// Wait for the download to finish.
// Allow 90 s: SwiftShader (CPU rendering) takes ~29.5 s for 1080p SSAA +
// 8 jitter samples; 30 s caused false failures. A real GPU takes 0.6 s.
const file = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('Download timed out')), 90000);
  const poll = setInterval(() => {
    const done = fs.readdirSync(dlDir).find((f) => f.endsWith('.png'));
    if (done) {
      clearTimeout(t);
      clearInterval(poll);
      resolve(path.join(dlDir, done));
    }
  }, 300);
});
await new Promise((r) => setTimeout(r, 500));

/*
  Decode PNG in the browser: pass the file as base64 and read canvas pixels
  to avoid adding a Node PNG decoder dependency.
*/
const b64 = fs.readFileSync(file).toString('base64');
const result = await page.evaluate(async (data) => {
  const img = new Image();
  img.src = `data:image/png;base64,${data}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const lum = (x, y, w, h) => {
    const d = ctx.getImageData(x, y, w, h).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return sum / (d.length / 4) / 255;
  };

  // Lower-right watermark, sized at ~3% of the short edge.
  const u = Math.min(img.width, img.height);
  const wmW = Math.round(u * 0.30);
  const wmH = Math.round(u * 0.06);
  const wmX = img.width - Math.round(u * 0.02) - wmW;
  const wmY = img.height - Math.round(u * 0.045) - wmH;
  const wm = ctx.getImageData(wmX, wmY, wmW, wmH).data;
  let dark = 0;
  let bright = 0;
  for (let i = 0; i < wm.length; i += 4) {
    const l = 0.2126 * wm[i] + 0.7152 * wm[i + 1] + 0.0722 * wm[i + 2];
    if (l < 90) dark += 1;
    else if (l > 200) bright += 1;
  }

  return {
    width: img.width,
    height: img.height,
    corner: lum(4, 4, 40, 40),
    center: lum(Math.round(img.width / 2) - 20, Math.round(img.height / 2) - 20, 40, 40),
    wmDark: dark,
    wmBright: bright,
  };
}, b64);

const fails = [];
if (result.width !== 1920 || result.height !== 1080)
  fails.push(`dimensions ${result.width}x${result.height}, expected 1920x1080`);
// With vignette 1.0, the corner must be clearly darker than the center.
if (!(result.corner < result.center * 0.6))
  fails.push(`vignette missing from output: corner ${result.corner.toFixed(3)} / center ${result.center.toFixed(3)}`);
// A watermark requires both dark-box and white-text pixels in the region.
const FREE = await page.evaluate(() => window.__mockuptop.freeForAll === true);
const watermarked = result.wmDark > 200 && result.wmBright > 50;
if (FREE && watermarked)
  fails.push(`everything is free but output has a WATERMARK: dark=${result.wmDark} bright=${result.wmBright}`);
if (!FREE && !watermarked)
  fails.push(`watermark appears missing: dark=${result.wmDark} bright=${result.wmBright}`);

console.log(`mode: ${FREE ? 'EVERYTHING FREE (NO watermark expected)' : 'paywall (watermark EXPECTED)'}`);
console.log(JSON.stringify(result, null, 2));
if (fails.length) {
  console.log('✗ EXPORT TEST FAILED:\n- ' + fails.join('\n- '));
  process.exitCode = 1;
} else {
  console.log(
    `✓ export: dimensions + vignette + watermark(${FREE ? 'absent' : 'present'}) OK →`,
    path.basename(file),
  );
}

await browser.close();
