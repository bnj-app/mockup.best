/**
 * Use-case page copy in English and Turkish.
 *
 * Each page serves a distinct purpose: a deep link to the right pack,
 * a gallery, or a working checker. Describe actual product behavior;
 * omit statistics and dates. Read dimensions from config/aspects.ts
 * through UsePage rather than hard-coding them here.
 */

export type UseLang = 'en' | 'tr';
export type UseId = 'app-store' | 'promo' | 'portfolio' | 'redact' | 'templates' | 'checker';

export type UseCopy = {
  id: UseId;
  lang: UseLang;
  path: string;
  meta: { title: string; description: string; og: string; ogAlt: string };
  crumb: string;
  eyebrow: string;
  h1: string;
  lede: string;
  cta: { label: string; href: string };
  privacy: string;
  steps: { title: string; body: string }[];
  /** "What you get" list items. */
  gets: { h2: string; items: string[] };
  notes?: { h2: string; items: string[] };
  faq: { q: string; a: string }[];
  related: { href: string; label: string }[];
};

/** EN ↔ TR routes shared by hreflang, language switching, and the sitemap. */
export const USE_PATHS: Record<UseId, Record<UseLang, string>> = {
  'app-store': { en: '/app-store-screenshot-generator/', tr: '/tr/app-store-ekran-goruntusu-olusturucu/' },
  promo: { en: '/app-promo-video-maker/', tr: '/tr/uygulama-tanitim-videosu/' },
  portfolio: { en: '/portfolio-mockup-generator/', tr: '/tr/portfolyo-mockup/' },
  redact: { en: '/hide-sensitive-info-in-screenshots/', tr: '/tr/ekran-goruntusunde-bilgi-gizleme/' },
  templates: { en: '/templates/', tr: '/tr/sablonlar/' },
  checker: { en: '/screenshot-size-checker/', tr: '/tr/ekran-goruntusu-boyut-kontrolu/' },
};

export const USE_ORDER: UseId[] = ['app-store', 'promo', 'portfolio', 'redact', 'templates', 'checker'];

/** Cross-page cards for the lower section and home-page row. */
export const USE_CARDS: Record<UseLang, Record<UseId, { title: string; body: string }>> = {
  en: {
    'app-store': { title: 'App Store screenshots', body: 'Headline + 3D device, every store size in one ZIP' },
    promo: { title: 'App promo video', body: 'A 10–20 s launch video from your screenshots' },
    portfolio: { title: 'Portfolio mockups', body: 'Laptop + phone scenes for Dribbble and case studies' },
    redact: { title: 'Hide private info', body: 'Erase emails, names and balances before you share' },
    templates: { title: 'Mockup templates', body: '12 ready-made looks, each a real render' },
    checker: { title: 'Screenshot size checker', body: 'Check store sizes and alpha before you upload' },
  },
  tr: {
    'app-store': { title: 'App Store ekran görüntüleri', body: 'Başlık + 3B cihaz, bütün mağaza ölçüleri tek ZIP' },
    promo: { title: 'Uygulama tanıtım videosu', body: 'Ekran görüntülerinden 10–20 sn’lik tanıtım' },
    portfolio: { title: 'Portföy mockup’ları', body: 'Dribbble ve vaka çalışması için laptop + telefon' },
    redact: { title: 'Bilgi gizleme', body: 'Paylaşmadan önce e-posta, isim, bakiye sil' },
    templates: { title: 'Mockup şablonları', body: 'Hazır 12 görünüm, hepsi gerçek render' },
    checker: { title: 'Boyut kontrolü', body: 'Yüklemeden önce mağaza ölçüsü ve şeffaflık' },
  },
};

const G = (lang: UseLang) => (lang === 'tr' ? '/guide/tr/' : '/guide/en/');

