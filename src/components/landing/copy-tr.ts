import type { LandingCopy } from './copy';

/**
 * Turkish landing copy, written directly in Turkish rather than translated, using the same informal
 * tone as the guides. Keep editor labels (Export, Auto-motion, motion and device names) in English
 * to match the UI. Numbers share their source with the English dictionary in copy.ts; update both
 * together.
 */
export const COPY_TR: LandingCopy = {
  lang: 'tr',
  meta: {
    title: 'Ücretsiz 3B Cihaz Mockup’ı ve App Store Videosu | mockup.best',
    description:
      'Ekran görüntünü 3B telefon, laptop ve saate giydir, kamerayı hareket ettir; 4K video, 5K görsel ve App Store / Google Play setleri al. Ücretsiz, hesapsız.',
    ogAlt: 'mockup.best’te yapılmış bir telefon mockup’ı ve “3B cihaz mockup’ları ve mağaza videoları” başlığı.',
  },
  nav: {
    links: [
      { href: '#store', label: 'Mağaza seti' },
      { href: '#camera', label: 'Kamera' },
      { href: '#export', label: 'Export' },
      { href: '#faq', label: 'SSS' },
      { href: '/guide/tr/', label: 'Rehberler' },
    ],
    open: 'Editörü aç',
    resume: 'Projene devam et',
  },
  hero: {
    eyebrow: 'Ücretsiz 3B mockup editörü',
    h1: '3B cihaz mockup’ları ve mağaza videoları, tarayıcında.',
    lede:
      'Ekran görüntünü bırak, telefona, laptopa, tablete ya da saate giydir, kamerayı zaman çizelgesinde oynat; 4K video, 5K görsel ya da App Store ve Google Play’e yüklemeye hazır bir set al.',
    cta: 'Editörü aç',
    secondary: 'Neler çıkardığına bak',
    trust: ['Ücretsiz', 'Hesap yok', 'Filigran yok', 'Dosyaların cihazından çıkmaz'],
    videoLabel: 'Çıktı',
    videoCaption: 'Açılış vitrini — 5 sahne, 20 sn; mockup.best’ten 1920 × 1080 dışa aktarıldı.',
    rulerLabel: 'Sahneler',
  },
  steps: {
    stamp: 'Source → Export',
    h2: 'Ekran görüntüsünden bitmiş dosyaya, tek pencerede.',
    items: [
      { tag: '01 Source', title: 'Ekranı bırak', body: 'PNG, JPG ya da ekran kaydı. Bu tarayıcı sekmesinden dışarı çıkmaz.' },
      { tag: '02 Mockup', title: 'Cihazı seç', body: '13 cihaz, 10 kaplama, 16 arka plan — ya da 12 şablondan biriyle başla.' },
      { tag: '03 Camera', title: 'Kadrajla ya da canlandır', body: 'Sürükleyip kadrajla. Zaman çizelgesine keyframe ekle ya da 10 kamera hareketinden birini uygula.' },
      { tag: '04 Export', title: 'Dosyayı al', body: '5120 px’e kadar görsel, 60 fps’te 4K’ya kadar MP4, şeffaf WebM ya da mağaza seti.' },
    ],
  },
  store: {
    stamp: 'Export · Store kit',
    h2: 'Her mağaza ölçüsü, her sahneden, tek ZIP’te.',
    body:
      'Mağazalar sabit bir ölçü listesi istiyor; ikisi de içinde hiçbir şey saydam olmasa bile alfa kanalı taşıyan PNG’yi reddediyor. mockup.best listeyi biliyor. Ölçüleri tek tek al ya da her sahneyi bütün App Store ve Google Play ölçülerinde tek seferde indir: mağaza ve ölçüye göre klasörler, sahne sırasına göre numaralı dosyalar, alfa kanalı yok.',
    sizesLabel: 'Görsel ölçüleri',
    sizes: [
      { label: 'App Store · iPhone 6.9″', value: '1290 × 2796' },
      { label: 'App Store · iPad 13″', value: '2064 × 2752' },
      { label: 'App Store · Mac', value: '2880 × 1800' },
      { label: 'Google Play · Telefon', value: '1080 × 1920' },
      { label: 'Google Play · Tablet', value: '1440 × 2560' },
      { label: 'Google Play · Öne çıkan görsel', value: '1024 × 500' },
    ],
    previewTitle: 'Yüklemeden geçen App Store önizleme videoları',
    previewBody:
      'Güncel iPhone’lar için 886 × 1920, iPad için 1200 × 1600; 30 fps’e kilitli, H.264 ve stereo AAC ses izi. Projende ses yoksa sessiz bir iz ekleniyor — ses izi olmayan önizlemeler yüklemede sıkça reddediliyor. 15–30 saniye dışındaki projeler için export’tan önce uyarı çıkıyor.',
    zipLabel: 'ZIP’in içinde ne var',
    imageAlt: 'Demo projesinin her sahnesinden birer tane, mockup.best’ten dışa aktarılmış beş Google Play telefon görseli.',
    imageCaption: 'Beş sahne, Google Play telefon ölçüsü, doğrudan mağaza setinden.',
  },
  camera: {
    stamp: 'Camera',
    h2: 'Şablon doldurmuyorsun, kamerayı yönetiyorsun.',
    body:
      'Kamera açısı, zoom, görüş açısı, bulanıklık ve ışık keyframe taşıyabiliyor; her birinin kendi yumuşatma eğrisi var. Sahneler kesme, geçiş ya da kaydırmayla art arda oynuyor, ses izin export’a karışıyor.',
    movesLabel: '10 kamera hareketi',
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
      { title: 'Auto-motion', body: 'Ekranda odak alanları çiz; Auto-motion aralarında bir kamera yolu çözüp sana düzenlenebilir keyframe’ler olarak veriyor.' },
      { title: 'Lens blur', body: 'Sahnenin gerçek derinliğinden alan derinliği. Odak noktasına keyframe koyarak odak kaydırma yap.' },
      { title: 'Cihazın arkasında yazı', body: 'Başlıklar telefonun arkasında durabiliyor; kelime kelime, vuruş ve döngü animasyonlarıyla.' },
    ],
    imageAlt: 'Beş sahne, keyframe’ler ve oynatma çizgisiyle mockup.best zaman çizelgesi.',
    imageCaption: 'Zaman çizelgesi: sahneler, özellik başına keyframe’ler, geçişler.',
  },
  mockup: {
    stamp: 'Mockup · Scene',
    h2: 'Nesne gibi okunan cihazlar, ürün fotoğrafı gibi ışık.',
    body:
      'Donanım çizilmiyor, modelleniyor: gerçek pahlar, tuşlar ve kamera çıkıntıları görüntü tabanlı stüdyo ışığını yakalıyor. Ekran senin ekranın olarak kalıyor — renkleri sadık, üstelik cihazı ve zemini aydınlatabiliyor.',
    rows: [
      { label: 'Cihazlar', value: '13', note: 'Phone, Phone Max, Phone Slim, Android, Android Ultra, Tablet, Watch, Laptop, Laptop 16″, Laptop Slim 13″, Display, Display 27″, Flat' },
      { label: 'Kaplamalar', value: '10', note: 'Cam: Crystal, Smoke, Amber, Frost · Metal: Black, Silver, Titanium, White · Mat: Clay, Clay Dark' },
      { label: 'Dizilimler', value: '6', note: 'Single, Pair, Trio, Fan, Stack, Row' },
      { label: 'Arka planlar', value: '16', note: 'artı kendi görselin, özel gradyan ya da iki 3B zemin' },
      { label: 'Efektler', value: '18', note: 'Bloom, flare, liquid glass, fish eye, ghost, screen fade, gren, vinyet ve ton ayarları' },
      { label: 'Laptop ekranı', value: '3', note: 'Ekranının etrafına menü çubuğu, dock ve tarayıcı çerçevesi' },
    ],
    imageAlt: 'mockup.best cihazlarından bir sıra: iki telefon, tablet, laptop ve saat.',
    imageCaption: 'Cihaz yelpazesinin bir kısmı, mockup.best’te render edildi.',
  },
  exportSec: {
    stamp: 'Export',
    h2: 'Ne çıkıyor.',
    body:
      'MP4 video kare kare render ediliyor; yavaş bir makinede daha uzun sürüyor ama kare atlamıyor. Her kare, kamera piksel altında kaydırılarak sekiz kez çiziliyor ve ortalanıyor; kamera hareket ederken ince kenarlar titremiyor.',
    head: ['Çıktı', 'Biçim', 'Sınırlar'],
    rows: [
      ['Görsel', 'PNG, JPG, WebP', '5120 px’e kadar · PNG ve WebP saydamlığı korur'],
      ['Video', 'MP4 (H.264)', '3840 × 2160’a kadar · 30 ya da 60 fps'],
      ['Şeffaf video', 'WebM (alfalı VP8)', 'düzenleyicilere ve web sayfalarına arka plansız düşer'],
      ['Kenar kalitesi', 'Piksel başına 8 jitter örneği', 'High kalitede daha fazlası; High iki kat boyutta da çiziyor'],
      ['Hareket bulanıklığı', 'Kapalı, düşük, orta, yüksek', 'render sırasında uygulanır'],
      ['Ses', 'Kendi parçaların, çevrimdışı karıştırılır', 'MP4 içinde AAC'],
      ['Mağaza ölçüleri', 'App Store ve Google Play', 'alfa kanalsız PNG'],
      ['Mağaza seti', 'Her sahne × her mağaza ölçüsü', 'tek ZIP'],
    ],
    alphaAlt: 'Şeffaf arka planla dışa aktarılmış bir telefon, dama zemin üstünde.',
    alphaCaption: 'Dama zemin üstünde şeffaf PNG: arka plan gömülü değil.',
  },
  free: {
    stamp: 'Price',
    h2: 'Ücretsiz, hiçbir şey kısılmadan.',
    body:
      'Bugün her özellik ücretsiz: sınırsız export, filigran yok, hesap yok. Bir gün ücretli plan gelirse, neyin değişeceğini kullanım koşulları sayfası önceden söyleyecek.',
    points: ['Sınırsız export', '4K video ve 5K görsel', 'Şeffaf video', 'Dışa aktardığın her şeyin hakkı sende'],
  },
  compare: {
    stamp: 'Compared',
    h2: 'Diğerleriyle karşılaştırma.',
    note: 'Her ürünün kendi fiyat sayfasından 8 Ekim 2026’da okundu; adlar bilerek yazılmadı. “—” sayfanın bu konuda bir şey söylemediği anlamına geliyor.',
    head: ['', 'mockup.best', 'Popüler tarayıcı editörü (ücretsiz plan)', 'Popüler Mac uygulaması'],
    rows: [
      ['Fiyat', 'Ücretsiz', 'Ücretsiz; ücretli plan aylık 20 $ ya da yıllık 120 $', 'Tek seferlik satın alma, üç seviye'],
      ['Çalıştığı yer', 'Tarayıcı', 'Tarayıcı', 'macOS 11+ uygulaması'],
      ['Export', 'Sınırsız', '24 saatte 3', '—'],
      ['Filigran', 'Yok', 'Var', '—'],
      ['En büyük görsel', '5120 px', '1920 px', 'Seviyeye göre 8K’ya kadar'],
      ['Video', '60 fps’te 4K’ya kadar', '720p, 30 fps', 'Seviyeye göre 8K’ya kadar'],
      ['Şeffaf video', 'Var (WebM)', 'Yok', '—'],
      ['Cihaz modeli', '13', '18’den 2’si', '30+'],
    ],
    /* Brand names are omitted; sources are in the compare comment in copy.ts. */
    sources: [],
  },
  faq: {
    stamp: 'FAQ',
    h2: 'En çok sorulanlar.',
    items: [
      {
        q: 'mockup.best gerçekten ücretsiz mi?',
        a: 'Evet. 4K video, 5K görsel ve şeffaf video dahil her özellik ücretsiz. Hesap, export sınırı ya da filigran yok.',
      },
      {
        q: 'Ekran görüntülerim bir yere yükleniyor mu?',
        a: 'Hayır. mockup.best tarayıcında WebGL ile render ediyor; görsellerin ve kayıtların cihazından çıkmıyor. Paylaşım linki sahne ayarlarını taşıyor, görsellerini değil.',
      },
      {
        q: 'App Store için hangi ölçülerde export alıyor?',
        a: 'Ekran görüntüleri: iPhone 6.9″ 1290 × 2796, iPad 13″ 2064 × 2752 ve Mac 2880 × 1800. Önizleme videoları: iPhone için 886 × 1920, iPad için 1200 × 1600, Mac ve Apple TV için 1920 × 1080; 30 fps ve stereo AAC ses iziyle.',
      },
      {
        q: 'Google Play için?',
        a: 'Telefon 1080 × 1920, tablet 1440 × 2560 ve 1024 × 500 öne çıkan görsel (feature graphic); alfa kanalsız PNG ya da JPG olarak. 1290 × 2796 Play için sunulmuyor, çünkü Play uzun kenarı kısa kenarın iki katından fazla olan görselleri reddediyor.',
      },
      {
        q: 'Şeffaf arka planlı mockup videosu alabilir miyim?',
        a: 'Evet, alfa kanallı WebM olarak; After Effects, Premiere, Figma ya da bir web sayfası için. MP4 saydamlık taşıyamaz, bu yüzden App Store önizlemelerinin her zaman bir arka planı olur.',
      },
      {
        q: 'Kamerayı canlandırabilir miyim?',
        a: 'Evet. Açı, zoom, görüş açısı, bulanıklık ve ışık için zaman çizelgesinde keyframe koy, 10 kamera hareketinden birini uygula ya da Auto-motion’ın ekranda işaretlediğin alanlar arasında yol kurmasına izin ver.',
      },
      {
        q: 'Hangi tarayıcıyı kullanmalıyım?',
        a: 'mockup.best masaüstünde Chrome ve Edge’de geliştirilip test ediliyor. WebGL 2 gerekiyor, video export WebCodecs kullanıyor. Kadrajlama ve görsel export telefonda da çalışıyor; zaman çizelgesi masaüstü boyutunda bir ekran istiyor.',
      },
      {
        q: 'Çıktıları ticari olarak kullanabilir miyim?',
        a: 'Evet. İçeri aldığın ve dışa aktardığın her şeyin hakkı sende; mockup.best hiçbir sahiplik ya da lisans iddia etmiyor. İçine koyduğun ekranları kullanma hakkına sahip olmak senin sorumluluğunda.',
      },
    ],
  },
  guides: {
    stamp: 'Guides',
    h2: 'Mağaza görselleri ve mockup videosu için rehberler.',
    body: 'Ölçüler, kadraj, ışık ve hareket üzerine otuz kısa rehber, on bir dilde.',
    items: [
      { slug: 'app-store-screenshot-sizes', title: 'App Store ekran görüntüsü ölçüleri, tablo ezberlemeden' },
      { slug: 'google-play-screenshot-sizes', title: 'Google Play ekran görüntüsü ölçüleri ve mağaza görselleri' },
      { slug: 'first-screenshot', title: 'İşin çoğunu ilk ekran görüntün yapıyor' },
      { slug: '20-second-promo-anatomy', title: '20 saniyelik tanıtım gerçekte nasıl kuruluyor' },
      { slug: 'camera-angles', title: 'Kamera açıları: neredeyse her işi gören beş kadraj' },
      { slug: 'lighting-and-shadows', title: 'Cihaz mockup’ını nesne gibi göstermek için ışık' },
      { slug: 'transparent-background-mockups', title: 'Şeffaf mockup: mağazalar dışında her yerde faydalı' },
      { slug: 'website-hero-mockup', title: 'Açılış sayfası kapağında mockup kullanmak' },
    ],
    all: 'Tüm rehberler',
  },
  final: {
    h2: 'Aç ve bir ekran görüntüsü bırak.',
    body: 'Kurulacak bir şey yok, üye olunacak bir yer yok. En iyi masaüstünde Chrome ya da Edge’de çalışır.',
    cta: 'Editörü aç',
  },
  footer: {
    meta: '3B cihaz mockup’ları ve uygulama videoları için tarayıcı aracı',
    privacy: 'Gizlilik',
    terms: 'Koşullar',
    guides: 'Rehberler',
    contact: 'İletişim',
    langSwitch: { href: '/', label: 'English' },
  },
  guideBase: '/guide/tr/',
};
