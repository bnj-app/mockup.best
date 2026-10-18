/**
 * Screen names for updating screenshots across scenes in one step.
 *
 * Each scene and extra device has a named screen, such as `home`,
 * `checkout`, or `screen-2`. Names default to the filename and can be edited
 * in Source. Dropping a new screenshot batch updates all matching screens
 * while preserving cameras, text, and scene editing.
 *
 * Pure helpers for naming, comparison keys, and file-to-screen matching.
 */

/**
 * Comparison key: ignore case and separators (`-`, `_`, spaces, dots),
 * so "Home Screen", "home_screen", and "home-screen" match.
 * Preserve digits: `screen-1` and `screen-2` are different screens.
 */
export function screenKey(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Screen name from filename: strip extension, copy markers (` (1)`, ` copy`),
 * and Retina suffix (`@2x`). Preserve case for display, collapsing separators.
 */
export function screenNameFromFile(fileName: string | null | undefined): string | null {
  if (!fileName) return null;
  let n = fileName.replace(/\.[a-z0-9]{1,5}$/i, '');
  n = n
    .replace(/\s*\(\d+\)$/, '')
    .replace(/[\s_-]*copy(\s*\d+)?$/i, '')
    .replace(/@[1-4]x$/i, '')
    .replace(/[\s_.]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  n = n.slice(0, 40);
  return screenKey(n) ? n : null;
}

/**
 * Version-stripped key for a second pass only when no exact match exists:
 * `home-v2`, `home-final`, `home-new` → `home`.
 */
function looseKey(key: string): string {
  return key.replace(/-(v\d+|final|new|updated|latest)$/, '');
}

export type ScreenFile = { key: string; name: string };

/**
 * Match files to screens; return screen key → file index.
 * Each file matches at most one screen. Try exact keys before stripping versions.
 */
export function matchFiles(screenKeys: string[], files: ScreenFile[]): Record<string, number> {
  const out: Record<string, number> = {};
  const used = new Set<number>();
  const byKey = new Map<string, number>();
  files.forEach((f, i) => {
    if (!byKey.has(f.key)) byKey.set(f.key, i);
  });
  for (const k of screenKeys) {
    const i = byKey.get(k);
    if (i !== undefined && !used.has(i)) {
      out[k] = i;
      used.add(i);
    }
  }
  for (const k of screenKeys) {
    if (out[k] !== undefined) continue;
    const i = files.findIndex((f, j) => !used.has(j) && looseKey(f.key) === looseKey(k));
    if (i >= 0) {
      out[k] = i;
      used.add(i);
    }
  }
  return out;
}
