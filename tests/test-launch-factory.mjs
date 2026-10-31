/**
 * Launch Factory contract (fast; the full ZIP export needs a real GPU and is checked separately):
 *  1. `/editor/?start=launch-factory` opens the dialog and removes the parameter.
 *  2. A package from five screens: 21 scenes, the 20 s promo first, each output bound to scenes in its
 *     own frame (iPhone, Google Play, feature graphic, 1:1, 4:5, 16:9).
 *  3. The pre-export check finds no problem; one Ctrl+Z restores the previous project.
 *  4. The launch record survives save → open; a crafted file cannot change sizes or paths.
 */
import puppeteer from 'puppeteer';

const URL = process.env.TEST_URL ?? 'http://localhost:5757';
const browser = await puppeteer.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1500, height: 950 },
});
let failed = 0;
const check = (name, ok, info) => {
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${name}${info === undefined ? '' : `  — ${JSON.stringify(info).slice(0, 300)}`}`);
};
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('mockuptop:tour-seen:v1', '1');
    localStorage.setItem('mockuptop:phone-gate:v1', 'continue');
    localStorage.setItem('mockuptop:whatsnew:2026-10-31', 'seen');
  });
  await page.goto(URL.replace(/\/+$/, '') + '/editor/?start=launch-factory', { waitUntil: 'networkidle2', timeout: 180000 });
  await page.waitForSelector('[data-launch-factory]', { timeout: 30000 });
  check('deep link opens Launch Factory', !(await page.evaluate(() => location.search.includes('start='))));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !!window.__mockuptop);
  const before = await page.evaluate(() => JSON.stringify(window.__mockuptop.state().shots.map((s) => s.id)));

  const r = await page.evaluate(() =>
    window.__mockuptop.debug.launch({
      screens: ['forma', 'aura', 'wander', 'colorhunt-home', 'colorhunt-palette'].map((n) => ({ url: `/demo/${n}.jpg`, name: `${n}.jpg` })),
      appName: 'Orbit',
      value: 'Plan your whole week in one calm place',
      features: ['Plan the week in seconds', 'Share lists with your team', 'Works offline, syncs later'],
      color: '#4f5bd5',
      logo: null,
      font: 'Inter',
      videoScreens: [1, 2, 3],
      direction: 'quiet',
    }),
  );
  await page.evaluate(() => window.__mockuptop.state().setPlaying(false));
  const st = await page.evaluate(() => {
    const s = window.__mockuptop.state();
    const byId = new Map(s.shots.map((x) => [x.id, x]));
    return {
      n: s.shots.length,
      video: s.shots.slice(0, 5).reduce((a, x) => a + x.duration, 0),
      outputs: s.launch.outputs.map((o) => ({ id: o.id, aspect: o.aspectId, scenes: o.shotIds.map((id) => byId.get(id)?.aspectId ?? null) })),
    };
  });
  check('21 scenes, the 20 s promo first', r && r.n === 21 && st.n === 21 && Math.abs(st.video - 20) < 0.01, { n: st.n, video: st.video });
  const wrong = st.outputs.filter((o) => !o.scenes.length || o.scenes.some((a) => a !== o.aspect));
  check('every output bound to scenes in its own frame', st.outputs.length === 17 && wrong.length === 0, wrong);

  const chk = await page.evaluate(() => window.__mockuptop.debug.launchCheck(['en']));
  check('pre-export check: no problems', chk.problems.length === 0, chk.problems);

  const snap = await page.evaluate(() => JSON.stringify(window.__mockuptop.snapshot()));
  const crafted = JSON.parse(snap);
  crafted.launch.outputs[1].files = [{ path: '../evil.png', w: 1, h: 1, format: 'png' }];
  await page.evaluate((d) => window.__mockuptop.applyProject(d), crafted);
  const reopened = await page.evaluate(() => window.__mockuptop.state().launch);
  // Let history record the open as its own step before the next package.
  await new Promise((r2) => setTimeout(r2, 800));
  check('save → open keeps the record; sizes and paths come from the contract', reopened && reopened.outputs.length === 17 && reopened.outputs[1].files.every((f) => !f.path.includes('..') && f.w > 1000));

  await page.evaluate(() => window.__mockuptop.debug.launch({
    screens: ['forma', 'aura', 'wander'].map((n) => ({ url: `/demo/${n}.jpg`, name: `${n}.jpg` })),
    appName: 'Orbit', value: 'Plan your week', features: ['One', 'Two', 'Three'], color: '#4f5bd5', logo: null, font: 'Inter', videoScreens: [1, 2, 0], direction: 'clear',
  }));
  await page.evaluate(() => window.__mockuptop.state().setPlaying(false));
  await new Promise((r2) => setTimeout(r2, 800));
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await new Promise((r2) => setTimeout(r2, 800));
  const undone = await page.evaluate(() => window.__mockuptop.state().launch?.direction ?? null);
  check('one Ctrl+Z goes back to the previous package', undone === 'quiet', { undone, before: before.length });
  check('no page errors', errors.length === 0, errors.slice(0, 2));
} finally {
  await browser.close();
}
console.log(failed ? `${failed} failed` : 'launch factory: all checks passed');
process.exit(failed ? 1 : 0);
