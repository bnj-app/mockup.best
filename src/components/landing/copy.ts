/**
 * Landing page copy: one dictionary per language, shared components. Every number is counted or
 * measured from code. Update here when values change: 13 devices (config/devices DEVICES), 16
 * backgrounds (config/backgrounds), 10 finishes (4 glass + 4 metal + 2 clay), 10 camera moves
 * (config/motion), 12 templates (config/templates), store sizes (ExportMenu SIZES), 5120 px stills /
 * 3840×2160 video, and 8 jitter samples (jitterPass).
 */

export type Lang = 'en' | 'tr';

export type SpecRow = { label: string; value: string; note?: string };
export type Faq = { q: string; a: string };
export type GuideLink = { slug: string; title: string };

export type LandingCopy = {
  lang: Lang;
  meta: { title: string; description: string; ogAlt: string };
  nav: { links: { href: string; label: string }[]; open: string; resume: string };
  hero: {
    eyebrow: string;
    h1: string;
    lede: string;
    cta: string;
    secondary: string;
    trust: string[];
    videoLabel: string;
    videoCaption: string;
    rulerLabel: string;
  };
  steps: { stamp: string; h2: string; items: { tag: string; title: string; body: string }[] };
  store: {
    stamp: string;
    h2: string;
    body: string;
    sizesLabel: string;
    sizes: SpecRow[];
    previewTitle: string;
    previewBody: string;
    zipLabel: string;
    imageAlt: string;
    imageCaption: string;
  };
  camera: {
    stamp: string;
    h2: string;
    body: string;
    movesLabel: string;
    moves: string[];
    points: { title: string; body: string }[];
    imageAlt: string;
    imageCaption: string;
  };
  mockup: {
    stamp: string;
    h2: string;
    body: string;
    rows: SpecRow[];
    imageAlt: string;
    imageCaption: string;
  };
  exportSec: {
    stamp: string;
    h2: string;
    body: string;
    head: [string, string, string];
    rows: [string, string, string][];
    alphaAlt: string;
    alphaCaption: string;
  };
  free: { stamp: string; h2: string; body: string; points: string[] };
  compare: {
    stamp: string;
    h2: string;
    note: string;
    head: string[];
    rows: string[][];
    sources: { label: string; href: string }[];
  };
  faq: { stamp: string; h2: string; items: Faq[] };
  guides: { stamp: string; h2: string; body: string; items: GuideLink[]; all: string };
  final: { h2: string; body: string; cta: string };
  footer: { meta: string; privacy: string; terms: string; guides: string; source: string; contact: string; langSwitch: { href: string; label: string } };
  guideBase: string;
};