export const USES: Record<UseLang, Record<UseId, UseCopy>> = {
  en: {
    'app-store': {
      id: 'app-store',
      lang: 'en',
      path: USE_PATHS['app-store'].en,
      meta: {
        title: 'App Store Screenshot Generator — free, every size in one ZIP | mockup.best',
        description:
          'Turn your app screenshots into App Store and Google Play screenshots: a headline above a 3D device, your brand color, every required size exported in one ZIP. Free, no account, nothing uploaded.',
        og: '/uses/app-store-og.jpg',
        ogAlt: 'Three App Store screenshots made with mockup.best, each with a headline above a phone',
      },
      crumb: 'App Store screenshot generator',
      eyebrow: 'Store set',
      h1: 'App Store screenshot generator',
      lede:
        'Drop up to five screenshots of your app, write a headline for each, pick your brand color — and download every App Store and Google Play size in one ZIP. Each screenshot is a normal scene you can still change: device, angle, text, background.',
      cta: { label: 'Start an App Store set', href: '/editor/?start=app-store' },
      privacy: 'Runs in your browser. Your screenshots are not uploaded.',
      steps: [
        { title: 'Drop your screenshots', body: 'Up to five. Files named screen-1.png, screen-2.png … land in that order.' },
        { title: 'Write the headlines', body: 'One short line per screenshot, and one brand color for the background.' },
        { title: 'Export the store set', body: 'Export → Image → Store set: every scene at every App Store and Google Play size, in folders.' },
      ],
      gets: {
        h2: 'What you get',
        items: [
          'One ZIP with a folder per store and size, files numbered in scene order',
          'PNG or JPG without an alpha channel — the stores refuse transparent screenshots',
          'Named screens: when your app changes, drop the new screenshots on Update screens and every scene updates at once',
        ],
      },
      faq: [
        { q: 'Is it free?', a: 'Yes. Every feature is free with unlimited exports, no account and no watermark.' },
        {
          q: 'Which sizes are in the store set?',
          a: 'The sizes listed on this page: the App Store iPhone, iPad and Mac screenshot sizes and the Google Play phone, tablet and feature graphic. Apple accepts more sizes per device class; the guide below lists them.',
        },
        {
          q: 'Can I change a screenshot after it is built?',
          a: 'Yes. Each screenshot is a scene in the editor: change the device, the camera angle, the headline, the font or the background, then export again.',
        },
        {
          q: 'Are my screenshots uploaded anywhere?',
          a: 'No. mockup.best renders in your browser with WebGL. The files stay on your device.',
        },
      ],
      related: [
        { href: USE_PATHS.checker.en, label: 'Screenshot size checker' },
        { href: `${G('en')}app-store-screenshot-sizes.html`, label: 'Guide: App Store screenshot sizes' },
        { href: `${G('en')}google-play-screenshot-sizes.html`, label: 'Guide: Google Play screenshot sizes' },
        { href: `${G('en')}screenshot-captions.html`, label: 'Guide: writing screenshot captions' },
      ],
    },
    promo: {
      id: 'promo',
      lang: 'en',
      path: USE_PATHS.promo.en,
      meta: {
        title: 'App Promo Video Maker — launch video from screenshots, free | mockup.best',
        description:
          'Make a 10–20 second promo video of your app from screenshots: your main screen opens and closes it, each feature gets a camera move and a caption. MP4 up to 4K 60 fps. Free, in your browser.',
        og: '/uses/promo-og.jpg',
        ogAlt: 'A phone mockup from a mockup.best promo video',
      },
      crumb: 'App promo video maker',
      eyebrow: 'Feature launch',
      h1: 'App promo video maker',
      lede:
        'Give it your main screen and up to three feature screens. You get a finished promo: the main screen opens and closes the video, each feature gets its own camera move and a short caption, your app name closes it. Every scene stays editable on the timeline.',
      cta: { label: 'Make a promo video', href: '/editor/?start=feature-launch' },
      privacy: 'Runs in your browser. Your screenshots and recordings are not uploaded.',
      steps: [
        { title: 'Drop your screens', body: 'A main screen, then up to three features. One screen gives an 8 s video, four give 20 s.' },
        { title: 'Add captions', body: 'Up to four words per feature and a closing line with your app name.' },
        { title: 'Export the video', body: 'Export → Video → MP4. Add music first if you like — it is mixed into the file.' },
      ],
      gets: {
        h2: 'What you get',
        items: [
          'MP4 (H.264) up to 3840 × 2160 at 30 or 60 fps, rendered frame by frame',
          'Optional: one ZIP with 16:9, 9:16, 1:1 and 4:5 versions — the camera refits each ratio',
          'A normal project: swap any screen for a screen recording, change the timing, add text',
        ],
      },
      notes: {
        h2: 'Good to know',
        items: [
          'The video was made for 16:9. In vertical and square versions, check that the captions clear the device.',
          'App Store previews have their own sizes (in the canvas menu) and Apple expects them to show the app in use.',
        ],
      },
      faq: [
        { q: 'How long is the video?', a: '8 seconds with only a main screen, up to 20 seconds with three features. You can change any scene length afterwards.' },
        { q: 'Can I use a screen recording?', a: 'The pack starts from screenshots. Afterwards you can put a screen recording on any scene; speed and trim are in the Source panel.' },
        { q: 'Can I add music?', a: 'Yes. Drop an audio file on the timeline; it plays in the preview and is mixed into the MP4.' },
        { q: 'Is there a watermark?', a: 'No. Exports are free, unlimited and unmarked.' },
      ],
      related: [
        { href: `${G('en')}20-second-promo-anatomy.html`, label: 'Guide: how a 20-second app promo is built' },
        { href: `${G('en')}app-preview-video-specs.html`, label: 'Guide: App preview video specs' },
        { href: `${G('en')}play-store-promo-video.html`, label: 'Guide: Play Store promo video' },
        { href: USE_PATHS['app-store'].en, label: 'App Store screenshot generator' },
      ],
    },
    portfolio: {
      id: 'portfolio',
      lang: 'en',
      path: USE_PATHS.portfolio.en,
      meta: {
        title: 'Portfolio Mockup Generator — laptop + phone shots for Dribbble | mockup.best',
        description:
          'Show a web or app project on a 3D laptop and phone: desktop, mobile and both together, as 4:3 images and a short video for Dribbble, Behance or a case study. Free, in your browser.',
        og: '/uses/portfolio-og.jpg',
        ogAlt: 'A laptop and a phone mockup showing the same product, made with mockup.best',
      },
      crumb: 'Portfolio mockup generator',
      eyebrow: 'Portfolio showcase',
      h1: 'Portfolio mockup generator',
      lede:
        'Drop a desktop screenshot and, if you have one, a mobile screen. You get three scenes — the desktop on a laptop, the mobile screen on a phone, and both together — with your project title, as 4:3 images and a short video.',
      cta: { label: 'Build a portfolio set', href: '/editor/?start=portfolio' },
      privacy: 'Runs in your browser. Client work never leaves your device.',
      steps: [
        { title: 'Drop your screens', body: 'A desktop screenshot, plus an optional mobile screen for the phone and duo scenes.' },
        { title: 'Title and color', body: 'A project title, a one-line description and a background color.' },
        { title: 'Export', body: 'Pick a scene and Export → Image (1600 × 1200 for Dribbble), or Export → Video for the whole set.' },
      ],
      gets: {
        h2: 'What you get',
        items: [
          'Three scenes with a slow camera move, ready as stills or one short video',
          '13 devices to switch to — laptops, phones, tablet, watch, displays — and glass or metal finishes',
          'PNG and WebP keep transparency if you turn the background off',
        ],
      },
      faq: [
        { q: 'Which size should I use for Dribbble?', a: 'Dribbble shots are 4:3; the pack sets a 4:3 canvas, so export at 1600 × 1200 or larger.' },
        { q: 'Can I add a third device?', a: 'Yes. Layouts (Pair, Trio, Fan, Stack, Row) add devices around the main one; each can show its own screen.' },
        { q: 'Is it safe for client work?', a: 'Nothing is uploaded. If a screenshot shows real data, use Hide private info before you share.' },
      ],
      related: [
        { href: `${G('en')}macbook-mockup.html`, label: 'Guide: MacBook mockups' },
        { href: `${G('en')}website-hero-mockup.html`, label: 'Guide: mockups in a landing page hero' },
        { href: USE_PATHS.redact.en, label: 'Hide private info in screenshots' },
        { href: USE_PATHS.templates.en, label: 'Mockup templates' },
      ],
    },
    redact: {
      id: 'redact',
      lang: 'en',
      path: USE_PATHS.redact.en,
      meta: {
        title: 'Hide Sensitive Info in Screenshots — erase, blur or pixelate | mockup.best',
        description:
          'Cover emails, names, balances and other private details in a screenshot before you share it: erase, bar, pixelate or blur, burned into the image. Runs in your browser — the screenshot is never uploaded.',
        og: '/uses/redact-og.jpg',
        ogAlt: 'A phone screenshot before and after its email and balance were erased',
      },
      crumb: 'Hide sensitive info in screenshots',
      eyebrow: 'Hide private info',
      h1: 'Hide sensitive info in screenshots',
      lede:
        'Drag a box over an email, a customer name or a balance and choose how to cover it. The area is burned into the image, and the cleaned copy replaces the original on every scene that uses it — so nothing private ends up in your mockups, exports or share links.',
      cta: { label: 'Open the editor', href: '/editor/?tool=redact' },
      privacy: 'Your screenshot is processed in your browser and never uploaded.',
      steps: [
        { title: 'Upload a screenshot', body: 'Drop it in the editor; it lands on a 3D device.' },
        { title: 'Mark the details', body: 'Source → Hide private info. Drag over each detail and pick Erase, Bar, Pixelate or Blur.' },
        { title: 'Apply and share', body: 'The cleaned image replaces the original everywhere. Export or share as usual.' },
      ],
      gets: {
        h2: 'Four ways to cover',
        items: [
          'Erase — fills the area with the surrounding color, as if the text was never there (opaque)',
          'Bar — a solid block of color (opaque)',
          'Pixelate — large blocks; text becomes unreadable',
          'Blur — a strong two-pass blur',
        ],
      },
      notes: {
        h2: 'Good to know',
        items: [
          'Erase and Bar leave no pixels to recover. For passwords or card numbers, use one of those two.',
          'The original stays in the open tab’s memory so you can undo. It is never saved, exported or shared.',
          'When you drop a new version of the screen (Update screens), the same areas are covered again.',
          'Images only for now — not screen recordings.',
        ],
      },
      faq: [
        { q: 'Is the covering permanent?', a: 'Yes, in everything you export, save or share. Only the open tab keeps the original, for undo.' },
        { q: 'Can a blurred area be recovered?', a: 'Blur and pixelate use strong settings, but they keep some color. For anything critical, use Erase or Bar — they leave nothing behind.' },
        { q: 'Is my screenshot uploaded?', a: 'No. Everything happens in your browser.' },
      ],
      related: [
        { href: USE_PATHS['app-store'].en, label: 'App Store screenshot generator' },
        { href: USE_PATHS.portfolio.en, label: 'Portfolio mockup generator' },
        { href: `${G('en')}mockup-copyright.html`, label: 'Guide: device mockups and legal questions' },
      ],
    },
    templates: {
      id: 'templates',
      lang: 'en',
      path: USE_PATHS.templates.en,
      meta: {
        title: 'Device Mockup Templates — 12 free 3D looks | mockup.best',
        description:
          'Twelve ready-made 3D device mockup looks — studio glass, App Store shot, desk setup, wrist close-up, cinematic angles. Each preview is a real render; open one, add your screenshot, export. Free.',
        og: '/uses/templates-og.jpg',
        ogAlt: 'A grid of mockup.best device mockup templates',
      },
      crumb: 'Mockup templates',
      eyebrow: 'Templates',
      h1: 'Device mockup templates',
      lede:
        'Twelve looks to start from: device, angle, light, background and finish set together. Every preview below is the template rendered by mockup.best. Open one, put your screenshot on it, and change anything you like.',
      cta: { label: 'Open the editor', href: '/editor/' },
      privacy: 'Free, no account. Your screenshots stay on your device.',
      steps: [
        { title: 'Pick a look', body: 'Use template opens the editor with that template highlighted.' },
        { title: 'Apply it', body: 'One click applies it to the open scene — Ctrl+Z undoes.' },
        { title: 'Make it yours', body: 'Swap the screenshot, the device or the colors, then export.' },
      ],
      gets: {
        h2: 'Every template sets',
        items: ['Device and finish', 'Camera angle and lens', 'Studio light and background', 'You can save your own setups as templates in the editor'],
      },
      faq: [
        { q: 'Are the templates free?', a: 'Yes, all of them, with unlimited exports.' },
        { q: 'Will a template change my project?', a: 'Not by itself. The editor highlights the template; it is applied only when you click it, and Ctrl+Z undoes it.' },
      ],
      related: [
        { href: USE_PATHS['app-store'].en, label: 'App Store screenshot generator' },
        { href: `${G('en')}camera-angles.html`, label: 'Guide: camera angles for device mockups' },
        { href: `${G('en')}mockup-backgrounds.html`, label: 'Guide: mockup backgrounds' },
      ],
    },
    checker: {
      id: 'checker',
      lang: 'en',
      path: USE_PATHS.checker.en,
      meta: {
        title: 'App Store & Google Play Screenshot Size Checker — free | mockup.best',
        description:
          'Check your screenshots before you upload: size, aspect ratio and alpha channel, against App Store and Google Play rules. Runs in your browser — files are not uploaded.',
        og: '/uses/checker-og.jpg',
        ogAlt: 'Two App Store screenshots on a dark background',
      },
      crumb: 'Screenshot size checker',
      eyebrow: 'Free tool',
      h1: 'Screenshot size checker',
      lede:
        'Drop your store screenshots to see, for each file, its size, whether it matches a store size mockup.best exports, whether Google Play will accept its proportions, and whether it has an alpha channel — the stores reject screenshots with transparency.',
      cta: { label: 'Rebuild them at the right size', href: '/editor/?start=app-store' },
      privacy: 'Files are read by your browser on this page. Nothing is uploaded.',
      steps: [
        { title: 'Drop files', body: 'PNG or JPG screenshots — as many as you like.' },
        { title: 'Read the result', body: 'Exact match, same proportions, Google Play rule and alpha channel, per file.' },
        { title: 'Fix', body: 'Rebuild any that fail with the App Store set in the editor — it exports every size without alpha.' },
      ],
      gets: {
        h2: 'What it checks',
        items: [
          'Exact size against the App Store and Google Play sizes mockup.best exports',
          'Same proportions (it would scale cleanly to that size)',
          'Google Play: each side 320–3840 px, long side at most twice the short side',
          'Alpha channel in PNG files',
        ],
      },
      faq: [
        { q: 'Why does the alpha channel matter?', a: 'App Store Connect rejects screenshots that contain transparency, and Google Play asks for images without alpha. A PNG saved with an alpha channel can fail even when it looks opaque.' },
        { q: 'Does it list every size Apple accepts?', a: 'No — it checks the sizes mockup.best exports. Apple accepts more per device class; see the guide for the full list.' },
        { q: 'Are my files uploaded?', a: 'No. The check runs in your browser.' },
      ],
      related: [
        { href: USE_PATHS['app-store'].en, label: 'App Store screenshot generator' },
        { href: `${G('en')}app-store-screenshot-sizes.html`, label: 'Guide: App Store screenshot sizes' },
        { href: `${G('en')}google-play-screenshot-sizes.html`, label: 'Guide: Google Play screenshot sizes' },
        { href: `${G('en')}export-png-jpg-webp.html`, label: 'Guide: PNG, JPG or WebP' },
      ],
    },
  },
  tr: {
    'app-store': {
      id: 'app-store',
      lang: 'tr',
      path: USE_PATHS['app-store'].tr,
      meta: {
        title: 'App Store Ekran Görüntüsü Oluşturucu — ücretsiz, tüm ölçüler tek ZIP | mockup.best',
        description:
          'Uygulamanın ekran görüntülerini App Store ve Google Play görsellerine çevir: 3B cihazın üstünde başlık, marka rengin, gereken bütün ölçüler tek ZIP’te. Ücretsiz, hesap yok, hiçbir şey yüklenmez.',
        og: '/uses/app-store-og.jpg',
        ogAlt: 'mockup.best ile yapılmış, her birinde telefonun üstünde başlık olan üç App Store görseli',
      },
      crumb: 'App Store ekran görüntüsü oluşturucu',
      eyebrow: 'Mağaza seti',
      h1: 'App Store ekran görüntüsü oluşturucu',
      lede:
        'Uygulamandan en fazla beş ekran görüntüsü bırak, her birine bir başlık yaz, marka rengini seç — bütün App Store ve Google Play ölçülerini tek ZIP’te indir. Her görsel normal bir sahne; cihazı, açıyı, yazıyı, zemini sonra da değiştirebilirsin.',
      cta: { label: 'App Store seti başlat', href: '/editor/?start=app-store' },
      privacy: 'Tarayıcında çalışır. Ekran görüntülerin yüklenmez.',
      steps: [
        { title: 'Ekranları bırak', body: 'En fazla beş. screen-1.png, screen-2.png … adlı dosyalar bu sırayla yerleşir.' },
        { title: 'Başlıkları yaz', body: 'Her görsele kısa bir satır ve zemin için tek bir marka rengi.' },
        { title: 'Mağaza setini indir', body: 'Export → Image → Store set: her sahne, her App Store ve Google Play ölçüsünde, klasörlerle.' },
      ],
      gets: {
        h2: 'Ne alırsın',
        items: [
          'Mağaza ve ölçü başına klasörlü tek ZIP, dosyalar sahne sırasıyla numaralı',
          'Alfa kanalsız PNG veya JPG — mağazalar şeffaf ekran görüntüsünü reddediyor',
          'Adlı ekranlar: uygulama değişince yeni görüntüleri Update screens’e bırak, bütün sahneler bir seferde yenilensin',
        ],
      },
      faq: [
        { q: 'Ücretsiz mi?', a: 'Evet. Her özellik ücretsiz; sınırsız export, hesap yok, filigran yok.' },
        {
          q: 'Mağaza setinde hangi ölçüler var?',
          a: 'Bu sayfada listelenenler: App Store iPhone, iPad ve Mac ekran görüntüsü ölçüleri ile Google Play telefon, tablet ve öne çıkan görsel. Apple her cihaz sınıfı için başka ölçüler de kabul ediyor; aşağıdaki rehberde tam liste var.',
        },
        { q: 'Görseli kurduktan sonra değiştirebilir miyim?', a: 'Evet. Her görsel editörde bir sahne: cihazı, kamera açısını, başlığı, yazı tipini ya da zemini değiştirip yeniden indir.' },
        { q: 'Ekran görüntülerim bir yere yükleniyor mu?', a: 'Hayır. mockup.best tarayıcında WebGL ile çiziyor; dosyalar cihazında kalıyor.' },
      ],
      related: [
        { href: USE_PATHS.checker.tr, label: 'Ekran görüntüsü boyut kontrolü' },
        { href: `${G('tr')}app-store-screenshot-sizes.html`, label: 'Rehber: App Store ekran görüntüsü ölçüleri' },
        { href: `${G('tr')}google-play-screenshot-sizes.html`, label: 'Rehber: Google Play ekran görüntüsü ölçüleri' },
        { href: `${G('tr')}screenshot-captions.html`, label: 'Rehber: ekran görüntüsü başlıkları' },
      ],
    },
    promo: {
      id: 'promo',
      lang: 'tr',
      path: USE_PATHS.promo.tr,
      meta: {
        title: 'Uygulama Tanıtım Videosu — ekran görüntülerinden ücretsiz | mockup.best',
        description:
          'Ekran görüntülerinden 10–20 saniyelik uygulama tanıtım videosu: ana ekran açıp kapatıyor, her özellik kendi kamera hareketi ve altyazısıyla. 4K 60 fps’e kadar MP4. Ücretsiz, tarayıcında.',
        og: '/uses/promo-og.jpg',
        ogAlt: 'mockup.best tanıtım videosundan bir telefon mockup karesi',
      },
      crumb: 'Uygulama tanıtım videosu',
      eyebrow: 'Özellik duyurusu',
      h1: 'Uygulama tanıtım videosu',
      lede:
        'Ana ekranını ve en fazla üç özellik ekranını ver; hazır bir tanıtım çıksın: ana ekran videoyu açıp kapatıyor, her özellik kendi kamera hareketi ve kısa altyazısıyla geliyor, uygulamanın adı kapanışta. Her sahne zaman çizelgesinde düzenlenebilir kalıyor.',
      cta: { label: 'Tanıtım videosu yap', href: '/editor/?start=feature-launch' },
      privacy: 'Tarayıcında çalışır. Ekran görüntülerin ve kayıtların yüklenmez.',
      steps: [
        { title: 'Ekranları bırak', body: 'Bir ana ekran, sonra en fazla üç özellik. Tek ekran 8 sn, dört ekran 20 sn’lik video verir.' },
        { title: 'Altyazı ekle', body: 'Her özelliğe en fazla dört kelime ve uygulama adıyla bir kapanış satırı.' },
        { title: 'Videoyu indir', body: 'Export → Video → MP4. İstersen önce müzik ekle — dosyaya karışıyor.' },
      ],
      gets: {
        h2: 'Ne alırsın',
        items: [
          '3840 × 2160’a kadar, 30 veya 60 fps MP4 (H.264), kare kare çizilmiş',
          'İsteğe bağlı: 16:9, 9:16, 1:1 ve 4:5 sürümleri tek ZIP’te — kamera her orana yeniden oturuyor',
          'Normal bir proje: herhangi bir ekranı ekran kaydıyla değiştir, zamanlamayı oynat, yazı ekle',
        ],
      },
      notes: {
        h2: 'Bilmekte fayda var',
        items: [
          'Video 16:9 için kuruldu. Dikey ve kare sürümlerde altyazıların cihaza binmediğini kontrol et.',
          'App Store önizlemelerinin kendi ölçüleri var (kadraj menüsünde) ve Apple uygulamanın kullanılırken gösterilmesini bekliyor.',
        ],
      },
      faq: [
        { q: 'Video kaç saniye?', a: 'Yalnız ana ekranla 8 saniye, üç özellikle 20 saniyeye kadar. Sahne sürelerini sonra değiştirebilirsin.' },
        { q: 'Ekran kaydı kullanabilir miyim?', a: 'Paket ekran görüntülerinden başlıyor. Sonra herhangi bir sahneye ekran kaydı koyabilirsin; hız ve kırpma Source panelinde.' },
        { q: 'Müzik ekleyebilir miyim?', a: 'Evet. Ses dosyasını zaman çizelgesine bırak; önizlemede çalar, MP4’e karışır.' },
        { q: 'Filigran var mı?', a: 'Hayır. Export’lar ücretsiz, sınırsız ve işaretsiz.' },
      ],
      related: [
        { href: `${G('tr')}20-second-promo-anatomy.html`, label: 'Rehber: 20 saniyelik tanıtım nasıl kurulur' },
        { href: `${G('tr')}app-preview-video-specs.html`, label: 'Rehber: App Store önizleme videosu ölçüleri' },
        { href: `${G('tr')}play-store-promo-video.html`, label: 'Rehber: Play Store tanıtım videosu' },
        { href: USE_PATHS['app-store'].tr, label: 'App Store ekran görüntüsü oluşturucu' },
      ],
    },
    portfolio: {
      id: 'portfolio',
      lang: 'tr',
      path: USE_PATHS.portfolio.tr,
      meta: {
        title: 'Portföy Mockup Oluşturucu — Dribbble için laptop + telefon | mockup.best',
        description:
          'Web veya uygulama projeni 3B laptop ve telefonda göster: masaüstü, mobil ve ikisi birlikte; Dribbble, Behance ya da vaka çalışması için 4:3 görseller ve kısa video. Ücretsiz, tarayıcında.',
        og: '/uses/portfolio-og.jpg',
        ogAlt: 'mockup.best ile yapılmış, aynı ürünü gösteren laptop ve telefon mockup’ı',
      },
      crumb: 'Portföy mockup oluşturucu',
      eyebrow: 'Portföy sunumu',
      h1: 'Portföy mockup oluşturucu',
      lede:
        'Bir masaüstü ekran görüntüsü ve varsa bir mobil ekran bırak. Üç sahne çıksın — laptopta masaüstü, telefonda mobil ve ikisi birlikte — proje başlığınla, 4:3 görseller ve kısa bir video olarak.',
      cta: { label: 'Portföy seti kur', href: '/editor/?start=portfolio' },
      privacy: 'Tarayıcında çalışır. Müşteri işi cihazından çıkmaz.',
      steps: [
        { title: 'Ekranları bırak', body: 'Bir masaüstü ekran görüntüsü; telefon ve ikili sahne için isteğe bağlı bir mobil ekran.' },
        { title: 'Başlık ve renk', body: 'Proje başlığı, tek satır açıklama ve bir zemin rengi.' },
        { title: 'İndir', body: 'Bir sahne seç, Export → Image (Dribbble için 1600 × 1200) ya da bütün set için Export → Video.' },
      ],
      gets: {
        h2: 'Ne alırsın',
        items: [
          'Yavaş kamera hareketli üç sahne; durağan görsel ya da tek kısa video',
          'Geçebileceğin 13 cihaz — laptoplar, telefonlar, tablet, saat, ekranlar — cam veya metal kaplama',
          'Zemini kapatırsan PNG ve WebP şeffaflığı koruyor',
        ],
      },
      faq: [
        { q: 'Dribbble için hangi ölçü?', a: 'Dribbble çekimleri 4:3; paket 4:3 kadraj kuruyor, 1600 × 1200 ya da daha büyük indir.' },
        { q: 'Üçüncü bir cihaz ekleyebilir miyim?', a: 'Evet. Dizilimler (Pair, Trio, Fan, Stack, Row) ana cihazın çevresine cihaz ekliyor; her biri kendi ekranını gösterebilir.' },
        { q: 'Müşteri işi için güvenli mi?', a: 'Hiçbir şey yüklenmiyor. Ekran görüntüsünde gerçek veri varsa paylaşmadan önce Hide private info’yu kullan.' },
      ],
      related: [
        { href: `${G('tr')}macbook-mockup.html`, label: 'Rehber: MacBook mockup’ları' },
        { href: `${G('tr')}website-hero-mockup.html`, label: 'Rehber: web sitesi girişinde mockup' },
        { href: USE_PATHS.redact.tr, label: 'Ekran görüntüsünde bilgi gizleme' },
        { href: USE_PATHS.templates.tr, label: 'Mockup şablonları' },
      ],
    },
    redact: {
      id: 'redact',
      lang: 'tr',
      path: USE_PATHS.redact.tr,
      meta: {
        title: 'Ekran Görüntüsünde Bilgi Gizleme — sil, bulanıklaştır, pikselleştir | mockup.best',
        description:
          'Paylaşmadan önce ekran görüntüsündeki e-posta, isim, bakiye gibi özel bilgileri kapat: silgi, bant, pikselleştirme ya da bulanıklık, görüntüye kalıcı işlenir. Tarayıcında çalışır — görüntü yüklenmez.',
        og: '/uses/redact-og.jpg',
        ogAlt: 'E-postası ve bakiyesi silinmeden önce ve sonra bir telefon ekran görüntüsü',
      },
      crumb: 'Ekran görüntüsünde bilgi gizleme',
      eyebrow: 'Hide private info',
      h1: 'Ekran görüntüsünde bilgi gizleme',
      lede:
        'Bir e-postanın, müşteri adının ya da bakiyenin üstüne kutu çiz ve nasıl kapatılacağını seç. Alan görüntüye işleniyor; temizlenmiş kopya o görüntüyü kullanan her sahnede orijinalin yerine geçiyor — mockup’larına, export’larına ya da paylaşım linklerine özel bir şey sızmıyor.',
      cta: { label: 'Editörü aç', href: '/editor/?tool=redact' },
      privacy: 'Ekran görüntün tarayıcında işlenir, yüklenmez.',
      steps: [
        { title: 'Ekran görüntüsü yükle', body: 'Editöre bırak; 3B cihazın ekranına yerleşir.' },
        { title: 'Bilgileri işaretle', body: 'Source → Hide private info. Her bilginin üstünden sürükle; Erase, Bar, Pixelate ya da Blur seç.' },
        { title: 'Uygula ve paylaş', body: 'Temiz görüntü her yerde orijinalin yerine geçer. Her zamanki gibi indir ya da paylaş.' },
      ],
      gets: {
        h2: 'Dört kapatma yolu',
        items: [
          'Erase (silgi) — alanı çevresinin rengiyle doldurur, yazı hiç yokmuş gibi (opak)',
          'Bar (bant) — düz renkli blok (opak)',
          'Pixelate — iri bloklar; yazı okunmaz hâle gelir',
          'Blur — iki geçişli güçlü bulanıklık',
        ],
      },
      notes: {
        h2: 'Bilmekte fayda var',
        items: [
          'Erase ve Bar geri kazanılacak piksel bırakmaz. Şifre ya da kart numarası için bu ikisinden birini kullan.',
          'Orijinal yalnız açık sekmenin belleğinde, geri alabilmen için kalır. Asla kaydedilmez, indirilmez, paylaşılmaz.',
          'Ekranın yeni sürümünü bıraktığında (Update screens) aynı alanlar yeniden kapatılır.',
          'Şimdilik yalnız görüntüler — ekran kayıtları değil.',
        ],
      },
      faq: [
        { q: 'Kapatma kalıcı mı?', a: 'Evet; indirdiğin, kaydettiğin ya da paylaştığın her şeyde. Orijinali yalnız açık sekme, geri alma için tutar.' },
        { q: 'Bulanık alan geri getirilebilir mi?', a: 'Blur ve Pixelate güçlü ayarla çalışıyor ama rengin bir kısmı kalıyor. Kritik bir şey için Erase ya da Bar kullan — geride bir şey bırakmazlar.' },
        { q: 'Ekran görüntüm yükleniyor mu?', a: 'Hayır. Her şey tarayıcında oluyor.' },
      ],
      related: [
        { href: USE_PATHS['app-store'].tr, label: 'App Store ekran görüntüsü oluşturucu' },
        { href: USE_PATHS.portfolio.tr, label: 'Portföy mockup oluşturucu' },
        { href: `${G('tr')}mockup-copyright.html`, label: 'Rehber: cihaz mockup’ları ve hukuki sorular' },
      ],
    },
    templates: {
      id: 'templates',
      lang: 'tr',
      path: USE_PATHS.templates.tr,
      meta: {
        title: 'Cihaz Mockup Şablonları — ücretsiz 12 hazır 3B görünüm | mockup.best',
        description:
          'On iki hazır 3B cihaz mockup görünümü — stüdyo cam, App Store çekimi, masa kurulumu, bilek yakın planı, sinematik açılar. Her önizleme gerçek render; birini aç, ekran görüntünü koy, indir. Ücretsiz.',
        og: '/uses/templates-og.jpg',
        ogAlt: 'mockup.best cihaz mockup şablonlarından bir ızgara',
      },
      crumb: 'Mockup şablonları',
      eyebrow: 'Şablonlar',
      h1: 'Cihaz mockup şablonları',
      lede:
        'Başlamak için on iki görünüm: cihaz, açı, ışık, zemin ve kaplama birlikte ayarlı. Aşağıdaki her önizleme o şablonun mockup.best’teki gerçek çizimi. Birini aç, ekran görüntünü koy, istediğini değiştir.',
      cta: { label: 'Editörü aç', href: '/editor/' },
      privacy: 'Ücretsiz, hesap yok. Ekran görüntülerin cihazında kalır.',
      steps: [
        { title: 'Görünüm seç', body: 'Use template editörü o şablon işaretli hâlde açar.' },
        { title: 'Uygula', body: 'Tek tık açık sahneye uygular — Ctrl+Z geri alır.' },
        { title: 'Kendine göre ayarla', body: 'Ekran görüntüsünü, cihazı ya da renkleri değiştir, sonra indir.' },
      ],
      gets: {
        h2: 'Her şablon şunları ayarlar',
        items: ['Cihaz ve kaplama', 'Kamera açısı ve objektif', 'Stüdyo ışığı ve zemin', 'Kendi kurulumlarını editörde şablon olarak saklayabilirsin'],
      },
      faq: [
        { q: 'Şablonlar ücretsiz mi?', a: 'Evet, hepsi; sınırsız export.' },
        { q: 'Şablon projemi değiştirir mi?', a: 'Kendiliğinden değil. Editör şablonu işaretliyor; ancak tıkladığında uygulanıyor ve Ctrl+Z geri alıyor.' },
      ],
      related: [
        { href: USE_PATHS['app-store'].tr, label: 'App Store ekran görüntüsü oluşturucu' },
        { href: `${G('tr')}camera-angles.html`, label: 'Rehber: cihaz mockup’ında kamera açıları' },
        { href: `${G('tr')}mockup-backgrounds.html`, label: 'Rehber: mockup zeminleri' },
      ],
    },
    checker: {
      id: 'checker',
      lang: 'tr',
      path: USE_PATHS.checker.tr,
      meta: {
        title: 'App Store ve Google Play Ekran Görüntüsü Boyut Kontrolü — ücretsiz | mockup.best',
        description:
          'Yüklemeden önce ekran görüntülerini kontrol et: ölçü, en-boy oranı ve alfa kanalı; App Store ve Google Play kurallarına göre. Tarayıcında çalışır — dosyalar yüklenmez.',
        og: '/uses/checker-og.jpg',
        ogAlt: 'Koyu zeminde iki App Store ekran görüntüsü',
      },
      crumb: 'Ekran görüntüsü boyut kontrolü',
      eyebrow: 'Ücretsiz araç',
      h1: 'Ekran görüntüsü boyut kontrolü',
      lede:
        'Mağaza ekran görüntülerini bırak; her dosya için ölçüsünü, mockup.best’in indirdiği bir mağaza ölçüsüne uyup uymadığını, Google Play’in oranını kabul edip etmeyeceğini ve alfa kanalı olup olmadığını gör — mağazalar şeffaflığı olan ekran görüntüsünü reddediyor.',
      cta: { label: 'Doğru ölçüde yeniden kur', href: '/editor/?start=app-store' },
      privacy: 'Dosyaları bu sayfada tarayıcın okur. Hiçbir şey yüklenmez.',
      steps: [
        { title: 'Dosyaları bırak', body: 'PNG veya JPG ekran görüntüleri — istediğin kadar.' },
        { title: 'Sonucu oku', body: 'Dosya başına tam eşleşme, aynı oran, Google Play kuralı ve alfa kanalı.' },
        { title: 'Düzelt', body: 'Geçemeyenleri editördeki App Store setiyle yeniden kur — her ölçüyü alfasız indirir.' },
      ],
      gets: {
        h2: 'Neyi kontrol eder',
        items: [
          'mockup.best’in indirdiği App Store ve Google Play ölçüleriyle tam eşleşme',
          'Aynı oran (o ölçüye temiz ölçeklenir)',
          'Google Play: her kenar 320–3840 px, uzun kenar kısa kenarın en çok iki katı',
          'PNG dosyalarında alfa kanalı',
        ],
      },
      faq: [
        { q: 'Alfa kanalı neden önemli?', a: 'App Store Connect şeffaflık içeren ekran görüntülerini reddediyor, Google Play de alfasız görsel istiyor. Alfa kanalıyla kaydedilmiş bir PNG opak görünse bile takılabilir.' },
        { q: 'Apple’ın kabul ettiği bütün ölçüleri listeliyor mu?', a: 'Hayır — mockup.best’in indirdiği ölçüleri kontrol ediyor. Apple her cihaz sınıfı için daha fazlasını kabul ediyor; tam liste rehberde.' },
        { q: 'Dosyalarım yükleniyor mu?', a: 'Hayır. Kontrol tarayıcında çalışıyor.' },
      ],
      related: [
        { href: USE_PATHS['app-store'].tr, label: 'App Store ekran görüntüsü oluşturucu' },
        { href: `${G('tr')}app-store-screenshot-sizes.html`, label: 'Rehber: App Store ekran görüntüsü ölçüleri' },
        { href: `${G('tr')}google-play-screenshot-sizes.html`, label: 'Rehber: Google Play ekran görüntüsü ölçüleri' },
        { href: `${G('tr')}export-png-jpg-webp.html`, label: 'Rehber: PNG, JPG mi WebP mi' },
      ],
    },
  },
};

