'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { evaluateShot, useEditor, shotAtTime } from '@/store/editor';
import { DofPass } from './dofPass';
import { EffectsShader } from './effectsPass';
import { FlareShader } from './flarePass';
import { FinalShader } from './screenTone';
import { getRecordSize, isRealtimeRecording, motionBlurAmount, registerPipeline } from './exportBridge';
import { JitterDirect, JitterRenderPass, jitterLevel, type JitterLevel } from './jitterPass';

/*
  JITTER SAMPLE COUNT (see jitterPass.ts for edge-flicker measurements).

  Preview: Stage uses display pixel ratio (8 at 1x, 2 at 2x; target about
  8 samples per CSS pixel) and halves the count if frame rate drops.
  Video/image export: offline, fixed 8 on top of SSAA
  (1080p at 2x rendering x 8 = 32 samples per pixel).
*/
let previewJitter: JitterLevel = 8;
export function setPreviewJitter(n: number) {
  previewJitter = jitterLevel(n);
}
export function getPreviewJitter(): JitterLevel {
  return previewJitter;
}
const EXPORT_JITTER: JitterLevel = 8;

/*
  Bloom gain. With tone mapping removed (screenTone.ts), glow is added in
  encoded space. Threshold/gain were selected from four scenes (silver/white/
  crystal phone, silver laptop at 0.35 and 1.0); see threshold notes below.
*/
const BLOOM_GAIN = 1.0;
const BLOOM_THRESHOLD = 0.97;

/**
 * Final image pipeline.

 * 1. Render the scene through the blur pass to the screen.
 * 2. Render text AFTER blur in a separate scene.

 * Text in the main scene would also blur. Captions and titles must stay sharp;
 * the blur belongs to the product shot.

 * useFrame priority 1 takes over R3F's render call.
 */
