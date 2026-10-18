// gifenc 1.0.3 has no type declarations; this covers the API used here (see node_modules/gifenc/README.md).
declare module 'gifenc' {
  type Format = 'rgb565' | 'rgb444' | 'rgba4444';
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: {
      format?: Format;
      oneBitAlpha?: boolean | number;
      clearAlpha?: boolean;
      clearAlphaThreshold?: number;
      clearAlphaColor?: number;
    },
  ): number[][];
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: number[][], format?: Format): Uint8Array;
  export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: {
        palette?: number[][];
        first?: boolean;
        transparent?: boolean;
        transparentIndex?: number;
        delay?: number;
        repeat?: number;
        dispose?: number;
      },
    ): void;
    finish(): void;
    bytes(): Uint8Array<ArrayBuffer>;
    bytesView(): Uint8Array;
  };
}
