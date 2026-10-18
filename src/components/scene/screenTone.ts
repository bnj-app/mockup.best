import * as THREE from 'three';

/**
 * Final pass: the composer's output frame.
 *
 * No tone mapping is applied. The canvas is `flat` (R3F → NoToneMapping),
 * so direct rendering leaves every pixel unmapped. The old pipeline assumed
 * R3F used ACES by default, applied ACES to the whole HDR frame when bloom
 * or flare was enabled, and compensated with inverse ACES in screen materials.
 * Measurements with a phone and photo studio showed:
 * - Even an invisible 0.0015 bloom/flare dose shifted levels by 16 on average
 *   and 83 at most, darkening/saturating backgrounds and changing body colors.
 * - Inverse ACES pushed screen whites well above 1.0, turning screenshot
 *   buttons into bloom halos or anamorphic flare streaks. Screen content
 *   must never glow.
 * - Cover glass blended in a linear target made the screen hazy and gray.
 *
 * Both paths now render sRGB-encoded values into composer targets marked
 * isXRRenderTarget, matching the direct canvas's blending space. HalfFloat
 * retains encoded highlights above 1.0 because sRGB OETF does not clamp;
 * bloom/flare use only those highlights. This pass simply clamps and copies,
 * matching the direct 8-bit canvas.
 */
export const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
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
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // Preserve alpha so transparent exports keep transparent corners.
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), clamp(c.a, 0.0, 1.0));
    }
  `,
};

/**
 * sRGB-encoded values ⇄ linear light, including values above 1.0 without clamping.
 * Light-accumulating passes such as flare must add in linear space;
 * adding encoded values makes glows in dark areas too dim.
 */
export const SRGB_GLSL = /* glsl */ `
  vec3 mpToLinear(vec3 c) {
    c = max(c, 0.0);
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }
  vec3 mpToSRGB(vec3 c) {
    c = max(c, 0.0);
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
`;
