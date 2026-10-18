/**
 * Material look-dev: GLB hardware material parameters. Centralized values let Stage glbMaterial
 * read one source while tuning frame/body/rear-glass roughness under HDR studio lighting. Localhost
 * debug (setLookdev) changes values live and invalidates the material cache with a version key.
 * Production uses defaults only.
 */
export const LOOKDEV_DEFAULTS = {
  /** Chassis frame (edge band). */
  /*
    Polished frame: fully metallic with low roughness for a sharp edge highlight under HDR lighting.
    Photo studio A/B comparison was equal or better. Previous values: 0.6 / 0.3 / 0.85.
  */
  frameMetal: 1,
  frameRoughMax: 0.14,
  frameRoughMul: 0.45,
  /** Body (laptop lid, watch case, etc.). */
  bodyMetalMin: 0.6,
  bodyRoughMin: 0.3,
  /** Rear glass. */
  backMetal: 0.35,
  backRough: 0.5,
  backCoat: 0.55,
  backCoatRough: 0.32,
  /** Environment intensity for metal parts. */
  metalEnv: 1.35,
  /** Laptop keys / trackpad (GLB names key / trackpad). */
  keyRough: -1,
  trackpadRough: -1,
  /**
   * Screen glass: values >0 add reflection over the screen (real glass reflects ~4% head-on, much
   * more at grazing angles due to Fresnel). 0 uses the legacy transparent layer at opacity 0.1,
   * which also limited reflections to 10%.
   */
  glassAdd: 0,
  /**
   * Additive glass intensity in HDR studio presets: off (0). Measurements showed 20–40-intensity
   * strips/softboxes whitening half the screen when the laptop lid tilted; rough glass hazed the
   * whole screen. User content must remain readable at every angle, so HDR studios also use the
   * controlled legacy transparent layer.
   */
  studioGlassAdd: 0,
  glassRough: 0.04,
  /** Camera-follow coefficients for the HDR studio environment (sign chosen by measurement). */
  envFollowYaw: 1,
  envFollowPitch: 1,
};

export type Lookdev = typeof LOOKDEV_DEFAULTS;

let current: Lookdev = { ...LOOKDEV_DEFAULTS };
let ver = 0;
const listeners = new Set<() => void>();

export function lookdev(): Lookdev {
  return current;
}
export function lookdevVersion() {
  return ver;
}
export function subscribeLookdev(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export function setLookdev(patch: Partial<Lookdev> | null) {
  current = patch ? { ...current, ...patch } : { ...LOOKDEV_DEFAULTS };
  ver += 1;
  for (const l of listeners) l();
}
