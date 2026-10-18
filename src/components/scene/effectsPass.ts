import * as THREE from 'three';

/**
 * Effect stack in one pass. Separate passes would each read/write a full-screen texture, six times
 * for six effects. Applying them sequentially in one shader costs nearly one pass. Order is
 * deliberate: sharpening → color → aberration → vignette → grain, placing optical effects before
 * film character.
 */
export const EffectsShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uSharpen: { value: 0 },
    uVignette: { value: 0 },
    uGrain: { value: 0 },
    uAberration: { value: 0 },
    uSaturation: { value: 0 },
    uTemperature: { value: 0 },
    uPixelGrid: { value: 0 },
    uTime: { value: 0 },
    uFishEye: { value: 0 },
    uExposure: { value: 0 },
    uBrightness: { value: 0 },
    uShadows: { value: 0 },
    uMidtones: { value: 0 },
    uHighlights: { value: 0 },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uSharpen;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAberration;
    uniform float uSaturation;
    uniform float uTemperature;
    uniform float uPixelGrid;
    uniform float uTime;
    uniform float uFishEye;
    uniform float uExposure;
    uniform float uBrightness;
    uniform float uShadows;
    uniform float uMidtones;
    uniform float uHighlights;
    varying vec2 vUv;

    void main() {
      vec2 texel = 1.0 / uResolution;
      /*
        Fish eye runs before all sampling: barrel-warp UVs to enlarge the center and curve edges.
        Aspect-correct radius keeps circles round in landscape frames. Out-of-frame corners clamp to
        edge pixels rather than black.
      */
      vec2 uv = vUv;
      if (uFishEye > 0.001) {
        vec2 c = vUv - 0.5;
        vec2 ca = c * vec2(uResolution.x / uResolution.y, 1.0);
        float r2 = dot(ca, ca);
        float k = uFishEye * 0.55;
        uv = 0.5 + c * (1.0 - k * 0.35) * (1.0 + k * r2);
        uv = clamp(uv, 0.0, 1.0);
      }
      vec2 centered = uv - 0.5;

      /*
        Chromatic aberration: shift channels outward from the center. Zero at center, strongest at
        edges, as in real lenses.
      */
      vec3 color;
      /*
        Preserve alpha. Output was previously fixed at 1.0, making transparent-export corners opaque
        black when vignette/grain/sharpen/fish eye was enabled (measured corner alpha 0 → 255). The
        target is premultiplied (blended over transparent black), so point operations below use
        unpremultiplied color before multiplying again.
      */
      vec4 src = texture2D(tDiffuse, uv);
      float alpha = src.a;
      if (uAberration > 0.001) {
        float amt = uAberration * 0.006;
        vec4 sr = texture2D(tDiffuse, uv + centered * amt);
        vec4 sb = texture2D(tDiffuse, uv - centered * amt);
        color.r = sr.r;
        color.g = src.g;
        color.b = sb.b;
        alpha = max(alpha, max(sr.a, sb.a));
      } else {
        color = src.rgb;
      }

      // Sharpen: classic unsharp mask, subtracting the neighboring average.
      if (uSharpen > 0.001) {
        vec3 blur =
          texture2D(tDiffuse, uv + vec2(texel.x, 0.0)).rgb +
          texture2D(tDiffuse, uv - vec2(texel.x, 0.0)).rgb +
          texture2D(tDiffuse, uv + vec2(0.0, texel.y)).rgb +
          texture2D(tDiffuse, uv - vec2(0.0, texel.y)).rgb;
        blur *= 0.25;
        color += (color - blur) * uSharpen * 3.0;
      }

      // Point operations use unpremultiplied color (opaque alpha 1 preserves previous behavior).
      float ia = alpha > 0.0001 ? 1.0 / alpha : 0.0;
      color *= ia;

      // Temperature: red-blue balance. Positive warms, negative cools.
      if (abs(uTemperature) > 0.001) {
        color.r += uTemperature * 0.12;
        color.b -= uTemperature * 0.12;
      }

      /*
        Post processing: exposure, brightness, and three tonal regions. Work in linear space before
        OutputPass: exposure multiplies (stops), brightness adds; shadows/midtones/highlights use
        luminance-weighted offsets confined to their own regions.
      */
      if (abs(uExposure) > 0.001) color *= exp2(uExposure * 1.5);
      if (abs(uBrightness) > 0.001) color += uBrightness * 0.15;
      if (abs(uShadows) + abs(uMidtones) + abs(uHighlights) > 0.001) {
        float l = clamp(dot(color, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
        float ws = 1.0 - smoothstep(0.0, 0.45, l);
        float wh = smoothstep(0.55, 1.0, l);
        float wm = 1.0 - abs(l - 0.5) * 2.0;
        /*
          Shadows and midtones use a power curve: linear addition lifted pure black, turning dark
          backgrounds gray in measurements. pow(0) = 0 keeps black unchanged while adjusting dark
          tones. Highlights multiply to dim or brighten values above white.
        */
        color = max(color, 0.0);
        color = mix(color, pow(color, vec3(1.0 - uShadows * 0.4)), ws);
        color = mix(color, pow(color, vec3(1.0 - uMidtones * 0.3)), wm);
        color *= 1.0 + uHighlights * wh * 0.45;
      }

      // Saturation: move away from/toward gray.
      if (abs(uSaturation) > 0.001) {
        float grey = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = mix(vec3(grey), color, 1.0 + uSaturation);
      }

      // Vignette: darken edges to draw attention to the center.
      if (uVignette > 0.001) {
        float d = length(centered * vec2(uResolution.x / uResolution.y, 1.0));
        float v = smoothstep(0.85, 0.25, d);
        color *= mix(1.0, v, uVignette);
      }

      /*
        Pixel grid: RGB subpixel texture. Real display pixels contain red/green/blue strips visible
        in close-ups, contributing to a realistic screen appearance. Draw strips at fixed spacing
        rather than screen resolution: locking them to source-image pixels causes moiré, while the
        visible texture matters most. Separate channel masks: column 0 boosts red, 1 green, 2 blue,
        suppressing neighboring channels.
      */
      if (uPixelGrid > 0.001) {
        float cell = 3.0;
        float col = mod(floor(vUv.x * uResolution.x), cell);
        vec3 mask = vec3(
          col < 0.5 ? 1.0 : 0.35,
          (col >= 0.5 && col < 1.5) ? 1.0 : 0.35,
          col >= 1.5 ? 1.0 : 0.35
        );
        // Horizontal scanline: vertical strips alone look like a comb;
        // subtle row separation brings the texture closer to a real panel.
        float row = mod(floor(vUv.y * uResolution.y), 3.0);
        float scan = row < 2.5 ? 1.0 : 0.75;
        color = mix(color, color * mask * scan * 1.6, uPixelGrid);
      }

      /*
        Grain: time-varying noise. Static noise looks like dirty glass in video; animating it
        resembles film grain.
      */
      if (uGrain > 0.001) {
        // One cell equals one preview pixel (floor), preserving size in export
        // and preventing SSAA downsampling from averaging it away.
        float n = fract(sin(dot(floor(vUv * uResolution) + uTime * 37.0, vec2(12.9898, 78.233))) * 43758.5453);
        color += (n - 0.5) * uGrain * 0.12;
      }

      // Premultiply again; color cannot exceed alpha in valid premultiplied output.
      gl_FragColor = vec4(clamp(color, 0.0, 1.0) * alpha, alpha);
    }
  `,
};

/** Panel effects, ordered to match the shader. */
export const EFFECT_DEFS = [
  { id: 'sharpen', label: 'Sharpen', min: 0, max: 1, def: 0.35 },
  { id: 'saturation', label: 'Saturation', min: -1, max: 1, def: 0.15 },
  { id: 'temperature', label: 'Temperature', min: -1, max: 1, def: 0.2 },
  { id: 'aberration', label: 'Aberration', min: 0, max: 1, def: 0.3 },
  { id: 'vignette', label: 'Vignette', min: 0, max: 1, def: 0.4 },
  { id: 'pixelGrid', label: 'Pixel grid', min: 0, max: 1, def: 0.5 },
  { id: 'grain', label: 'Grain', min: 0, max: 1, def: 0.3 },
  { id: 'fishEye', label: 'Fish eye', min: 0, max: 1, def: 0.35 },
  { id: 'exposure', label: 'Exposure', min: -1, max: 1, def: 0.15 },
  { id: 'brightness', label: 'Brightness', min: -1, max: 1, def: 0.1 },
  { id: 'shadows', label: 'Shadows', min: -1, max: 1, def: 0.2 },
  { id: 'midtones', label: 'Midtones', min: -1, max: 1, def: 0.1 },
  { id: 'highlights', label: 'Highlights', min: -1, max: 1, def: -0.15 },
  /* Separate passes (PostProcessing): bloom and light leaks. */
  { id: 'bloom', label: 'Bloom', min: 0, max: 1, def: 0.35 },
  { id: 'flare', label: 'Flare', min: 0, max: 1, def: 0.5 },
  /* In-scene (DeviceMesh): device effects. */
  { id: 'screenFade', label: 'Screen fade', min: 0, max: 1, def: 0.35 },
  { id: 'ghost', label: 'Ghost', min: 0, max: 1, def: 0.5 },
  { id: 'liquidGlass', label: 'Liquid glass', min: 0, max: 1, def: 0.6 },
] as const;

export type EffectId = (typeof EFFECT_DEFS)[number]['id'];
