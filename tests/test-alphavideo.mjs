/**
 * TRANSPARENT VIDEO test: scene.transparent + VP8 WebM recording.
 * Is the corner TRANSPARENT and the device OPAQUE in the played frame? (headless GPU)
 *   TEST_URL=http://localhost:5757 node test-alphavideo.mjs
 */
import puppeteer from 'puppeteer';
const URL = process.env.TEST_URL ?? 'http://localhost:5757';
const b = await puppeteer.launch({ headless: true, args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const p = await b.newPage();
await p.setViewport({ width: 1100, height: 750 });
await p.evaluateOnNewDocument(() => localStorage.setItem('mockuptop:tour-seen:v1', '1'));
await p.goto(URL.replace(/\/+$/, '') + '/editor/', { waitUntil: 'networkidle2' });
await p.waitForFunction('window.__mockuptop && window.__mockuptop.state().assetsReady === true', { timeout: 90000 });
const r = await p.evaluate(async () => {
  const m = window.__mockuptop;
  m.reset();
  m.play(false);
  const s = m.state();
  s.patchShot({ deviceId: 'phone', finishId: 'black', media: '/demo/aura.jpg', mediaKind: 'image', scene: { ...s.active().scene, transparent: true } });
  s.patchCamera({ tiltX: -10, tiltY: 20, zoom: 2.4, panX: 0, panY: 0 });
  await new Promise((x) => setTimeout(x, 1500));
  m.play(true);
  const out = await m.debug.record({ durationMs: 1500, width: 640, height: 360, mime: 'video/webm;codecs=vp8' });
  m.play(false);
  const blob = await (await fetch(`data:${out.mime};base64,${out.base64}`)).blob();
  const v = document.createElement('video');
  v.muted = true;
  v.src = URL.createObjectURL(blob);
  await new Promise((ok) => { v.onloadeddata = ok; v.load(); });
  /*
    NO SEEKING: MediaRecorder WebM lacks duration metadata, so setting
    `currentTime` is unreliable (blank frames caused false failures).
    Playing for half a second and then pausing is reliable.
  */
  await v.play().catch(() => {});
  await new Promise((ok) => setTimeout(ok, 500));
  v.pause();
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  const x = c.getContext('2d');
  x.drawImage(v, 0, 0);
  return { mime: out.mime, w: c.width, corner: x.getImageData(4, 4, 1, 1).data[3], center: x.getImageData(c.width >> 1, c.height >> 1, 1, 1).data[3] };
});
const ok = r.mime.includes('webm') && r.corner < 20 && r.center > 200;
console.log(JSON.stringify(r));
console.log(ok ? 'PASS — corner transparent, device opaque' : 'FAIL');
await b.close();
process.exit(ok ? 0 : 1);
