/**
 * Shared Pro gate for the tests.
 *
 * Every feature is free (`FREE_FOR_ALL` in `src/config/brand.ts`), so `isPro`
 * is normally already true. If the constant is switched off, the localhost-only
 * debug surface can still turn Pro on for a test run.
 */
export async function ensurePro(page) {
  if (await page.evaluate(() => window.__mockuptop?.state().isPro === true)) return true;
  return page.evaluate(() => {
    if (!window.__mockuptop?.debug) return false;
    window.__mockuptop.debug.setPro(true);
    return window.__mockuptop.state().isPro === true;
  });
}
