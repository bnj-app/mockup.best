'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { PhotoAsset } from '@photo/lib/assets';
import { SHADOW_DEFAULT, ZOOM_DEFAULT } from '@photo/config/ui';
import { PATTERN_DEFAULT, type PatternName } from '@photo/config/patterns';
import { FREE_FOR_ALL } from '@/config/brand';

export type BgMode = 'None' | 'Video' | 'Image';
export type Media = { url: string; type: 'image' | 'video' } | null;
/**
 * Three source types:
 *  - device: generic phone body and screen.
 *  - photo: hand/scene photo with the body already in the photo.
 *  - bare: screen only, without a body; Border adds a 2px dark ring.
 */
export type Source =
  | { kind: 'device'; id: string }
  | { kind: 'photo'; id: string }
  | { kind: 'bare' }
  | null;

export type PhotoState = {
  assets: PhotoAsset[];
  assetsLoaded: boolean;

  source: Source;
  deviceBorder: 'None' | 'Border';

  media: Media;
  bgMode: BgMode;
  bgColor: string;
  bgImage: string | null;
  /** Background video: BACKGROUND > Video. */
  bgVideo: string | null;

  preset: string;
  /** Degrees: rotate the body in bare-device mode. */
  tilt: number;
  appName: string;
  appLogo: string | null;
  emojis: string[];
  /** Emojis to place on the background, up to 5 selections. */
  bgEmojis: string[];
  pattern: PatternName;
  animate: boolean;
  pro: boolean;
  shadow: string;
  zoom: number;
  showStatusBar: boolean;
  /** Frame Dynamic Island (equivalent to deviceOpts.notch in the 3D editor). */
  showIsland: boolean;

  setAssets: (a: PhotoAsset[]) => void;
  setSource: (s: Source) => void;
  set: (p: Partial<PhotoState>) => void;
  reset: () => void;
  /** Load the shared Pro flag AFTER mount for hydration safety. */
  hydrateShared: () => void;
};

const INITIAL = {
  assets: [] as PhotoAsset[],
  assetsLoaded: false,
  source: { kind: 'device', id: 'pro' } as Source,
  deviceBorder: 'None' as 'None' | 'Border',
  media: null as Media,
  bgMode: 'Image' as BgMode,
  bgColor: '#ffffff',
  bgImage: null as string | null,
  bgVideo: null as string | null,
  preset: 'Default',
  tilt: 0,
  appName: '',
  appLogo: null as string | null,
  emojis: [] as string[],
  bgEmojis: [] as string[],
  pattern: PATTERN_DEFAULT as PatternName,
  animate: true,
  pro: FREE_FOR_ALL,
  shadow: SHADOW_DEFAULT as string,
  zoom: ZOOM_DEFAULT as number,
  /*
    OFF BY DEFAULT. Uploaded screenshots usually already include a status bar
    from a phone/simulator. Our bar renders below it rather than replacing it,
    producing two clocks ("09:41" and "9:41"). The 3D editor also defaults to off
    (editor.ts statusBar.on). Users can enable it in the DEVICE card.
  */
  showStatusBar: false,
  /*
    ON BY DEFAULT to preserve the existing appearance. Allow disabling it when
    a screenshot already includes an island (simulator frames, design-tool
    exports or demo images); overlapping islands create a doubled, jagged black
    shape. The 3D editor has a notch toggle for the same reason.
  */
  showIsland: true,
};

/**
 * URL.createObjectURL retains the underlying file in memory until
 * revokeObjectURL is called; garbage collection cannot free it. Release the
 * old URL when a new upload replaces it, or 50 MB screen recordings can
 * quickly inflate the tab's memory usage.
 */
/**
 * PRO status is shared with the 3D editor.

 * The photo module's separate pro flag was never set to true, making its paid
 * tier unreachable. Every export stayed at 1080 with a watermark, even though
 * /photo/pro showed a real price. Read the 3D editor's persistent key so there
 * is one Pro model and, once payments are connected, one writer.
 */
function readSharedPro(): boolean {
  // Everything is free (brand.ts FREE_FOR_ALL), including 4K and watermark-free photo exports.
  if (FREE_FOR_ALL) return true;
  if (typeof window === 'undefined') return false;
  try {
    if (window.localStorage.getItem('mockuptop:pro:v1') === '1') return true;
    // The 24-hour trial also counts as PRO using the shared 3D key;
    // otherwise trial users would still receive watermarked photo exports.
    const until = Number(window.localStorage.getItem('mockuptop:pro-trial:v1'));
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

export function revokeBlob(url: string | null | undefined) {
  if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
}

export const usePhoto = create<PhotoState>()(
  persist(
    (set, get) => ({
      ...INITIAL,
      /*
        HYDRATION: initial values must match the server. Calling readSharedPro()
        here made the first client frame Pro while the server was not, causing
        React #418. Use INITIAL.pro, a shared build-time constant, then apply the
        saved flag through hydrateShared() AFTER mount.
      */
      hydrateShared: () => set({ pro: readSharedPro() }),
      setAssets: (assets) => set({ assets, assetsLoaded: true }),
      setSource: (source) => set({ source }),
      set: (p) => set(p),
      /**
       * assets/assetsLoaded/emojis are loader state, not user settings; partialize
       * also excludes them. Preserve them on reset: manifest loading and emoji
       * seeding only run at mount. Clearing them left HAND/Scene cards and the emoji
       * strip empty until refresh.
       */
      reset: () => {
        const s = get();
        revokeBlob(s.media?.url);
        revokeBlob(s.appLogo);
        revokeBlob(s.bgImage);
        revokeBlob(s.bgVideo);
        set({ ...INITIAL, assets: s.assets, assetsLoaded: s.assetsLoaded, emojis: s.emojis });
      },
    }),
    {
      name: 'mockupfoto:v1',
      storage: createJSONStorage(() => localStorage),
      /*
        ⚠️ skipHydration was tried and reverted. Moving rehydrate to mount appeared
        hydration-safe but LOST SETTINGS: the store starts with INITIAL, then mount
        writes (manifest, dimensions, source) trigger persistence and overwrite saved
        settings with defaults before manual rehydrate wins the race. Measurements
        confirmed that color and zoom were lost after refresh.
        React #418 actually came from localStorage reads in the 3D store's initial
        value (store/editor.ts); fixing that removed warnings on both routes.
      */
      /**
       * Persist SETTINGS only. assets comes from the manifest so old saves cannot
       * overwrite a new manifest. media/appLogo data URIs can exhaust localStorage
       * quota on their own.
       */
      partialize: (s) => ({
        source: s.source,
        deviceBorder: s.deviceBorder,
        bgMode: s.bgMode,
        bgColor: s.bgColor,
        preset: s.preset,
        tilt: s.tilt,
        appName: s.appName,
        shadow: s.shadow,
        zoom: s.zoom,
        showStatusBar: s.showStatusBar,
        showIsland: s.showIsland,
        bgEmojis: s.bgEmojis,
        pattern: s.pattern,
        animate: s.animate,
        // Do not persist pro here: the shared mockuptop:pro:v1 key is authoritative.
        // Keeping it in two places would allow the values to diverge.
      }),
      /**
       * Merge loaded settings OVER fresh defaults. Missing fields previously led
       * to undefined -> NaN -> scene crashes; this migration pattern prevents that.
       */
      merge: (persisted, current) => ({ ...current, ...(persisted as object) }),
    },
  ),
);
