'use client';

import * as THREE from 'three';
import { useEditor } from '@/store/editor';

/*
  Global texture cache prevents stutters at scene transitions. Previously, each scene change recreated
  useMediaTexture, decoded images, and uploaded them again, dropping frames on every transition,
  including every demo loop. Create textures once per URL and do not dispose on unmount; memory cost
  is small for a few images. Moved from Stage.tsx to fix white screens on first appearance:
  startup-only warmup missed later uploads and images from templates, project files, or shared links.
  Those began loading only when first visible, leaving 1+ white frames that export also captured (two
  initial frames in a second scene). Use one loadImageTexture loader for hooks, warmup, and export to
  avoid duplicate downloads/textures. startProjectImageWarmer loads every newly added image in the
  background; ensureProjectImages waits for all project images before export.
*/
export type CachedTexture = { tex: THREE.Texture; aspect: number };

export const textureCache = new Map<string, CachedTexture>();
const inflight = new Map<string, Promise<CachedTexture | null>>();

/* Upload warmed textures to the GPU immediately with gl.initTexture; connected when the scene mounts. */
let warmRenderer: THREE.WebGLRenderer | null = null;
export function setWarmRenderer(gl: THREE.WebGLRenderer | null) {
  warmRenderer = gl;
}

/** Build a screen texture from an Image; hooks and warmup must use identical settings. */
function makeImageTexture(img: HTMLImageElement): THREE.Texture {
  const t = new THREE.Texture(img);
  t.colorSpace = THREE.SRGBColorSpace;
  /*
    Mipmaps and anisotropy are essential. A 1500 px screenshot may occupy only 200 px in the frame;
    without mipmaps, each pixel samples the source once and fine text turns into moiré.
  */
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 16;
  // Crop from the center; corner-based cropping shifts the image.
  t.center.set(0.5, 0.5);
  t.needsUpdate = true;
  return t;
}

/** Cache a decoded image; keep existing entries to avoid duplicate textures. */
export function cacheDecodedImage(url: string, img: HTMLImageElement): CachedTexture {
  const have = textureCache.get(url);
  if (have) return have;
  const entry = { tex: makeImageTexture(img), aspect: img.naturalWidth / img.naturalHeight };
  textureCache.set(url, entry);
  if (warmRenderer) {
    try {
      warmRenderer.initTexture(entry.tex);
    } catch {
      /* Context loss or similar; upload on first draw. */
    }
  }
  return entry;
}

/**
 * Single loader: concurrent calls for a URL share one promise. Use plain Image instead of
 * TextureLoader because TextureLoader adds crossOrigin, which silently fails on blob: URLs, leaving
 * empty textures and black screens. All user uploads use blob: URLs, so this path is required. Return
 * null on failure to avoid blocking the chain.
 */
export function loadImageTexture(url: string): Promise<CachedTexture | null> {
  const have = textureCache.get(url);
  if (have) return Promise.resolve(have);
  const busy = inflight.get(url);
  if (busy) return busy;
  const p = new Promise<CachedTexture | null>((resolve) => {
    const img = new Image();
    img.onload = () => {
      // decode() moves decoding off the main thread before GPU upload.
      const finish = () => resolve(cacheDecodedImage(url, img));
      if (typeof img.decode === 'function') img.decode().then(finish, finish);
      else finish();
    };
    img.onerror = () => {
      console.error('[MOCKUPTOP] image failed to load', url);
      resolve(null);
    };
    img.src = url;
  }).finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

/**
 * Have these media URLs loaded? Capture previously did not wait for textures: taking a frame
 * immediately after applying a project produced blank device screens, even when video later showed the
 * content. Users can trigger the same issue by opening a project and immediately exporting.
 */
export function mediaLoaded(urls: (string | null | undefined)[]) {
  return urls.every((u) => !u || textureCache.has(u));
}

/** All project image media, including main and extra devices. Videos use a separate path. */
export function projectImageUrls(): string[] {
  const urls = new Set<string>();
  for (const sh of useEditor.getState().shots) {
    if (sh.media && sh.mediaKind === 'image') urls.add(sh.media);
    for (const e of sh.extras) if (e.media && e.mediaKind === 'image') urls.add(e.media);
  }
  return [...urls];
}

/** Export gate: wait until every project image is cached. */
export async function ensureProjectImages(): Promise<void> {
  await Promise.all(projectImageUrls().map((u) => loadImageTexture(u)));
}

/*
  Load newly introduced images in the background after uploads, templates, project files, shared
  links, or undo. Startup warmup covers the initial project; this covers later additions. Each
  completed load emits warmTick so DeviceWarmup recompiles with the new texture.
*/
let warmerOn = false;
export function startProjectImageWarmer(): () => void {
  if (warmerOn) return () => {};
  warmerOn = true;
  let lastShots: unknown = null;
  const scan = () => {
    const shots = useEditor.getState().shots;
    if (shots === lastShots) return;
    lastShots = shots;
    for (const url of projectImageUrls()) {
      if (textureCache.has(url) || inflight.has(url)) continue;
      void loadImageTexture(url).then((e) => {
        if (e) useEditor.getState().bumpWarmTick();
      });
    }
  };
  scan();
  const unsub = useEditor.subscribe(scan);
  return () => {
    unsub();
    warmerOn = false;
  };
}
