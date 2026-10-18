import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { DEVICES } from '@/config/devices';

/**
 * Device model (GLB) loading cache. Models are built in Blender with `tools/devices3d/build.py` and
 * contain hardware only (body, buttons, cameras). Screen, bezel band, and cover glass remain in
 * Stage.tsx DeviceMesh. Why a custom cache instead of drei `useGLTF`: useGLTF suspends, and without a
 * Suspense boundary the entire Canvas would go blank. Render a procedural body until the model loads,
 * then replace it. An external subscription store (`subscribe`/`version`) updates affected components
 * and DeviceWarmup when loading finishes.
 */

type Entry = { state: 'loading' | 'ready' | 'failed'; scene: THREE.Group | null };

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;

function bump() {
  version++;
  for (const l of listeners) l();
}

export function subscribeModels(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function modelsVersion() {
  return version;
}

let loader: GLTFLoader | null = null;

export function loadDeviceModel(url: string): void {
  if (cache.has(url)) return;
  cache.set(url, { state: 'loading', scene: null });
  if (!loader) {
    // Models use meshopt compression (tools/devices3d/build-all.mjs);
    // GLTFLoader needs the decoder to load them.
    loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  loader.load(
    url,
    (gltf) => {
      cache.set(url, { state: 'ready', scene: gltf.scene });
      bump();
    },
    undefined,
    () => {
      // On failure, keep the procedural body and mark it ready so startup can proceed.
      cache.set(url, { state: 'failed', scene: null });
      bump();
    },
  );
}

export function getDeviceModel(url: string | undefined): THREE.Group | null {
  if (!url) return null;
  const e = cache.get(url);
  return e?.state === 'ready' ? e.scene : null;
}

/** Have these device models loaded or definitively failed? */
export function modelsSettled(deviceIds: string[]): boolean {
  for (const id of deviceIds) {
    const url = DEVICES.find((d) => d.id === id)?.model;
    if (!url) continue;
    loadDeviceModel(url);
    if (cache.get(url)?.state === 'loading') return false;
  }
  return true;
}

/**
 * Export gate: wait until project device models load or definitively fail. Startup warmup does not
 * cover the separate export path; slow networks could otherwise export initial frames with procedural
 * fallback bodies. Limit waiting to 15 seconds, then export with the fallback if the network is
 * unavailable.
 */
export function waitForModels(deviceIds: string[], timeoutMs = 15000): Promise<void> {
  if (modelsSettled(deviceIds)) return Promise.resolve();
  return new Promise((resolve) => {
    const t = window.setTimeout(done, timeoutMs);
    const off = subscribeModels(() => {
      if (modelsSettled(deviceIds)) done();
    });
    function done() {
      window.clearTimeout(t);
      off();
      // Allow two frames for React to mount loaded models in the scene.
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }
  });
}
