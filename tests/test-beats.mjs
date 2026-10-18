// Guard test: music beats — detection, ruler markers, beat snapping, "Cut scenes on beats".
// Headless with a real GPU (no window). Exit code 1 if any check fails.
// Synthesize audio in Node (WAV with known beat times), then upload through the real "+ AUDIO" file input
// to exercise browser decoding and OfflineAudioContext resampling.
// debug is localhost-only; do not run against production (TEST_URL=http://localhost:5757).
//
//  A. Detection: 128 BPM (kick + snare + high offbeat hi-hat) → tempo ±0.5; ≥95% of true beats within 15 ms.
//  B. Beat ruler markers; Beats menu only when audio exists.
//  C. Scene-end trim handle snaps to beats (±2 ms; previously rounded to 0.1); Alt and
//     disabling "Snap to beats" bypass snapping.
//  D. Keyframe dragging snaps to beats, taking priority over the 0.5-second grid when both are in range.
//  E. "Every 4": scene ends align every 4 beats; keyframes scale proportionally to the new duration;
//     one undo step restores original durations.
//  F. Moving audio by 1 second shifts beats by 1 second too.
//  G. New projects clear audio; undecodable files and beatless audio (pure tone) show "No clear beat" without page errors.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.env.TEST_URL ?? 'http://localhost:5757').replace(/\/+$/, '');
const OUT = path.resolve('tests/out/beats');
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (name, cond, info = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${info ? '  — ' + info : ''}`);
  if (!cond) fails += 1;
};
const f3 = (n) => (typeof n === 'number' ? n.toFixed(3) : String(n));

/* ---------------------------------------------------------------- synthesis */
function writeWav(file, x, sr) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + x.length * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32000), 44 + i * 2);
  fs.writeFileSync(file, b);
}
/** Kick on every beat, snare on 2 and 4, high hi-hat between beats. Returns true beat times. */
function beatTrack(file, { bpm, dur, offset, sr = 44100 }) {
  const x = new Float32Array(Math.round(dur * sr));
  let s = 7;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const P = 60 / bpm;
  const truth = [];
  for (let t = offset; t < dur - 0.05; t += P) {
    const i0 = Math.round(t * sr);
    for (let i = 0; i < sr * 0.18 && i0 + i < x.length; i++) {
      const tt = i / sr;
      x[i0 + i] += 0.8 * Math.sin(2 * Math.PI * (50 + 120 * Math.exp(-tt * 30)) * tt) * Math.exp(-tt * 18);
    }
    if (truth.length % 2 === 1) {
      for (let i = 0; i < sr * 0.15 && i0 + i < x.length; i++) {
        const tt = i / sr;
        x[i0 + i] += 0.4 * ((rnd() * 2 - 1) * 0.7 + 0.5 * Math.sin(2 * Math.PI * 190 * tt)) * Math.exp(-tt * 25);
      }
    }
    const h0 = Math.round((t + P / 2) * sr);
    let pn = 0;
    for (let i = 0; i < sr * 0.04 && h0 + i < x.length; i++) {
      const nn = rnd() * 2 - 1;
      x[h0 + i] += 0.4 * (nn - pn) * Math.exp(-(i / sr) * 90);
      pn = nn;
    }
    truth.push(t);
  }
  writeWav(file, x, sr);
  return truth;
}
const WAV = path.join(OUT, 'beat128.wav');
const TRUTH = beatTrack(WAV, { bpm: 128, dur: 16, offset: 0.37 });
const TONE = path.join(OUT, 'tone.wav');
{
  const sr = 44100;
  const x = new Float32Array(sr * 6);
  for (let i = 0; i < x.length; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / sr) * Math.min(1, i / (sr * 0.5));
  writeWav(TONE, x, sr);
}
const JUNK = path.join(OUT, 'junk.mp3');
fs.writeFileSync(JUNK, Buffer.from(Array.from({ length: 20000 }, (_, i) => (i * 7919) % 251)));

/* ---------------------------------------------------------------- browser */
const browser = await puppeteer.launch({
  headless: true,
  args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1400, height: 900 },
});
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('mockuptop:tour-seen:v1', '1');
  localStorage.setItem('mockuptop:whatsnew:2026-10-15', 'seen');
});
await page.goto(BASE + '/editor/', { waitUntil: 'networkidle2', timeout: 90000 });
await page.waitForFunction('window.__mockuptop && window.__mockuptop.state().assetsReady === true', { timeout: 90000 });
if (!(await page.evaluate(() => !!window.__mockuptop.debug))) {
  console.log('ℹ debug unavailable (production build) — this guard test is localhost-only');
  await browser.close();
  process.exit(0);
}

async function fresh(shots = 3) {
  await page.evaluate((shots) => {
    const m = window.__mockuptop;
    m.reset();
    m.play(false);
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 800;
    const x = c.getContext('2d');
    x.fillStyle = '#888';
    x.fillRect(0, 0, 400, 800);
    m.state().setMedia(c.toDataURL('image/png'), 'image', 'beats.png');
    for (let i = 1; i < shots; i++) m.state().addShot();
    for (const s of m.state().shots) m.state().setShotDuration(s.id, 3);
    m.state().selectShot(m.state().shots[0].id);
    m.seek(0);
  }, shots);
  await wait(700);
}
async function upload(file) {
  const input = await page.$('input[type="file"][accept="audio/*"]');
  await input.uploadFile(file);
  await page.waitForFunction(
    () => {
      const b = window.__mockuptop.debug.beats();
      const a = window.__mockuptop.state().audioTracks;
      return b.state !== 'loading' && a.length && a[a.length - 1].duration > 0;
    },
    { timeout: 40000 },
  ).catch(() => {});
  await wait(400);
}
const beats = () => page.evaluate(() => window.__mockuptop.debug.beats());
const shotsNow = () =>
  page.evaluate(() =>
    window.__mockuptop.state().shots.map((s) => ({ id: s.id, d: s.duration, g: s.gapBefore, kfs: s.tracks.flatMap((t) => t.keyframes.map((k) => k.t)) })),
  );
const openMenu = async () => {
  if (!(await page.$('[data-testid="beats-status"]'))) await page.click('[data-testid="beats-menu"]');
  await wait(250);
};
const closeMenu = async () => {
  if (await page.$('[data-testid="beats-status"]')) await page.click('[data-testid="beats-menu"]');
  await wait(200);
};
/** Ruler beat marker's x position in page pixels; data-beat stores its time. */
const beatX = (t) =>
  page.evaluate((t) => {
    const el = [...document.querySelectorAll('[data-beat]')].find((e) => Math.abs(Number(e.dataset.beat) - t) < 0.002);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.left + r.width / 2;
  }, t);
async function dragX(handle, toX, alt = false) {
  const box = await handle.boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.move(toX, y, { steps: 10 });
  await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
  await wait(300);
}

/* ------------------------------------------------------------- A + B */
console.log('A. detection');
await fresh();
ok('no Beats menu without audio', !(await page.$('[data-testid="beats-menu"]')));
await upload(WAV);
const b0 = await beats();
const near = TRUTH.map((t) => Math.min(...b0.beats.map((d) => Math.abs(d - t))));
const hit = near.filter((e) => e <= 0.015).length / TRUTH.length;
const bias = (near.reduce((a, e) => a + e, 0) / near.length) * 1000;
ok('tempo 128 ± 0.5', Math.abs(b0.bpm - 128) <= 0.5, `${b0.bpm} BPM · state ${b0.state}`);
ok('≥95% of beats within 15 ms', hit >= 0.95, `${(hit * 100).toFixed(1)} % · ${b0.beats.length}/${TRUTH.length} beats · mean deviation ${bias.toFixed(1)} ms · first ${b0.beats[0]}`);
console.log('B. ruler + menu');
const marks = await page.$$eval('[data-beat]', (els) => els.length);
ok('beat markers on ruler', marks >= 15, `${marks} markers`);
await openMenu();
const status = await page.$eval('[data-testid="beats-status"]', (e) => e.textContent);
ok('menu shows tempo', /128 BPM/.test(status), status);
await closeMenu();

/* ------------------------------------------------------------- C. trim */
console.log('C. scene end snaps to beat');
// Scene 1 ends at 3.0; nearest beat ≈ 3.18. Drop the handle 4 px to the right of the beat.
const target = b0.beats.find((b) => b > 3.05 && b < 3.4);
let handle = (await page.$$('[title="Drag to trim duration"]'))[0];
await dragX(handle, (await beatX(target)) + 4);
let sh = await shotsNow();
ok('trim snapped to beat', Math.abs(sh[0].d - target) <= 0.002, `duration ${f3(sh[0].d)} · beat ${f3(target)}`);
await page.evaluate(() => window.__mockuptop.state().setShotDuration(window.__mockuptop.state().shots[0].id, 3));
await wait(300);
handle = (await page.$$('[title="Drag to trim duration"]'))[0];
await dragX(handle, (await beatX(target)) + 4, true);
sh = await shotsNow();
ok('Alt bypasses snapping', Math.abs(sh[0].d - target) > 0.004, `duration ${f3(sh[0].d)}`);
await page.evaluate(() => {
  window.__mockuptop.state().setShotDuration(window.__mockuptop.state().shots[0].id, 3);
  window.__mockuptop.state().setBeatSnap(false);
});
await wait(300);
handle = (await page.$$('[title="Drag to trim duration"]'))[0];
await dragX(handle, (await beatX(target)) + 4);
sh = await shotsNow();
ok('no snapping when "Snap to beats" is off', Math.abs(sh[0].d - target) > 0.004, `duration ${f3(sh[0].d)}`);
await page.evaluate(() => {
  window.__mockuptop.state().setShotDuration(window.__mockuptop.state().shots[0].id, 3);
  window.__mockuptop.state().setBeatSnap(true);
});
await wait(300);

/* ------------------------------------------------------------- D. keyframe */
console.log('D. keyframe snaps to beat');
await page.evaluate(() => {
  const s = window.__mockuptop.state();
  s.selectShot(s.shots[0].id);
  s.setPlayhead(0.6);
  s.patchCamera({ zoom: 2 });
  s.toggleTrackKeyframe('camera.zoom');
  s.setPlayhead(2.6);
  s.setAnimatable('camera.zoom', 5);
  s.setPlayhead(2.95);
});
await page.evaluate(() => document.querySelector('button[aria-label="Expand scene"]')?.click());
await wait(500);
const kTarget = b0.beats.find((b) => b > 0.75 && b < 1.0); // ≈ 0.84; 1.0 grid is also nearby
const diamonds = await page.$$('button[title*="drag to move"]');
if (!diamonds.length) ok('diamond found', false);
else {
  // Drop between the beat and 1.0 grid line, closer to the grid but within both 10 px thresholds:
  // without beat priority, the keyframe would move to 1.0.
  const xb = await beatX(kTarget);
  const xb2 = await beatX(b0.beats[b0.beats.indexOf(kTarget) + 2]);
  const pxPerSec = (xb2 - xb) / (b0.beats[b0.beats.indexOf(kTarget) + 2] - kTarget);
  const thr = 10 / pxPerSec;
  const d = 1.0 - kTarget;
  const drop = kTarget + Math.min(0.55 * d, 0.9 * thr);
  const both = drop - kTarget < thr && 1.0 - drop < thr && 1.0 - drop < drop - kTarget;
  await dragX(diamonds[0], xb + (drop - kTarget) * pxPerSec);
  sh = await shotsNow();
  const k0 = Math.min(...sh[0].kfs);
  ok('keyframe snapped to beat even with a closer grid line', both && Math.abs(k0 - kTarget) <= 0.006, `drop ${f3(drop)} · keyframe ${f3(k0)} · beat ${f3(kTarget)} · grid 1.000 · threshold ${f3(thr)} s`);
}

/* ------------------------------------------------------------- E. cut */
console.log('E. Cut scenes on beats — every 4');
// The previous drag writes history after a 350 ms debounce; measuring before it commits would count that step too.
await wait(900);
const before = await shotsNow();
const hist0 = await page.evaluate(() => window.__mockuptop.debug.history());
await openMenu();
await page.click('[data-testid="beats-cut-4"]');
await wait(900);
const after = await shotsNow();
const hist1 = await page.evaluate(() => window.__mockuptop.debug.history());
let end = 0;
const ends = after.map((s) => (end += s.g + s.d));
const want = [4, 8, 12].map((i) => b0.beats[i]);
ok('each scene ends on every fourth beat', ends.every((e, i) => Math.abs(e - want[i]) <= 0.002), `ends ${ends.map(f3).join(' ')} · beats ${want.map(f3).join(' ')}`);
const f = after[0].d / before[0].d;
const kOk = before[0].kfs.every((t, i) => Math.abs(after[0].kfs[i] - t * f) <= 0.011);
ok('keyframes scale proportionally to new duration', kOk, `${before[0].kfs.map(f3).join(',')} × ${f.toFixed(3)} → ${after[0].kfs.map(f3).join(',')}`);
ok('one undo step', hist1.undo - hist0.undo === 1, `${JSON.stringify(hist0)} → ${JSON.stringify(hist1)}`);
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.down('Control');
await page.keyboard.press('z');
await page.keyboard.up('Control');
await wait(600);
const undone = await shotsNow();
ok('undo restores original durations', undone.every((s, i) => Math.abs(s.d - before[i].d) < 1e-9), undone.map((s) => f3(s.d)).join(' '));

/* ------------------------------------------------------------- F. audio shift */
console.log('F. audio shift');
await page.evaluate(() => {
  const s = window.__mockuptop.state();
  s.patchAudio(s.audioTracks[0].id, { start: 1 });
});
await wait(400);
const b1 = await beats();
ok('beats shift +1 s with audio', b1.beats.length === b0.beats.length && b1.beats.every((b, i) => Math.abs(b - b0.beats[i] - 1) < 1e-6), `${b0.beats.slice(0, 3).join(',')} → ${b1.beats.slice(0, 3).join(',')}`);

/* ------------------------------------------------------------- G. beatless */
console.log('G. undecodable / beatless audio');
for (const [file, name] of [
  [JUNK, 'undecodable file'],
  [TONE, 'pure tone'],
]) {
  await fresh(1);
  // "New project" must not retain the previous project's audio, as it formerly did.
  const left = await page.evaluate(() => window.__mockuptop.state().audioTracks.length);
  ok(`new project clears audio (before ${name})`, left === 0 && !(await page.$('[data-testid="beats-menu"]')), `${left} tracks`);
  await upload(file);
  await openMenu();
  const st = await page.$eval('[data-testid="beats-status"]', (e) => e.textContent);
  const n = await page.$$eval('[data-beat]', (els) => els.length);
  ok(`${name} → "No clear beat", no markers`, /No clear beat/.test(st) && n === 0, `${st} · ${n} markers`);
  await closeMenu();
}
ok('no page errors', pageErrors.length === 0, pageErrors[0] ?? '');

await browser.close();
console.log(fails ? `✗ ${fails} checks failed` : '✓ beats: all checks passed');
process.exit(fails ? 1 : 0);
