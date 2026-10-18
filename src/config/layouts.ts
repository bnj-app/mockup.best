/**
 * Multi-device layouts. Offsets use the main device's width rather than centimeters so spacing works
 * for phones and laptops alike. Fixed centimeters would make watches overlap and leave huge gaps
 * between laptops.
 */

export type LayoutSlot = {
  x: number;
  y: number;
  z: number;
  rotY: number;
  scale: number;
};

export type Layout = {
  id: string;
  label: string;
  /** Main device placement; layouts can offset it too. */
  main: LayoutSlot;
  slots: LayoutSlot[];
};

const M: LayoutSlot = { x: 0, y: 0, z: 0, rotY: 0, scale: 1 };

export const LAYOUTS: Layout[] = [
  { id: 'single', label: 'Single', main: M, slots: [] },
  {
    id: 'pair',
    label: 'Pair',
    // The front device is closer and larger; the rear one is farther and smaller to convey depth.
    main: { x: -0.35, y: 0, z: 0.35, rotY: 8, scale: 1 },
    slots: [{ x: 0.6, y: 0.06, z: -0.4, rotY: -10, scale: 0.94 }],
  },
  {
    id: 'trio',
    label: 'Trio',
    main: { x: 0, y: 0, z: 0.5, rotY: 0, scale: 1 },
    // At ±1.05 the side devices overlapped the center: moving the center forward
    // makes it larger in perspective and consumes the gap.
    slots: [
      { x: -1.22, y: 0.04, z: -0.35, rotY: 16, scale: 0.9 },
      { x: 1.22, y: 0.04, z: -0.35, rotY: -16, scale: 0.9 },
    ],
  },
  {
    id: 'fan',
    label: 'Fan',
    main: { x: 0, y: 0, z: 0.6, rotY: 0, scale: 1 },
    slots: [
      { x: -0.85, y: -0.05, z: -0.1, rotY: 22, scale: 0.92 },
      { x: 0.85, y: -0.05, z: -0.1, rotY: -22, scale: 0.92 },
      { x: -1.6, y: -0.12, z: -0.8, rotY: 34, scale: 0.82 },
      { x: 1.6, y: -0.12, z: -0.8, rotY: -34, scale: 0.82 },
    ],
  },
  {
    id: 'stack',
    label: 'Stack',
    // Staggered stack for presenting an app flow.
    main: { x: -0.3, y: 0.18, z: 0.6, rotY: 6, scale: 1 },
    slots: [
      { x: 0.05, y: 0, z: 0.2, rotY: 6, scale: 0.97 },
      { x: 0.4, y: -0.18, z: -0.2, rotY: 6, scale: 0.94 },
    ],
  },
  {
    id: 'row',
    label: 'Row',
    main: { x: -1.15, y: 0, z: 0, rotY: 0, scale: 1 },
    slots: [
      { x: 0, y: 0, z: 0, rotY: 0, scale: 1 },
      { x: 1.15, y: 0, z: 0, rotY: 0, scale: 1 },
    ],
  },
];

export function getLayout(id: string): Layout {
  return LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0];
}
