'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { BRAND } from '@/config/brand';

/**
 * "WHAT'S NEW". The product changes quickly; users should not have to discover new controls
 * unaided. A small, dismissible box at bottom left uses a version key in localStorage so each
 * version appears once. Maintain the list manually: parsing commit messages into a changelog would
 * expose unhelpful implementation details to users.
 */
/*
  Refresh the stale list with changes backed by commits: Magic Reel, screen glow, free access, 22×
  faster 4K PNG and supersampling. Changing the version invalidates the old "seen" key so returning
  users see it once.
*/
/*
  Store updates cover App Store preview dimensions, Google Play and store-set ZIP, plus rotation
  fixes. The iPhone preview ratio changed from 1080×1920 to 886×1920, affecting saved project
  framing; the second item explains this. Edge jitter accumulation required a new version key so
  users who had already read the list would see it. Screen scrolling was added under the same key
  intentionally: tests write it into localStorage, so changing it requires updating ~50 test files
  together.
*/
/*
  Updates include accents, beats, template previews, device animation, languages, brand kits and
  auto-motion markers. Change the key so returning users see the seven new items; same-day
  additions retain it. Limit the list to those seven plus three major previous items to avoid a
  wall of text. Update test "seen" keys together.
*/
/*
  Visual updates include HDR studio lighting, rebuilt lens blur, macro, device materials, Lid angle
  fixes, new floors and the initial white-screen fix. Change the key for returning users, keep the
  three largest previous items, and update test "seen" keys together.
*/
/*
  Updates include 15 fixes plus the project shelf, Update screens, Hide private info and Start from
  a goal. Change the key, keep the three largest previous items, and update test "seen" keys
  together.
*/
const VERSION = '2026-10-15';
const ITEMS = [
  'Projects on this device: your screenshots, videos and music come back after a refresh — and you can save, reopen, copy and delete whole projects. Stored in this browser; nothing is uploaded',
  'Update screens: drop your app’s new screenshots and every scene showing a screen with the same name updates at once — camera moves, text and timing stay',
  'Hide private info: cover emails, names or balances with erase, bar, pixelate or blur — burned into the image, the original is never saved or shared',
  'Start from a goal: Feature launch video, App Store set or Portfolio showcase — drop your screens, get the scenes and the right export list',
  'Fixed: deleted music stops playing, and edits made after creating a share link survive a refresh',
  'Fixed: splitting a scene keeps the motion, the video position and the text timing; Reverse and seamless loop now mirror the easing too',
  'Fixed: video exports no longer show a blank or previous frame where a video scene begins, and Trim out is applied in exports',
  'Dark studio and White studio lighting: real bright softboxes and strip lights put crisp highlights on metal edges — and the light turns with your camera',
  'Lens blur rebuilt: smooth, depth-aware bokeh with no ghost edges — the device in focus stays sharp, everything else melts away',
  'Languages: translate every text once (or paste a CSV), preview any language, and export the store set, an image or a video for every language in one ZIP',
];

export function WhatsNew() {
  const key = `mockuptop:whatsnew:${VERSION}`;
  /*
    Hydration: hide the box on the server and first client render; show it after hydration. Reading
    localStorage in a lazy initializer caused a server/client mismatch and React hydration error
    #418.
  */
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [dismissed, setDismissed] = useState(false);
  const seen = mounted && (() => {
    try {
      return window.localStorage.getItem(key) === 'seen';
    } catch {
      return true;
    }
  })();

  /*
    Hide the changelog on first visits. A clean profile otherwise sees both the six-step onboarding
    tour and this box at once. They compete for attention, and fixes mean little to users who never
    experienced the bugs. An unfinished tour marks a first visit: hide the box and silently mark the
    version as seen, since users are already meeting the current product. Returning users who
    finished the tour see the list normally.
  */
  const firstVisit =
    mounted &&
    (() => {
      try {
        return !window.localStorage.getItem('mockuptop:tour-seen:v1');
      } catch {
        return false;
      }
    })();

  useEffect(() => {
    if (!mounted || !firstVisit) return;
    try {
      window.localStorage.setItem(key, 'seen');
    } catch {
      // Without storage, nothing can be persisted anyway.
    }
  }, [mounted, firstVisit, key]);

  if (!mounted || seen || dismissed || firstVisit) return null;

  const close = () => {
    try {
      window.localStorage.setItem(key, 'seen');
    } catch {
      // Without storage, the box harmlessly appears again next time.
    }
    setDismissed(true);
  };

  return (
    <div
      /*
        Top left instead of bottom left: the box covered timeline scene rows (measured: box y=715,
        timeline starts at y=690). Above the frame it stays visible without obstructing work.
      */
      className="fixed left-3 top-16 z-[700] w-[290px] p-3"
      /*
        Use a separate layer. In normal flow, this translucent box over WebGL caused 55–58 ms stalls at
        scene boundaries (zero with it closed), forcing the shared layer to recomposite each frame.
        translateZ(0) + contain isolate the box so it does not affect canvas painting.
      */
      style={{
        background: 'var(--mp-dropdown)',
        border: '1px solid var(--mp-border)',
        borderRadius: 'var(--mp-radius-lg)',
        boxShadow: 'var(--mp-shadow-dropdown)',
        transform: 'translateZ(0)',
        willChange: 'transform',
        contain: 'paint',
      }}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="mp-label" style={{ color: 'var(--mp-text-focus)' }}>
          What&apos;s new in {BRAND.name}
        </span>
        <button className="mp-label" onClick={close} aria-label="Dismiss" style={{ color: 'var(--mp-text-tertiary)' }}>
          ✕
        </button>
      </div>
      <ul className="flex flex-col gap-1">
        {ITEMS.map((t) => (
          <li key={t} className="mp-label flex gap-1.5" style={{ color: 'var(--mp-text-label)' }}>
            <span style={{ color: 'var(--mp-accent)' }}>•</span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
