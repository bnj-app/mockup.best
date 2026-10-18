/**
 * Text-layer font catalog: 50 families. All load from Google Fonts only when selected. Loading all
 * 50 upfront would add megabytes and slow startup. Categories reflect user intent, such as bold
 * headlines, rather than requiring font-name knowledge.
 */

export type FontCategory = 'display' | 'sans' | 'serif' | 'mono' | 'script';

export type FontDef = {
  /** Google Fonts family name. */
  family: string;
  category: FontCategory;
  /** Weights to load. */
  weights: number[];
};

export const FONTS: FontDef[] = [
  // --- Display: headlines, covers, attention ---
  { family: 'Anton', category: 'display', weights: [400] },
  { family: 'Bebas Neue', category: 'display', weights: [400] },
  { family: 'Archivo Black', category: 'display', weights: [400] },
  { family: 'Bungee', category: 'display', weights: [400] },
  { family: 'Righteous', category: 'display', weights: [400] },
  { family: 'Alfa Slab One', category: 'display', weights: [400] },
  { family: 'Titan One', category: 'display', weights: [400] },
  { family: 'Bowlby One SC', category: 'display', weights: [400] },
  { family: 'Passion One', category: 'display', weights: [400, 700] },
  { family: 'Fjalla One', category: 'display', weights: [400] },
  { family: 'Staatliches', category: 'display', weights: [400] },
  { family: 'Monoton', category: 'display', weights: [400] },

  // --- Sans: interface, body, clean ---
  { family: 'Inter', category: 'sans', weights: [400, 600, 800] },
  { family: 'Manrope', category: 'sans', weights: [400, 700, 800] },
  { family: 'Poppins', category: 'sans', weights: [400, 600, 800] },
  { family: 'Montserrat', category: 'sans', weights: [400, 700, 900] },
  { family: 'Outfit', category: 'sans', weights: [400, 700, 900] },
  { family: 'Sora', category: 'sans', weights: [400, 700, 800] },
  { family: 'Space Grotesk', category: 'sans', weights: [400, 700] },
  { family: 'DM Sans', category: 'sans', weights: [400, 700] },
  { family: 'Plus Jakarta Sans', category: 'sans', weights: [400, 700, 800] },
  { family: 'Figtree', category: 'sans', weights: [400, 700, 900] },
  { family: 'Urbanist', category: 'sans', weights: [400, 700, 900] },
  { family: 'Work Sans', category: 'sans', weights: [400, 700] },
  { family: 'Rubik', category: 'sans', weights: [400, 700, 900] },
  { family: 'Barlow', category: 'sans', weights: [400, 700] },
  { family: 'Oswald', category: 'sans', weights: [400, 700] },
  { family: 'Lexend', category: 'sans', weights: [400, 700] },
  { family: 'Nunito', category: 'sans', weights: [400, 800] },
  { family: 'Raleway', category: 'sans', weights: [400, 800] },

  // --- Serif: editorial, classic, trust ---
  { family: 'Playfair Display', category: 'serif', weights: [400, 700, 900] },
  { family: 'Instrument Serif', category: 'serif', weights: [400] },
  { family: 'Fraunces', category: 'serif', weights: [400, 700, 900] },
  { family: 'DM Serif Display', category: 'serif', weights: [400] },
  { family: 'Libre Baskerville', category: 'serif', weights: [400, 700] },
  { family: 'Lora', category: 'serif', weights: [400, 700] },
  { family: 'Cormorant Garamond', category: 'serif', weights: [400, 700] },
  { family: 'Bodoni Moda', category: 'serif', weights: [400, 700, 900] },
  { family: 'Merriweather', category: 'serif', weights: [400, 900] },
  { family: 'Spectral', category: 'serif', weights: [400, 700] },

  // --- Mono: technical, code, labels ---
  { family: 'JetBrains Mono', category: 'mono', weights: [400, 700] },
  { family: 'IBM Plex Mono', category: 'mono', weights: [400, 700] },
  { family: 'Space Mono', category: 'mono', weights: [400, 700] },
  { family: 'Roboto Mono', category: 'mono', weights: [400, 700] },
  { family: 'Fira Code', category: 'mono', weights: [400, 700] },
  { family: 'Source Code Pro', category: 'mono', weights: [400, 700] },

  // --- Script: signatures, warmth, handwriting ---
  { family: 'Caveat', category: 'script', weights: [400, 700] },
  { family: 'Pacifico', category: 'script', weights: [400] },
  { family: 'Dancing Script', category: 'script', weights: [400, 700] },
  { family: 'Great Vibes', category: 'script', weights: [400] },
];

export const FONT_CATEGORIES: { id: FontCategory; label: string }[] = [
  { id: 'display', label: 'Display' },
  { id: 'sans', label: 'Sans' },
  { id: 'serif', label: 'Serif' },
  { id: 'mono', label: 'Mono' },
  { id: 'script', label: 'Script' },
];

const loaded = new Set<string>();

/**
 * Load a font on demand and wait until it is usable. document.fonts.load is required: inserting a
 * link does not make a font renderable. Drawing to canvas too early exports the first frame in the
 * fallback font.
 */
/*
  One promise per family waits for Google Fonts CSS. ⚠️ Calling document.fonts.load immediately
  after inserting the link ran before @font-face existed, resolving instantly with an empty list;
  fonts.ready had nothing to await either. The text layer then redrew in fallback and marked itself
  ready. Dirty checking did not redraw when the font arrived, so the 3D preview kept the fallback
  while export, which redraws every frame, used the correct font.
*/
const sheets = new Map<string, Promise<void>>();

export async function ensureFont(family: string): Promise<void> {
  const def = FONTS.find((f) => f.family === family);
  if (!def) return;

  if (!loaded.has(family)) {
    loaded.add(family);
    const href =
      `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}` +
      `:wght@${def.weights.join(';')}&display=swap`;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    sheets.set(
      family,
      new Promise<void>((resolve) => {
        link.onload = () => resolve();
        // Do not block the chain on network failure; continue with the fallback font.
        link.onerror = () => resolve();
      }),
    );
    document.head.appendChild(link);
  }

  await sheets.get(family);
  await Promise.all(
    def.weights.map((w) => document.fonts.load(`${w} 32px "${family}"`).catch(() => null)),
  );
  await document.fonts.ready;
}
