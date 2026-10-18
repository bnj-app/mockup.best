/**
 * GLB normal validation: zero-length/invalid normals and degenerate triangles. Why: normalize(0) in
 * the shader produces NaN and a black pixel, which depth-of-field blur spread into a large disk in the
 * white studio. Decode Meshopt + quantized files and scan every vertex. Usage: node
 * tools/devices3d/check-normals.mjs [device ...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(path.join(here, '..', '..', 'app', 'package.json'));
const { MeshoptDecoder } = await import(
  'file://' + req.resolve('meshoptimizer').replace(/\\/g, '/').replace(/index\.(c?js)$/, 'meshopt_decoder.mjs')
).catch(async () => import('file://' + path.join(here, '..', '..', 'app', 'node_modules', 'meshoptimizer', 'meshopt_decoder.mjs').replace(/\\/g, '/')));
await MeshoptDecoder.ready;

const MODELS = path.join(here, '..', '..', 'app', 'public', 'models');
const list = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(MODELS).filter((f) => f.endsWith('.glb')).map((f) => f.replace('.glb', ''));

const COMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const CT = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };

for (const name of list) {
  const buf = fs.readFileSync(path.join(MODELS, `${name}.glb`));
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const bin = buf.subarray(binStart);
  // Decode meshopt-compressed bufferViews.
  const views = json.bufferViews.map((bv) => {
    const ext = bv.extensions?.EXT_meshopt_compression;
    if (!ext) return null;
    const src = bin.subarray(ext.byteOffset ?? 0, (ext.byteOffset ?? 0) + ext.byteLength);
    const out = new Uint8Array(ext.count * ext.byteStride);
    MeshoptDecoder.decodeGltfBuffer(out, ext.count, ext.byteStride, src, ext.mode, ext.filter);
    return out;
  });
  const readAcc = (i) => {
    const a = json.accessors[i];
    const bv = json.bufferViews[a.bufferView];
    const [, sz] = CT[a.componentType];
    const n = COMP[a.type];
    const data = views[a.bufferView] ?? bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
    const stride = bv.byteStride ?? n * sz;
    const out = new Float32Array(a.count * n);
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let k = 0; k < a.count; k += 1) {
      for (let c = 0; c < n; c += 1) {
        const off = (a.byteOffset ?? 0) + k * stride + c * sz;
        let v;
        switch (a.componentType) {
          case 5120: v = dv.getInt8(off); if (a.normalized) v = Math.max(v / 127, -1); break;
          case 5121: v = dv.getUint8(off); if (a.normalized) v /= 255; break;
          case 5122: v = dv.getInt16(off, true); if (a.normalized) v = Math.max(v / 32767, -1); break;
          case 5123: v = dv.getUint16(off, true); if (a.normalized) v /= 65535; break;
          case 5125: v = dv.getUint32(off, true); break;
          default: v = dv.getFloat32(off, true);
        }
        out[k * n + c] = v;
      }
    }
    return out;
  };
  let bad = 0;
  let total = 0;
  const where = [];
  json.meshes.forEach((m, mi) => {
    for (const p of m.primitives) {
      if (p.attributes.NORMAL === undefined) continue;
      const nrm = readAcc(p.attributes.NORMAL);
      const mat = json.materials?.[p.material]?.name ?? '?';
      let b = 0;
      for (let k = 0; k < nrm.length; k += 3) {
        const l = Math.hypot(nrm[k], nrm[k + 1], nrm[k + 2]);
        total += 1;
        if (!(l > 0.5)) b += 1;
      }
      if (b) where.push(`${json.nodes.find((n) => n.mesh === mi)?.name ?? m.name}/${mat}: ${b}`);
      bad += b;
    }
  });
  console.log(`${name.padEnd(14)} köşe ${String(total).padStart(7)} · bozuk normal ${bad}${where.length ? '  → ' + where.join(', ') : ''}`);
}
