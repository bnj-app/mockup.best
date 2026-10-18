// Runs every tests/test-*.mjs against a running dev server (default http://localhost:5757,
// override with TEST_URL). Exit code 1 if any test fails.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const tests = fs.readdirSync(dir).filter((f) => /^test-.*\.mjs$/.test(f)).sort();
let failed = 0;
for (const t of tests) {
  console.log(`\n=== ${t}`);
  const r = spawnSync(process.execPath, [path.join(dir, t)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