/** Template gallery descriptions based on actual settings in config/templates.ts. */
export const TEMPLATE_NOTES: Record<UseLang, Record<string, string>> = {
  en: {
    'hero-glass': 'Glass phone, three-quarter turn, clean studio light',
    'noir-edge': 'Smoke-glass phone at a steep angle on a dark background',
    'store-shot': 'Straight-on glass phone on a soft gradient — made for store screenshots',
    'sunrise-tilt': 'Amber-glass phone tilted into warm dusk light',
    'spectrum-pop': 'Glass phone on a bold color spectrum',
    'desk-setup': 'Silver laptop on a steel background with window light',
    'wrist-close': 'Glass watch, close and angled, soft light',
    'flat-card': 'Your screen as a flat glass card — no device frame',
    'straight-on': 'Frost-glass phone, straight on, on mint',
    'low-drama': 'Black phone from a low angle with hard contrast light',
    'tilt-shift': 'Glass phone over an ocean gradient, steep tilt',
    'violet-glass': 'Glass phone turned left on violet',
  },
  tr: {
    'hero-glass': 'Cam telefon, dörtte üç dönük, temiz stüdyo ışığı',
    'noir-edge': 'Koyu zeminde dik açılı, füme cam telefon',
    'store-shot': 'Yumuşak gradyan üstünde karşıdan cam telefon — mağaza görselleri için',
    'sunrise-tilt': 'Sıcak alacakaranlık ışığına eğik, kehribar cam telefon',
    'spectrum-pop': 'Canlı renk tayfı üstünde cam telefon',
    'desk-setup': 'Pencere ışığında çelik zemin üstünde gümüş laptop',
    'wrist-close': 'Yakın ve açılı cam saat, yumuşak ışık',
    'flat-card': 'Ekranın düz bir cam kart olarak — cihaz çerçevesi yok',
    'straight-on': 'Nane yeşili üstünde karşıdan buzlu cam telefon',
    'low-drama': 'Alçak açıdan, sert kontrast ışıkla siyah telefon',
    'tilt-shift': 'Okyanus gradyanı üstünde dik eğik cam telefon',
    'violet-glass': 'Mor zemin üstünde sola dönük cam telefon',
  },
};

