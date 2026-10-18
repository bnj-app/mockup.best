import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader.js';

/**
 * Jitter accumulation reduces edge shimmer. Subpixel highlights on body bevels and front-glass/bezel
 * edges shift by half a pixel as the camera moves, so a fixed sample grid alternately catches and
 * misses them. Measurements: increasing resolution (1.6× → 2× → 3×) reduces shimmer only 5–15%;
 * specular AA (geometryRoughness ×5) has no effect because line width is the issue. Averaging
 * subpixel-shifted renders removes ~85–90% of excess shimmer at 8 samples and all of it at 16,
 * matching a 36-sample reference. Use D3D MSAA patterns, as in three SSAARenderPass: at 8 and 16
 * samples, each sample has its own row and column. A regular grid gives vertical edges only √N levels;
 * measured side-edge shimmer on a 4×4 grid was 1.6 times Halton-16. Average encoded sRGB values
 * deliberately, matching the canvas's own MSAA resolve to preserve appearance.
 */

/** In 1/16-pixel units, [-8, 8]; three SSAARenderPass _JitterVectors. */
const PATTERNS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[4, 4], [-4, -4]],
  4: [[-2, -6], [6, -2], [-6, 2], [2, 6]],
  8: [[1, -3], [-1, 3], [5, 1], [-3, -5], [-5, 5], [-7, -1], [3, 7], [7, -7]],
  16: [
    [1, 1], [-1, -3], [-3, 2], [4, -1], [-5, -2], [2, 5], [5, 3], [3, -5],
    [-2, 6], [0, -7], [-4, -6], [-6, 4], [-8, 0], [7, -4], [6, 7], [-7, -8],
  ],
};

export type JitterLevel = 1 | 2 | 4 | 8 | 16;

/** Round the requested sample count to the nearest supported level. */
export function jitterLevel(n: number): JitterLevel {
  const levels: JitterLevel[] = [1, 2, 4, 8, 16];
  let best: JitterLevel = 1;
  for (const l of levels) if (Math.abs(Math.log2(Math.max(1, n)) - Math.log2(l)) < Math.abs(Math.log2(Math.max(1, n)) - Math.log2(best))) best = l;
  return best;
}

type XRTarget = THREE.WebGLRenderTarget & { isXRRenderTarget?: boolean };

/* Override sample-target MSAA for measurement (debug.setJitterMsaa); null uses the caller's value. */
let msaaOverride: number | null = null;
export function setJitterMsaa(n: number | null) {
  msaaOverride = n;
}

function copyMaterial(additive: boolean) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms),
    vertexShader: CopyShader.vertexShader,
    fragmentShader: CopyShader.fragmentShader,
    transparent: additive,
    depthTest: false,
    depthWrite: false,
    // ONE + ONE: weighted addition; color is already premultiplied, including transparent backgrounds.
    premultipliedAlpha: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NoBlending,
  });
}

/**
 * Render the scene n times with subpixel offsets and average into target, clearing it first. msaa
 * controls sample-target multisampling. Preview uses 4: with 8 jitter samples, top/side measurements
 * were 2.79/1.74 without MSAA and 2.15/1.16 with 4× MSAA (ideal ≈ 2.2/1.1). Export uses 0 because SSAA
 * already provides 2× rendering × 8 jitter at 1080p, or 32 samples per pixel. MSAA quadrupled 4K
 * memory (HalfFloat 4.6K ≈ 95 → 380 MB).
 */