export const COPY_EN: LandingCopy = {
  lang: 'en',
  meta: {
    title: '3D Device Mockups & App Store Preview Videos, Free | mockup.best',
    description:
      'Put screenshots on 3D phones, laptops and watches, animate the camera, and export 4K video, 5K stills and App Store or Google Play sets. Free, no account.',
    ogAlt: 'A phone mockup made in mockup.best, with the headline “3D device mockups and app store videos, made in your browser”.',
  },
  nav: {
    links: [
      { href: '#store', label: 'Store kit' },
      { href: '#camera', label: 'Camera' },
      { href: '#export', label: 'Export' },
      { href: '#faq', label: 'FAQ' },
      { href: '/guide/en/', label: 'Guides' },
    ],
    open: 'Open the editor',
    resume: 'Continue your project',
  },
  hero: {
    eyebrow: 'Free 3D mockup editor',
    h1: '3D device mockups and app store videos, made in your browser.',
    lede:
      'Drop in a screenshot, put it on a phone, laptop, tablet or watch, move the camera on a timeline, and export 4K video, 5K stills or a ready-to-upload App Store and Google Play set.',
    cta: 'Open the editor',
    secondary: 'See what it exports',
    trust: ['Free', 'No account', 'No watermark', 'Files never leave your device'],
    videoLabel: 'Output',
    videoCaption: 'The opening showcase — 5 scenes, 20 s, exported from mockup.best at 1920 × 1080.',
    rulerLabel: 'Scenes',
  },
  steps: {
    stamp: 'Source → Export',
    h2: 'From a screenshot to a finished file in one window.',
    items: [
      { tag: '01 Source', title: 'Drop a screen', body: 'A PNG, JPG or screen recording. It stays in this browser tab.' },
      { tag: '02 Mockup', title: 'Pick a device', body: '13 devices, 10 finishes, 16 backgrounds — or start from one of 12 templates.' },
      { tag: '03 Camera', title: 'Frame or animate', body: 'Drag to frame. Add keyframes on a timeline, or apply one of 10 camera moves.' },
      { tag: '04 Export', title: 'Take the file', body: 'Stills up to 5120 px, MP4 up to 4K at 60 fps, transparent WebM, or a store set.' },
    ],
  },
  store: {
    stamp: 'Export · Store kit',
    h2: 'Every store size, from every scene, in one ZIP.',
    body:
      'Store listings ask for a fixed list of sizes, and both stores reject PNGs that carry an alpha channel even when nothing in them is transparent. mockup.best knows the list. Export one size at a time, or take every scene in every App Store and Google Play size at once: folders named by store and size, files numbered by scene, no alpha channel.',
    sizesLabel: 'Image sizes',
    sizes: [
      { label: 'App Store · iPhone 6.9″', value: '1290 × 2796' },
      { label: 'App Store · iPad 13″', value: '2064 × 2752' },
      { label: 'App Store · Mac', value: '2880 × 1800' },
      { label: 'Google Play · Phone', value: '1080 × 1920' },
      { label: 'Google Play · Tablet', value: '1440 × 2560' },
      { label: 'Google Play · Feature graphic', value: '1024 × 500' },
    ],
    previewTitle: 'App Store preview videos that pass upload',
    previewBody:
      '886 × 1920 for current iPhones and 1200 × 1600 for iPad, locked to 30 fps, H.264 with a stereo AAC track. If your project has no audio, a silent track is added — previews without an audio track are often rejected on upload. Projects outside 15–30 seconds get a warning before you export.',
    zipLabel: 'What the ZIP contains',
    imageAlt: 'Five Google Play phone screenshots exported from mockup.best, one per scene of the demo project.',
    imageCaption: 'Five scenes, Google Play phone size, straight out of the store set.',
  },
  camera: {
    stamp: 'Camera',
    h2: 'A camera you direct, not a template you fill in.',
    body:
      'Camera angle, zoom, field of view, blur and light can all carry keyframes, each with its own easing curve. Scenes play back to back with cut, fade or slide transitions, and your audio track is mixed into the export.',
    movesLabel: '10 camera moves',
    moves: [
      'Scan left to right',
      'Top to bottom',
      'Low-angle pan up',
      'Slow zoom out',
      'Overhead pan',
      'Out and back',
      'Fold up',
      'Flat truck',
      'Symmetry glide',
      'Hero turn',
    ],
    points: [
      { title: 'Auto-motion', body: 'Draw focus areas on the screen; Auto-motion solves a camera path between them and hands it back as editable keyframes.' },
      { title: 'Lens blur', body: 'Depth of field from real scene depth. Keyframe the focus point for a rack focus.' },
      { title: 'Text behind the device', body: 'Titles can sit behind the phone, with word-by-word, knock and cycle animations.' },
    ],
    imageAlt: 'The mockup.best timeline with five scenes, keyframes and the playhead.',
    imageCaption: 'The timeline: scenes, keyframes per property, transitions.',
  },
  mockup: {
    stamp: 'Mockup · Scene',
    h2: 'Devices that read as objects, lit like product photos.',
    body:
      'The hardware is modelled, not drawn: real bevels, buttons and camera bumps that catch light from image-based studio lighting. The screen stays your screen — colour-accurate, and it can light the device and floor around it.',
    rows: [
      { label: 'Devices', value: '13', note: 'Phone, Phone Max, Phone Slim, Android, Android Ultra, Tablet, Watch, Laptop, Laptop 16″, Laptop Slim 13″, Display, Display 27″, Flat' },
      { label: 'Finishes', value: '10', note: 'Glass: Crystal, Smoke, Amber, Frost · Metal: Black, Silver, Titanium, White · Clay: Clay, Clay Dark' },
      { label: 'Layouts', value: '6', note: 'Single, Pair, Trio, Fan, Stack, Row' },
      { label: 'Backgrounds', value: '16', note: 'plus your own image, a custom gradient, or two 3D floors' },
      { label: 'Effects', value: '18', note: 'Bloom, flare, liquid glass, fish eye, ghost, screen fade, grain, vignette and tone controls' },
      { label: 'Laptop screens', value: '3', note: 'Menu bar, dock and browser frame, drawn around your screen' },
    ],
    imageAlt: 'A row of mockup.best devices: two phones, a tablet, a laptop and a watch.',
    imageCaption: 'Part of the device lineup, rendered in mockup.best.',
  },
  exportSec: {
    stamp: 'Export',
    h2: 'What comes out.',
    body:
      'MP4 video renders frame by frame, so a slow machine takes longer but never drops a frame. Every frame is drawn eight times with sub-pixel camera offsets and averaged, which keeps thin edges from shimmering as the camera moves.',
    head: ['Output', 'Format', 'Limits'],
    rows: [
      ['Still image', 'PNG, JPG, WebP', 'up to 5120 px · PNG and WebP keep transparency'],
      ['Video', 'MP4 (H.264)', 'up to 3840 × 2160 · 30 or 60 fps'],
      ['Transparent video', 'WebM (VP8 with alpha)', 'drops into editors and web pages without a background'],
      ['Edge quality', '8 jittered samples per pixel', 'more at High quality, which also renders at twice the size'],
      ['Motion blur', 'Off, low, medium, high', 'applied at render time'],
      ['Audio', 'Your tracks, mixed offline', 'AAC in the MP4'],
      ['Store presets', 'App Store and Google Play', 'PNG without alpha channel'],
      ['Store set', 'Every scene × every store size', 'one ZIP'],
    ],
    alphaAlt: 'A phone exported with a transparent background, shown over a checkerboard.',
    alphaCaption: 'Transparent PNG over a checkerboard: no background baked in.',
  },
  free: {
    stamp: 'Price',
    h2: 'Free, with nothing held back.',
    body:
      'Every feature is free today: unlimited exports, no watermark, no account. If a paid plan ever arrives, the terms page will say what changes before it does.',
    points: ['Unlimited exports', '4K video and 5K stills', 'Transparent video', 'You keep every right to what you export'],
  },
  compare: {
    stamp: 'Compared',
    h2: 'How it compares.',
    note: 'Read from each product’s own pricing page on 8 October 2026. Names are left out on purpose. “—” means the page does not say.',
    head: ['', 'mockup.best', 'Popular browser editor (free plan)', 'Popular Mac app'],
    rows: [
      ['Price', 'Free', 'Free; paid plan $20/month or $120/year', 'One-time purchase, three tiers'],
      ['Runs in', 'Browser', 'Browser', 'macOS 11+ app'],
      ['Exports', 'Unlimited', '3 per 24 hours', '—'],
      ['Watermark', 'No', 'Yes', '—'],
      ['Largest still', '5120 px', '1920 px', 'Up to 8K, depending on tier'],
      ['Video', 'Up to 4K, 60 fps', '720p, 30 fps', 'Up to 8K, depending on tier'],
      ['Transparent video', 'Yes (WebM)', 'No', '—'],
      ['Device models', '13', '2 of 18', '30+'],
    ],
    /* Other tools are described by category, not by name. */
    sources: [],
  },
  faq: {
    stamp: 'FAQ',
    h2: 'Questions people ask first.',
    items: [
      {
        q: 'Is mockup.best really free?',
        a: 'Yes. Every feature is free, including 4K video, 5K stills and transparent video. There is no account, no export limit and no watermark.',
      },
      {
        q: 'Are my screenshots uploaded anywhere?',
        a: 'No. mockup.best renders in your browser with WebGL; your images and recordings never leave your device. A share link carries the scene setup, not your images.',
      },
      {
        q: 'What sizes does it export for the App Store?',
        a: 'Screenshots: iPhone 6.9″ 1290 × 2796, iPad 13″ 2064 × 2752 and Mac 2880 × 1800. Preview videos: 886 × 1920 for iPhone, 1200 × 1600 for iPad and 1920 × 1080 for Mac and Apple TV, at 30 fps with a stereo AAC track.',
      },
      {
        q: 'And for Google Play?',
        a: 'Phone 1080 × 1920, tablet 1440 × 2560 and the 1024 × 500 feature graphic, as PNG or JPG without an alpha channel. 1290 × 2796 is not offered for Play because Play rejects images whose long side is more than twice the short side.',
      },
      {
        q: 'Can I export a mockup video with a transparent background?',
        a: 'Yes, as WebM with an alpha channel, for After Effects, Premiere, Figma or a web page. MP4 cannot carry transparency, so App Store previews always have a background.',
      },
      {
        q: 'Can I animate the camera?',
        a: 'Yes. Set keyframes on a timeline for angle, zoom, field of view, blur and light, apply one of 10 camera moves, or let Auto-motion build a path between areas you mark on the screen.',
      },
      {
        q: 'Which browser should I use?',
        a: 'mockup.best is built and tested in Chrome and Edge on desktop. It needs WebGL 2, and video export uses WebCodecs. Framing and still exports work on a phone; the timeline needs a desktop-sized screen.',
      },
      {
        q: 'Can I use the exports commercially?',
        a: 'Yes. You keep every right to what you bring in and to what you export; mockup.best claims no ownership or licence. You are responsible for having the right to use the screens you put in.',
      },
    ],
  },
  guides: {
    stamp: 'Guides',
    h2: 'Guides for store visuals and mockup video.',
    body: 'Thirty short guides on sizes, framing, light and motion, in eleven languages.',
    items: [
      { slug: 'app-store-screenshot-sizes', title: 'App Store screenshot sizes, without the spreadsheet' },
      { slug: 'google-play-screenshot-sizes', title: 'Google Play screenshot sizes and store graphics' },
      { slug: 'first-screenshot', title: 'Your first screenshot is doing most of the work' },
      { slug: '20-second-promo-anatomy', title: 'How a 20-second app promo is actually built' },
      { slug: 'camera-angles', title: 'Camera angles: five framings that cover almost everything' },
      { slug: 'lighting-and-shadows', title: 'Lighting a device mockup so it looks like an object' },
      { slug: 'transparent-background-mockups', title: 'Transparent mockups: useful everywhere except app stores' },
      { slug: 'website-hero-mockup', title: 'Using a mockup in a landing page hero' },
    ],
    all: 'All guides',
  },
  final: {
    h2: 'Open it and drop in a screenshot.',
    body: 'Nothing to install, nothing to sign up for. Works best in Chrome or Edge on a desktop.',
    cta: 'Open the editor',
  },
  footer: {
    meta: 'A browser tool for 3D device mockups and app videos',
    privacy: 'Privacy',
    terms: 'Terms',
    guides: 'Guides',
    source: 'Source code',
    contact: 'Contact',
    langSwitch: { href: '/tr/', label: 'Türkçe' },
  },
  guideBase: '/guide/en/',
};
