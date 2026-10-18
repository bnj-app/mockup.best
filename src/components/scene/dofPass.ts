import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * DEPTH OF FIELD / FOCUS BLUR.
 *
 * Why: the previous blurPass.ts filled radii up to 47 px with just 16
 * samples in one pass, producing layered ghost edges. Depth-unaware
 * gathering let sharp device edges bleed into the blurred background and
 * the background bleed over the device. The pass ran only once after
 * jitter accumulation, so per-pixel rotation noise was never averaged out.
 *
 * Two passes:
 *  1. GATHER (half resolution): a golden-angle spiral with progressively
 *     denser steps (Gustafsson, "Bokeh depth of field in a single pass"). Each sample has its own circle of confusion (CoC) and
 *     contributes only if its circle covers this pixel. Background sample
 *     circles are limited by the center's circle, preventing sharp devices
 *     from bleeding backward and blurred backgrounds from covering sharp
 *     edges. Foreground (near-field) blurred contributions are stored in
 *     alpha as foreground coverage.
 *  2. COMPOSITE (full resolution): preserve the sharp image exactly when
 *     the pixel's CoC is small (screen content and text stay sharp).
 *     Use the half-resolution result for large CoC or when a blurred
 *     foreground object overlaps the pixel.
 *
 * Sample budget: choose the spiral step from the radius (n = approximately
 * R squared / 2s): ~192 samples for preview, ~1024 for offline export.
 *
 * Modes: 1 radial, 2 linear (tilt-shift): CoC from a screen-space mask;
 *        3 lens: CoC from actual scene depth (autofocus).
 */

const COMMON = /* glsl */ `
  #include <packing>
  uniform sampler2D tDepth;
  uniform float uNear;
  uniform float uFar;
  uniform vec2 uFocus;
  uniform float uFocusSize;
  uniform float uFalloff;
  uniform float uStrength;
  uniform float uMode;
  uniform float uAngle;
  uniform float uAspect;


  /*
    BITWISE INVALID-VALUE CHECK: on Windows (ANGLE to D3D), the compiler
    removes isnan()/isinf(), assuming values cannot be NaN (warning X3577).
    All exponent bits set means Inf or NaN; the compiler cannot assume this away.
  */
  bool badF(float x) {
    return (floatBitsToUint(x) & 0x7f800000u) == 0x7f800000u;
  }
  bool bad3(vec3 v) {
    return badF(v.x) || badF(v.y) || badF(v.z);
  }
  bool bad4(vec4 v) {
    return badF(v.x) || badF(v.y) || badF(v.z) || badF(v.w);
  }

  float viewZ(vec2 uv) {
    return -perspectiveDepthToViewZ(unpackRGBAToDepth(texture2D(tDepth, uv)), uNear, uFar);
  }

  // Signed CoC in FULL-resolution pixels: + far field, - near field.
  float cocAt(vec2 uv, float zf) {
    if (uMode > 2.5) {
      float z = viewZ(uv);
      // Relative scale: watches are 5 cm, monitors 70 cm; absolute centimeters would feel different per device.
      float rel = (z - zf) / max(0.001, zf);
      float band = uFocusSize * 0.05;
      float t = smoothstep(band, band + max(0.004, uFalloff * 0.12), abs(rel));
      return (rel < 0.0 ? -1.0 : 1.0) * t * uStrength;
    }
    vec2 d = (uv - uFocus) * vec2(uAspect, 1.0);
    float dist = 0.0;
    if (uMode > 1.5) {
      float a = radians(uAngle);
      vec2 n = vec2(-sin(a), cos(a));
      dist = abs(dot(d, n));
    } else {
      dist = length(d);
    }
    return smoothstep(uFocusSize, uFocusSize + max(0.001, uFalloff), dist) * uStrength;
  }
`;

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

function commonUniforms() {
  return {
    tDepth: { value: null as THREE.Texture | null },
    uNear: { value: 0.1 },
    uFar: { value: 1000 },
    uFocus: { value: new THREE.Vector2(0.5, 0.5) },
    uFocusSize: { value: 0.4 },
    uFalloff: { value: 0.6 },
    uStrength: { value: 0 },
    uMode: { value: 1 },
    uAngle: { value: 0 },
    uAspect: { value: 1 },
  };
}

