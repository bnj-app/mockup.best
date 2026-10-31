/**
 * LAUNCH FACTORY: one input (screens, name, value line, features, colour) → a launch package of normal,
 * editable scenes and one ZIP. This file is the output contract: which outputs exist, their exact sizes,
 * file paths and the aspect each scene is framed in. Scenes are built in lib/launchBuilder.ts.
 *
 * Per language: 6 store designs × (iPhone medium + iPhone large + Google Play phone) = 18 PNG, the Google
 * Play feature graphic, 3 social images and one promo video = 23 files, plus manifest.json at the root.
 *
 * Store sizes (checked 2026-10-31): Apple requires "iPhone with Dynamic Island (medium display)", which
 * accepts 1206×2622; 1290×2796 is in the large group
 * (developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications).
 * The two iPhone ratios differ by 0.3 %, so one scene per design renders both sizes and an edit reaches
 * both. Google Play: 9:16 phone shots and a 1024×500 feature graphic, alpha-free
 * (support.google.com/googleplay/android-developer/answer/9866151).
 *
 * The video is a promo, not an App Store preview (those must show captured app use).
 */

export type LaunchDirectionId = 'clear' | 'bold' | 'quiet';
export type LaunchTarget = 'app-store' | 'google-play' | 'feature-graphic' | 'social-square' | 'social-portrait' | 'social-landscape' | 'video';
export type LaunchFormat = 'png' | 'jpeg' | 'mp4';
export type LaunchFile = { path: string; w: number; h: number; format: LaunchFormat };

/** One output: the scenes it is made from (one for an image, the video's scenes in order) and its files. */
export type LaunchOutput = {
  id: string;
  target: LaunchTarget;
  label: string;
  /** Frame aspect of its scene(s), config/aspects.ts. */
  aspectId: string;
  files: LaunchFile[];
  shotIds: string[];
};

/** Saved with the project (project.ts validates it). Media and texts live in the scenes, never here. */
export type LaunchProject = { v: 1; direction: LaunchDirectionId; outputs: LaunchOutput[] };

export const LAUNCH_STORE_DESIGNS = 6;
export const LAUNCH_VIDEO = { w: 1920, h: 1080, fps: 30, seconds: 20 } as const;
export const LAUNCH_ZIP_NAME = 'launch-package.zip';

const n2 = (i: number) => String(i + 1).padStart(2, '0');

/** Every output of a package, without scenes yet (the builder binds them). */
export function launchOutputSpecs(): Omit<LaunchOutput, 'shotIds'>[] {
  const out: Omit<LaunchOutput, 'shotIds'>[] = [];
  out.push({
    id: 'video',
    target: 'video',
    label: 'Promo video · 1920×1080',
    aspectId: '16-9',
    files: [{ path: 'video/promo-1920x1080-30fps.mp4', w: LAUNCH_VIDEO.w, h: LAUNCH_VIDEO.h, format: 'mp4' }],
  });
  for (let i = 0; i < LAUNCH_STORE_DESIGNS; i++) {
    out.push({
      id: `app-store-${n2(i)}`,
      target: 'app-store',
      label: `App Store ${n2(i)} · iPhone`,
      aspectId: 'as-iphone',
      files: [
        { path: `app-store/iphone-medium-1206x2622/${n2(i)}.png`, w: 1206, h: 2622, format: 'png' },
        { path: `app-store/iphone-large-1290x2796/${n2(i)}.png`, w: 1290, h: 2796, format: 'png' },
      ],
    });
  }
  for (let i = 0; i < LAUNCH_STORE_DESIGNS; i++) {
    out.push({
      id: `google-play-${n2(i)}`,
      target: 'google-play',
      label: `Google Play ${n2(i)} · phone`,
      aspectId: 'gp-phone',
      files: [{ path: `google-play/phone-1080x1920/${n2(i)}.png`, w: 1080, h: 1920, format: 'png' }],
    });
  }
  out.push({
    id: 'feature-graphic',
    target: 'feature-graphic',
    label: 'Google Play feature graphic',
    aspectId: 'gp-feature',
    files: [{ path: 'google-play/feature-graphic-1024x500.png', w: 1024, h: 500, format: 'png' }],
  });
  out.push({
    id: 'social-square',
    target: 'social-square',
    label: 'Social · square',
    aspectId: '1-1',
    files: [{ path: 'social/square-1080x1080.jpg', w: 1080, h: 1080, format: 'jpeg' }],
  });
  out.push({
    id: 'social-portrait',
    target: 'social-portrait',
    label: 'Social · portrait 4:5',
    aspectId: '4-5',
    files: [{ path: 'social/portrait-1080x1350.jpg', w: 1080, h: 1350, format: 'jpeg' }],
  });
  out.push({
    id: 'social-landscape',
    target: 'social-landscape',
    label: 'Social · landscape / cover',
    aspectId: '16-9',
    files: [{ path: 'social/landscape-cover-1920x1080.jpg', w: 1920, h: 1080, format: 'jpeg' }],
  });
  return out;
}

/** ZIP path of a file in one language (a language folder even when there is only one). */
export const launchPath = (lang: string, f: LaunchFile) => `${lang}/${f.path}`;

/** Media files per language (the manifest is one more file at the root). */
export const launchFileCount = (outputs: Pick<LaunchOutput, 'files'>[]) => outputs.reduce((a, o) => a + o.files.length, 0);
