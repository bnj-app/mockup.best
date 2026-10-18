/**
 * Generate and compress device models.

 *   node tools/devices3d/build-all.mjs [device ...]

 * 1) Headless Blender (no window) -> tools/devices3d/raw/<device>.glb
 * 2) gltf-transform meshopt -> public/models/<device>.glb (4-5x smaller;
 *    loaded by GLTFLoader + MeshoptDecoder, see deviceModels.ts).
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const BLENDER = process.env.BLENDER ?? 'blender';
const ALL = ['phone', 'phone-max', 'tablet', 'watch', 'laptop', 'laptop-16', 'display', 'laptop-slim', 'display-27', 'android', 'android-ultra', 'phone-slim'];
const list = process.argv.slice(2).length ? process.argv.slice(2) : ALL;

if (process.env.SKIP_BLENDER !== '1') {
  execFileSync(BLENDER, ['-b', '--factory-startup', '-P', path.join(HERE, 'build.py'), '--', ...list], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}
for (const d of list) {
  const raw = path.join(HERE, 'raw', `${d}.glb`);
  const pruned = path.join(HERE, 'raw', `${d}.pruned.glb`);
  const out = path.join(ROOT, 'public', 'models', `${d}.glb`);
  /*
    1) PRUNE while preserving empty leaves. optimize's pruning removed the
    empty hinge node used as the laptop-lid/monitor-tilt pivot, disabling
    Lid angle. optimize does not expose this option.
  */
  execFileSync('npx', ['--yes', '@gltf-transform/cli@latest', 'prune', raw, pruned, '--keep-leaves', 'true'], {
    stdio: 'inherit',
    shell: true,
  });
  // 2) Compress with pruning disabled, since it ran above. Order matters:
  // pruning after compression decoded meshopt and wrote uncompressed files, 3x larger.
  execFileSync(
    'npx',
    ['--yes', '@gltf-transform/cli@latest', 'optimize', pruned, out,
      '--compress', 'meshopt', '--texture-compress', 'false', '--simplify', 'false',
      '--instance', 'false', '--join', 'false', '--flatten', 'false',
      // Disable palette: it merges materials and renames them PaletteMaterial.
      // The scene matches finishes by material name (finish_body...), so this broke matching.
      '--palette', 'false',
      '--prune', 'false'],
    { stdio: 'inherit', shell: true },
  );
}