/** Shared UI copy. */
export const USE_UI: Record<UseLang, Record<string, string>> = {
  en: {
    home: 'Home',
    editor: 'Open editor',
    guides: 'Guides',
    how: 'How it works',
    faq: 'Questions',
    related: 'Related',
    more: 'More ways to use mockup.best',
    useTemplate: 'Use template',
    sizes: 'Sizes in the store set',
    exampleNote: 'Made with mockup.best from our own app’s screens.',
    redactNote: 'Example with made-up data.',
    before: 'Before',
    after: 'After',
    privacyLink: 'Privacy',
    terms: 'Terms',
    source: 'Source code',
    contact: 'Contact',
    lang: 'Türkçe',
    meta: 'Free 3D device mockups in your browser',
  },
  tr: {
    home: 'Ana sayfa',
    editor: 'Editörü aç',
    guides: 'Rehberler',
    how: 'Nasıl çalışır',
    faq: 'Sorular',
    related: 'İlgili',
    more: 'mockup.best’i kullanmanın başka yolları',
    useTemplate: 'Şablonu kullan',
    sizes: 'Mağaza setindeki ölçüler',
    exampleNote: 'Kendi uygulamamızın ekranlarıyla, mockup.best’te yapıldı.',
    redactNote: 'Uydurma verilerle örnek.',
    before: 'Önce',
    after: 'Sonra',
    privacyLink: 'Gizlilik',
    terms: 'Koşullar',
    source: 'Kaynak kod',
    contact: 'İletişim',
    lang: 'English',
    meta: 'Tarayıcında ücretsiz 3B cihaz mockup’ları',
  },
};
