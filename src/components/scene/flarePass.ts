import * as THREE from 'three';
import { SRGB_GLSL } from './screenTone';

/**
 * Flare makes bright device edges glow like light hitting a camera lens.
 *
 * Input is the sRGB-encoded HalfFloat composer target, retaining encoded
 * highlights above 1.0 (screenTone.ts). Decode sources and base to linear
 * light, add the glow, then re-encode. The linear threshold is 1.0:
 * toneMapped:false screen content stays at or below 1.0 and never glows;
 * HDRI softbox reflections on metal edges exceed 1.0 and produce flare.
 * Long horizontal anamorphic streak, short vertical tail, and soft halo.
 */
export const FlareShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uStrength: { value: 0 },
    uThreshold: { value: 1.0 },
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
    uniform float uStrength;
    uniform float uThreshold;
    varying vec2 vUv;
    ${SRGB_GLSL}

    vec3 bright(vec2 uv) {
      vec3 c = mpToLinear(texture2D(tDiffuse, uv).rgb);
      return max(c - uThreshold, 0.0);
    }

    void main() {
      vec4 baseC = texture2D(tDiffuse, vUv);
      vec2 px = 1.0 / uResolution;
      // Scale length by frame height for the same appearance in 4K exports.
      float len = uResolution.y * 0.16;
      vec3 streak = vec3(0.0);
      vec3 halo = vec3(0.0);
      for (int i = 1; i <= 24; i++) {
        float t = float(i) / 24.0;
        float w = (1.0 - t) * (1.0 - t);
        vec2 dx = vec2(px.x * len * t, 0.0);
        streak += (bright(vUv + dx) + bright(vUv - dx)) * w;
        if (i <= 8) {
          vec2 dy = vec2(0.0, px.y * len * 0.25 * t);
          vec2 dd = vec2(px.x, px.y) * len * 0.12 * t;
          halo += (bright(vUv + dy) + bright(vUv - dy) + bright(vUv + dd) + bright(vUv - dd)) * w;
        }
      }
      // Slightly cool tint: lens coatings shift flare toward blue.
      vec3 tint = vec3(0.85, 0.92, 1.0);
      vec3 add = (streak * 0.11 + halo * 0.06) * tint * uStrength;
      vec3 rgb = mpToSRGB(mpToLinear(baseC.rgb) + add);
      /*
        Transparent background: fixed alpha 1.0 made PNG/WebM corners opaque
        black with flare enabled (measured). Glow supplies its own alpha over
        transparent areas; color must not exceed alpha in this premultiplied target.
      */
      float a = clamp(max(baseC.a, max(rgb.r, max(rgb.g, rgb.b))), 0.0, 1.0);
      gl_FragColor = vec4(rgb, a);
    }
  `,
};