export function PostProcessing({ overlayScene }: { overlayScene: THREE.Scene }) {
  const { gl, scene, camera, size } = useThree();

  const { composer, passes } = useMemo(() => {
    /*
      A MULTISAMPLED target is required.

      Canvas antialias: true has no effect once EffectComposer renders into its
      own target, which has no sampling by default. This causes stair-stepped
      device silhouettes and obscures fine glass edges.

      HalfFloat keeps bright reflections from clipping at 1.0 in the effect chain.
    */
    const size = gl.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(
      Math.max(1, size.x),
      Math.max(1, size.y),
{ type: THREE.HalfFloatType, samples: 4 },
    );
    /*
      sRGB-ENCODED TARGET on every path: with isXRRenderTarget, three takes the
      output space from the texture, so materials encode and blend in sRGB as
      on the canvas. Measured linear blending made translucent cover glass
      wash dark screens gray, unlike the canvas's sRGB blending.
      HalfFloat's sRGB space changes encoding, not internal format; encoded
      highlights above 1.0 remain available to bloom/flare.
      ⚠️ renderFrame also sets the flag every frame so a rebuilt composer target
      cannot silently revert to linear space.
    */
    target.texture.colorSpace = THREE.SRGBColorSpace;
    const c = new EffectComposer(gl, target);
    c.renderTarget2.texture.colorSpace = THREE.SRGBColorSpace;
    // Replaces RenderPass: identical at N=1, jitter accumulation at N>1.
    const jitterP = new JitterRenderPass(scene, camera);
    c.addPass(jitterP);
    /*
      Access passes by reference (passes below), not index: adding bloom/flare
      shifted the old passes[1..3] indices.
      Order: blur -> flare -> bloom -> effect stack. Values above 1.0 remain
      available to flare/bloom before final clipping; the stack clips its own output.
    */
    // Depth-aware two-pass focus blur (dofPass.ts replaces the old 16-sample blurPass).
    const blurP = new DofPass();
    c.addPass(blurP);
    const flareP = new ShaderPass(FlareShader);
    c.addPass(flareP);
    const bloomP = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.55, 0.85);
    c.addPass(bloomP);
    const fxP = new ShaderPass(EffectsShader);
    c.addPass(fxP);
    /*
      MOTION BLUR: optional, video export only. AfterimagePass fades and overlays
      the previous frame to leave trails during camera motion. It is not true
      per-pixel motion blur, but looks natural in recordings and is nearly free.
      Before OutputPass so blending happens in linear space.
    */
    const after = new AfterimagePass(0.85);
    after.enabled = false;
    c.addPass(after);

    /*
      OutputPass is required. three applies tone mapping and sRGB conversion only
      when rendering to screen; intermediate targets stay linear. A custom ShaderPass
      copied them unchanged, making every composer frame darker than direct rendering
      (measured maximum channel difference: 50).
    */
    // No OutputPass: the target is already sRGB-encoded; the final pass only clips.
    // See screenTone.ts FinalShader for why tone mapping is omitted.
    const finalP = new ShaderPass(FinalShader);
    c.addPass(finalP);
    /*
      LENS BLUR depth prepass: half resolution, RGBA-packed depth.
      Use a separate small target rather than a depthTexture on the composer's
      MSAA target: multisample depth resolution is fragile across cloned targets.
    */
    // FULL resolution and NEAREST filtering: bilinear packed-depth interpolation
    // produces invalid edge values; the composite pass reads sharp edges here.
    const depthRT = new THREE.WebGLRenderTarget(2, 2, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    return {
      composer: c,
      passes: { jitter: jitterP, direct: new JitterDirect(), blur: blurP, flare: flareP, bloom: bloomP, fx: fxP, after, depthRT, depthMat, final: finalP },
    };
  }, [gl, scene, camera]);

  /** Screen-aligned camera for the text layer. */
  const overlayCamera = useMemo(
    () => new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1),
    [],
  );

  useEffect(
    () => () => {
      // composer.dispose() releases only its two targets, not its passes.
      // Dispose each pass to avoid accumulating programs when switching editor <-> /photo.
      composer.dispose();
      passes.jitter.dispose();
      passes.direct.dispose();
      passes.blur.dispose();
      passes.flare.dispose();
      passes.bloom.dispose();
      passes.fx.dispose();
      passes.after.dispose();
      passes.final.dispose();
      passes.depthRT.dispose();
      passes.depthMat.dispose();
    },
    [composer, passes],
  );

  /*
    Resize the composer lazily, only when the effects path renders and size/dpr
    has changed:
    - Without effects it is unused; reallocating MSAA HalfFloat targets on resize is wasteful.
    - At 4K, avoid allocating half a GB of buffers with effects off, which could
      cause context loss on midrange GPUs.
  */
  const composerSize = useRef<{ w: number; h: number; pr: number } | null>(null);

  /*
    One render function serves live preview (useFrame) and export (exportBridge).
    A separate export path previously omitted blur, effects and text.

    enabled flags avoid two unnecessary fullscreen shader passes when blur and
    effects are off. EffectComposer skips disabled passes, and the last active
    pass renders directly to screen, reducing initial cost to plain scene rendering.
  */
  const renderFrame = useMemo(
    () =>
      (width: number, height: number, blurScale = 1) => {
        const state = useEditor.getState();
        /*
          Read the evaluated scene so blur/effect tracks use playhead values.
          This runs imperatively per frame without React subscriptions;
          animated blur triggers no React renders.
        */
        const at = shotAtTime(state.shots, state.playhead);
        // Template preview (see Stage): read blur/effects from the previewed scene too.
        const src = state.previewShot && state.previewShot.id === at.shot.id ? state.previewShot : at.shot;
        const shot = evaluateShot(src, at.localTime);
        const blur = shot.blur;

        const P = passes;
        const pass = P.blur;
        const blurOn = blur.mode !== 'off' && blur.strength > 0.01;
        pass.enabled = blurOn;
        const amount = (id: string) => {
          const e = shot.effects.find((x) => x.id === id);
          return e && e.on ? e.value : 0;
        };
        /*
          Enable the effect stack only for SHADER effects. Bloom/flare have separate
          passes; screen fade/ghost/liquid glass render inside DeviceMesh.
          Those effects alone must not trigger a fullscreen pass.
        */
        const SCENE_FX = ['bloom', 'flare', 'screenFade', 'ghost', 'liquidGlass'];
        const fx = P.fx;
        const fxOn = shot.effects.some(
          (e) => e.on && Math.abs(e.value) > 0.001 && !SCENE_FX.includes(e.id),
        );
        fx.enabled = fxOn;
        const flareAmt = amount('flare');
        const bloomAmt = amount('bloom');
        P.flare.enabled = flareAmt > 0.001;
        P.bloom.enabled = bloomAmt > 0.001;
        const after = P.after;
        const mbAmount = motionBlurAmount();
        const mbOn = mbAmount > 0;
        after.enabled = mbOn;
        // Damping is the fraction carried into the next frame.
        if (mbOn) after.uniforms.damp.value = mbAmount;

        /*
          With no effects, bypass the composer completely and render directly to
          screen using canvas MSAA and three's screen-path tone mapping/sRGB.
          This removes two fullscreen passes and HalfFloat target costs at startup,
          previously a major performance cost. OutputPass keeps both paths' colors equal.
        */
        /*
          Jitter samples per frame: fixed for export, set by Stage for preview.
          "Optimized playback" uses one sample while playing to favor smoothness
          in heavy projects.
        */
        const rec = getRecordSize();
        const recording = rec !== null;
        const offline = recording && !isRealtimeRecording();
        const optimized = state.optimizedPlayback && state.playing && !state.exporting;
        const n: JitterLevel = offline ? EXPORT_JITTER : optimized ? 1 : previewJitter;
        P.jitter.samples = n;
        /*
          Sample-target MSAA (see JitterAccumulator): 4 in preview. Export also uses 4
          at <=4 MP, since Medium/Low 1080p has no SSAA and should match preview quality.
          Above that, use 0: SSAA is present and MSAA quadruples HalfFloat memory
          (High 1080p renders at 3840x2160 -> 265 MB). Measured for 20 s of 1080p30
          on RTX 5070 Ti: Medium 10.8 -> ~16 s with MSAA, High 9.2 -> 25 s.
        */
        const msaa = !rec || rec.w * rec.h <= 4_200_000 ? 4 : 0;
        P.jitter.msaa = msaa;

        if (!blurOn && !fxOn && !mbOn && !P.flare.enabled && !P.bloom.enabled) {
          // Skip composer allocation for jitter too (two 4K MSAA HalfFloat targets are about 1 GB).
          if (n > 1) P.direct.render(gl, scene, camera, n, msaa);
          else gl.render(scene, camera);
          const prevAuto = gl.autoClear;
          gl.autoClear = false;
          gl.render(overlayScene, overlayCamera);
          gl.autoClear = prevAuto;
          return;
        }

        const pr = gl.getPixelRatio();
        const cs = composerSize.current;
        if (!cs || cs.w !== width || cs.h !== height || cs.pr !== pr) {
          composer.setPixelRatio(pr);
          composer.setSize(width, height);
          composerSize.current = { w: width, h: height, pr };
        }

        if (blurOn) {
          // Panel range 0-100, radius in render pixels. Scale by export resolution ratio;
          // a fixed pixel radius would look weak at 4K.
          const strengthPx = blur.strength * 0.9 * blurScale;
          let depthTex: THREE.Texture | null = null;
          const pc = camera as THREE.PerspectiveCamera;
          if (blur.mode === 'lens') {
            const dw = Math.max(1, Math.round(width * pr));
            const dh = Math.max(1, Math.round(height * pr));
            if (P.depthRT.width !== dw || P.depthRT.height !== dh) P.depthRT.setSize(dw, dh);
            const prevOverride = scene.overrideMaterial;
            const prevBg = scene.background;
            const prevTarget = gl.getRenderTarget();
            const prevColor = gl.getClearColor(new THREE.Color());
            const prevAlpha = gl.getClearAlpha();
            scene.overrideMaterial = P.depthMat;
            scene.background = null;
            gl.setRenderTarget(P.depthRT);
            // White = depth 1 (infinity), keeping the backdrop out of focus.
            gl.setClearColor(0xffffff, 1);
            gl.clear();
            gl.render(scene, camera);
            gl.setRenderTarget(prevTarget);
            gl.setClearColor(prevColor, prevAlpha);
            scene.overrideMaterial = prevOverride;
            scene.background = prevBg;
            depthTex = P.depthRT.texture;
          }
          pass.setParams({
            mode: blur.mode === 'radial' ? 'radial' : blur.mode === 'lens' ? 'lens' : 'linear',
            strength: strengthPx,
            fx: blur.fx,
            fy: 1 - blur.fy,
            focusSize: blur.focusSize,
            falloff: blur.falloff,
            angle: blur.angle,
            bokeh: blur.bokeh,
            depth: depthTex,
            near: pc.near,
            far: pc.far,
            // Use many samples for offline export; keep preview responsive.
            budget: offline ? 1024 : optimized ? 96 : 192,
          });
        }

        if (P.flare.enabled) {
          const u = P.flare.uniforms;
          u.uResolution.value.set(width * pr, height * pr);
          /*
            2.4 (formerly 1.6): flare now comes only from real HDR highlights.
            Previously, most streaks came from inverse-ACES screen whites. At 2.4,
            full-frame mean: 0.5 -> ~0.28, max -> ~0.38 (silver phone, Photo studio).
            Old values are not comparable: they summed screen-generated streaks.
            ⚠️ Procedural environments use 8-bit canvases with no highlights above 1.0,
            so flare is invisible there; use HDRI Photo studio/Loft.
          */
          u.uStrength.value = flareAmt * 2.4;
        }
        if (P.bloom.enabled) {
          /*
            Encoded-space threshold 0.97 with a narrow 0.03 transition. After removing
            tone mapping (screenTone.ts), measurements established new settings:
            - 1.0 (true HDR only): 8-bit procedural studios have nothing above 1.0,
              so the slider has no effect (measured 0.00).
            - 0.90: silver laptop bases and white bodies disappear into white halos.
            - 0.97: brightest screen whites and metal highlights glow softly, while
              bodies/bases do not. Inverse ACES previously pushed white screen buttons
              far above 1.0 into huge blobs; they now peak at 1.0, keeping halos restrained.
          */
          P.bloom.strength = bloomAmt * BLOOM_GAIN;
          P.bloom.radius = 0.3 + bloomAmt * 0.3;
          P.bloom.threshold = BLOOM_THRESHOLD;
          (P.bloom as unknown as { highPassUniforms: { smoothWidth: { value: number } } }).highPassUniforms.smoothWidth.value = 0.03;
        }

        // Effect stack: absent or hidden effects contribute zero.
        if (fxOn) {
          const fu = fx.uniforms;
          /*
            "Pixel" means PREVIEW pixels. Pixel-grid cells, sharpening neighbor steps
            and grain cells depend on uResolution. Export used render dimensions
            (with SSAA, about 4x preview), reducing cells to ~1.5 output pixels.
            Downsampling averaged RGB stripes into gray haze and nearly erased grain
            and sharpening. blurScale = render/preview ratio: 1 in preview preserves
            its appearance, while export scales proportionally.
          */
          fu.uResolution.value.set(width / blurScale, height / blurScale);
          fu.uTime.value = state.playhead;
          fu.uSharpen.value = amount('sharpen');
          fu.uSaturation.value = amount('saturation');
          fu.uTemperature.value = amount('temperature');
          fu.uAberration.value = amount('aberration');
          fu.uVignette.value = amount('vignette');
          fu.uGrain.value = amount('grain');
          fu.uPixelGrid.value = amount('pixelGrid');
          fu.uFishEye.value = amount('fishEye');
          fu.uExposure.value = amount('exposure');
          fu.uBrightness.value = amount('brightness');
          fu.uShadows.value = amount('shadows');
          fu.uMidtones.value = amount('midtones');
          fu.uHighlights.value = amount('highlights');
        }

        /*
          Composer targets are sRGB-encoded on every path (see screenTone.ts).
          Bloom/flare now add glow without recoloring the frame. Previously the hdr
          branch switched targets to linear space and applied ACES in the final pass.
        */
        (composer.renderTarget1 as THREE.WebGLRenderTarget & { isXRRenderTarget?: boolean }).isXRRenderTarget = true;
        (composer.renderTarget2 as THREE.WebGLRenderTarget & { isXRRenderTarget?: boolean }).isXRRenderTarget = true;
        composer.render();

        // Render text after blur to keep it sharp.
        const prevAutoClear = gl.autoClear;
        gl.autoClear = false;
        gl.render(overlayScene, overlayCamera);
        gl.autoClear = prevAutoClear;
      },
    [composer, passes, gl, scene, camera, overlayScene, overlayCamera],
  );

  // Refresh the ref in the effect so useFrame does not capture stale size.
  const sizeRef = useRef(size);
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  useFrame(() => {
    // Video export uses target resolution; the canvas buffer has those dimensions.
    const rs = getRecordSize();
    if (rs) {
      renderFrame(rs.w, rs.h, rs.h / Math.max(1, sizeRef.current.height));
    } else {
      renderFrame(sizeRef.current.width, sizeRef.current.height);
    }
  }, 1);

  useEffect(() => {
    registerPipeline({ render: renderFrame });
    return () => registerPipeline(null);
  }, [renderFrame]);

  return null;
}