const GatherShader = {
  uniforms: {
    ...commonUniforms(),
    tColor: { value: null as THREE.Texture | null },
    uTexel: { value: new THREE.Vector2(1, 1) },
    uRadScale: { value: 1 },
    uMaxIter: { value: 192 },
    uBokeh: { value: 1 },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
    ${COMMON}
    uniform sampler2D tColor;
    uniform vec2 uTexel;
    uniform float uRadScale;
    uniform float uMaxIter;
    uniform float uBokeh;
    varying vec2 vUv;
    const float GOLDEN = 2.39996323;
    // Prevent excessively bright HDR points (fireflies) from producing glaring bokeh disks.
    vec3 clean(vec3 c) {
      if (bad3(c)) return vec3(0.0);
      return min(c, vec3(8.0));
    }

    void main() {
      bool lens = uMode > 2.5;
      float zf = lens ? viewZ(uFocus) : 0.0;
      float zc = lens ? viewZ(vUv) : 0.0;
      float centerSize = abs(cocAt(vUv, zf));
      vec3 color = clean(texture2D(tColor, vUv).rgb);
      float tot = 1.0;
      float nearHit = 0.0;
      float count = 0.0;
      // Per-pixel starting angle turns residual patterns into fine, unstructured noise.
      float ang = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
      float radius = uRadScale;
      for (int i = 0; i < 2048; i++) {
        if (float(i) >= uMaxIter || radius >= uStrength) break;
        vec2 tc = vUv + vec2(cos(ang), sin(ang)) * uTexel * radius;
        /*
          Skip samples OUTSIDE the frame. With clamp-to-edge textures,
          every outside sample read the SAME edge pixel, turning a single
          bright metal pixel at the top edge into a large white disk.
        */
        if (tc.x < 0.0 || tc.x > 1.0 || tc.y < 0.0 || tc.y > 1.0) {
          ang += GOLDEN;
          radius += uRadScale / radius;
          continue;
        }
        vec3 raw = texture2D(tColor, tc).rgb;
        // Skip invalid samples (NaN/Inf): one degenerate pixel could turn the entire
        // disk black in a white studio scene.
        if (bad3(raw)) {
          ang += GOLDEN;
          radius += uRadScale / radius;
          continue;
        }
        vec3 sc = clean(raw);
        float sCoc = cocAt(tc, zf);
        float sSize = abs(sCoc);
        if (lens) {
          float sz = viewZ(tc);
          // Background samples cannot cover sharp edges: limit their circle by the center's.
          if (sz > zc) sSize = min(sSize, centerSize * 2.0);
        }
        float m = smoothstep(radius - 0.5 * uRadScale, radius + 0.5 * uRadScale, sSize);
        /*
          Foreground coverage requires a SEPARATE foreground object: a depth
          discontinuity is required. The near end of a tilted phone is the
          SAME surface; treating it as a foreground object replaced the sharp
          region with blur, leaving smear marks.
        */
        if (lens && sCoc < 0.0 && (zc - viewZ(tc)) > zc * 0.06) nearHit += m;
        // Bokeh: weight bright samples more, with a cap so one point cannot dominate the disk.
        float w = 1.0 + uBokeh * m * min(dot(sc, vec3(0.333)), 1.5) * 1.5;
        color += mix(color / tot, sc, m) * w;
        tot += w;
        count += 1.0;
        ang += GOLDEN;
        radius += uRadScale / radius;
      }
      // Foreground coverage: how much a near-field blurred object overlaps this pixel.
      float cover = count > 0.0 ? clamp(nearHit / count * 3.0, 0.0, 1.0) : 0.0;
      gl_FragColor = vec4(color / tot, cover);
    }
  `,
};

const CompositeShader = {
  uniforms: {
    ...commonUniforms(),
    tSharp: { value: null as THREE.Texture | null },
    tBlur: { value: null as THREE.Texture | null },
    uBlurTexel: { value: new THREE.Vector2(1, 1) },
    uDebug: { value: 0 },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
    ${COMMON}
    uniform sampler2D tSharp;
    uniform sampler2D tBlur;
    uniform vec2 uBlurTexel;
    uniform float uDebug;
    varying vec2 vUv;

    void main() {
      vec4 sharp = texture2D(tSharp, vUv);
      // Exclude invalid pixels (degenerate normal producing NaN) from the blend.
      bool badSharp = bad4(sharp);
      float zf = uMode > 2.5 ? viewZ(uFocus) : 0.0;
      float c = abs(cocAt(vUv, zf));
      // Upsample the half-resolution result with a tent filter to disperse residual noise.
      vec2 o = uBlurTexel * 0.75;
      vec4 b = texture2D(tBlur, vUv) * 0.4
        + texture2D(tBlur, vUv + vec2(o.x, o.y)) * 0.15
        + texture2D(tBlur, vUv + vec2(-o.x, o.y)) * 0.15
        + texture2D(tBlur, vUv + vec2(o.x, -o.y)) * 0.15
        + texture2D(tBlur, vUv + vec2(-o.x, -o.y)) * 0.15;
      /*
        WIDE transition (1-6 px): the half-resolution layer is about 2 px
        soft even at small CoC. A narrow ramp (0.75-2.5) left a blur-to-sharp
        STEP through text. A wider ramp increases blur gradually with depth,
        like a real lens.
      */
      float a = smoothstep(1.0, 6.0, c);
      a = max(a, b.a);
      bool badBlur = bad4(b);
      if (badBlur) a = 0.0;
      if (badSharp && !badBlur) a = 1.0;
      gl_FragColor = vec4(badSharp && badBlur ? vec3(0.0) : mix(sharp.rgb, b.rgb, a), badSharp ? 1.0 : sharp.a);
      // Debug (enabled only on localhost): 1 blur layer, 2 foreground coverage, 3 |CoC|, 4 composite alpha
      if (uDebug > 0.5) {
        vec3 d = uDebug < 1.5 ? b.rgb : uDebug < 2.5 ? vec3(b.a) : uDebug < 3.5 ? vec3(c / max(1.0, uStrength)) : vec3(a);
        gl_FragColor = vec4(d, 1.0);
      }
    }
  `,
};

export type DofParams = {
  mode: 'radial' | 'linear' | 'lens';
  /** Maximum CoC radius in render pixels. */
  strength: number;
  fx: number;
  /** UV (bottom = 0). */
  fy: number;
  focusSize: number;
  falloff: number;
  angle: number;
  bokeh: boolean;
  depth: THREE.Texture | null;
  near: number;
  far: number;
  /** Spiral sample budget (preview ~192, export ~1024). */
  budget: number;
};

let dofDebug = 0;
/** Local debugging: 0 off, 1 blur layer, 2 foreground coverage, 3 |CoC|, 4 composite alpha. */
export function setDofDebug(n: number) {
  dofDebug = n;
}

export class DofPass extends Pass {
  private gather = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(GatherShader.uniforms),
    vertexShader: GatherShader.vertexShader,
    fragmentShader: GatherShader.fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  private composite = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(CompositeShader.uniforms),
    vertexShader: CompositeShader.vertexShader,
    fragmentShader: CompositeShader.fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  private quad = new FullScreenQuad();
  private half = new THREE.WebGLRenderTarget(2, 2, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
  private params: DofParams | null = null;

  constructor() {
    super();
    this.needsSwap = true;
  }

  setParams(p: DofParams) {
    this.params = p;
  }

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ) {
    const p = this.params;
    const W = readBuffer.width;
    const H = readBuffer.height;
    const hw = Math.max(1, Math.ceil(W / 2));
    const hh = Math.max(1, Math.ceil(H / 2));
    if (this.half.width !== hw || this.half.height !== hh) this.half.setSize(hw, hh);

    const mode = !p ? 0 : p.mode === 'radial' ? 1 : p.mode === 'lens' ? 3 : 2;
    const strength = p ? Math.max(0, p.strength) : 0;
    for (const m of [this.gather, this.composite]) {
      const u = m.uniforms;
      u.tDepth.value = p?.depth ?? null;
      u.uNear.value = p?.near ?? 0.1;
      u.uFar.value = p?.far ?? 1000;
      (u.uFocus.value as THREE.Vector2).set(p?.fx ?? 0.5, p?.fy ?? 0.5);
      u.uFocusSize.value = p?.focusSize ?? 0.4;
      u.uFalloff.value = Math.max(0.01, p?.falloff ?? 0.6);
      u.uStrength.value = strength;
      u.uMode.value = mode === 3 && !p?.depth ? 1 : mode;
      u.uAngle.value = p?.angle ?? 0;
      u.uAspect.value = W / Math.max(1, H);
    }

    // 1) Gather at half resolution, reading the full-resolution source.
    const g = this.gather.uniforms;
    g.tColor.value = readBuffer.texture;
    (g.uTexel.value as THREE.Vector2).set(1 / W, 1 / H);
    const budget = Math.max(16, p?.budget ?? 192);
    // n = approximately R squared / 2s, so s = R squared / 2n (minimum 0.5: denser sampling has no visible benefit)
    g.uRadScale.value = Math.max(0.5, (strength * strength) / (2 * budget));
    g.uMaxIter.value = budget * 1.15;
    g.uBokeh.value = p?.bokeh ? 1 : 0;
    this.quad.material = this.gather;
    renderer.setRenderTarget(this.half);
    renderer.clear();
    this.quad.render(renderer);

    // 2) Composite at full resolution.
    const c = this.composite.uniforms;
    c.tSharp.value = readBuffer.texture;
    c.tBlur.value = this.half.texture;
    c.uDebug.value = dofDebug;
    (c.uBlurTexel.value as THREE.Vector2).set(1 / hw, 1 / hh);
    this.quad.material = this.composite;
    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
    }
    this.quad.render(renderer);
  }

  setSize() {}

  dispose() {
    this.gather.dispose();
    this.composite.dispose();
    this.quad.dispose();
    this.half.dispose();
  }
}