export class JitterAccumulator {
  private sampleRT: XRTarget | null = null;
  private add = copyMaterial(true);
  private quad = new FullScreenQuad(this.add);
  private oldColor = new THREE.Color();

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, target: THREE.WebGLRenderTarget, n: JitterLevel, msaa: number) {
    const pattern = PATTERNS[n];
    const w = target.width;
    const h = target.height;
    const samples = msaaOverride ?? msaa;
    if (this.sampleRT && this.sampleRT.samples !== samples) {
      this.sampleRT.dispose();
      this.sampleRT = null;
    }
    if (!this.sampleRT) {
      this.sampleRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples });
      this.sampleRT.texture.name = 'Jitter.sample';
    } else if (this.sampleRT.width !== w || this.sampleRT.height !== h) {
      this.sampleRT.setSize(w, h);
    }
    const rt = this.sampleRT;
    // Match the target's color contract (PostProcessing uses an sRGB-encoded "XR" target).
    rt.texture.colorSpace = target.texture.colorSpace;
    rt.isXRRenderTarget = (target as XRTarget).isXRRenderTarget;

    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.getClearColor(this.oldColor);
    const oldAlpha = renderer.getClearAlpha();
    const cam = camera as THREE.PerspectiveCamera;
    const u = this.add.uniforms;
    u.tDiffuse.value = rt.texture;
    u.opacity.value = 1 / n;

    for (let i = 0; i < n; i += 1) {
      const [jx, jy] = pattern[i];
      cam.setViewOffset(w, h, jx / 16, jy / 16, w, h);
      renderer.setRenderTarget(rt);
      renderer.setClearColor(this.oldColor, oldAlpha);
      renderer.clear();
      renderer.render(scene, cam);

      renderer.setRenderTarget(target);
      if (i === 0) {
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
      }
      this.quad.render(renderer);
    }
    cam.clearViewOffset();

    renderer.setClearColor(this.oldColor, oldAlpha);
    renderer.autoClear = autoClear;
  }

  dispose() {
    this.sampleRT?.dispose();
    this.sampleRT = null;
    this.add.dispose();
    this.quad.dispose();
  }
}

/** Replace RenderPass in the composer; N=1 behaves exactly like RenderPass. */
export class JitterRenderPass extends Pass {
  samples: JitterLevel = 1;
  msaa = 4;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private acc = new JitterAccumulator();

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    // Like RenderPass, write to the read buffer without requesting a swap.
    this.needsSwap = false;
  }

  render(renderer: THREE.WebGLRenderer, _writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    if (this.samples === 1) {
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
      renderer.clear();
      renderer.render(this.scene, this.camera);
      renderer.autoClear = autoClear;
      return;
    }
    this.acc.render(renderer, this.scene, this.camera, readBuffer, this.samples, this.msaa);
  }

  dispose() {
    this.acc.dispose();
  }
}

/**
 * Effect-free path: accumulate and copy directly to the canvas without creating the composer and its
 * two MSAA HalfFloat targets. The copy performs no tone/color conversion because the target is already
 * sRGB-encoded, matching the composer's final pass (FinalShader).
 */
export class JitterDirect {
  private target: XRTarget | null = null;
  private acc = new JitterAccumulator();
  private copy = copyMaterial(false);
  private quad = new FullScreenQuad(this.copy);

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, n: JitterLevel, msaa: number) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, size.x);
    const h = Math.max(1, size.y);
    if (!this.target) {
      this.target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
      this.target.texture.name = 'Jitter.direct';
      this.target.texture.colorSpace = THREE.SRGBColorSpace;
    } else if (this.target.width !== w || this.target.height !== h) {
      this.target.setSize(w, h);
    }
    this.target.isXRRenderTarget = true;
    /*
      ⚠️ Read the previous target before accumulation. Reading it afterward saved the accumulation target
      left bound, then restored it after copying. Subsequent text-layer rendering (gl.render(overlayScene)
      in PostProcessing) went to that intermediate target instead of the canvas. Titles, subtitles, logos,
      and transitions disappeared in both preview and export for effect-free scenes. Guard test: verify
      that the text layer is visible.
    */
    const prev = renderer.getRenderTarget();
    this.acc.render(renderer, scene, camera, this.target, n, msaa);
    renderer.setRenderTarget(null);
    this.copy.uniforms.tDiffuse.value = this.target.texture;
    this.copy.uniforms.opacity.value = 1;
    this.quad.render(renderer);
    renderer.setRenderTarget(prev);
  }

  dispose() {
    this.target?.dispose();
    this.target = null;
    this.acc.dispose();
    this.copy.dispose();
    this.quad.dispose();
  }
}
