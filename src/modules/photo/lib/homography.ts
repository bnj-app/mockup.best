/**
 * Four corners -> CSS matrix3d.

 * Why: a photographed phone is in perspective, so its screen corners do not
 * form a rectangle. A 2D canvas affine transform (setTransform) preserves
 * parallel sides and cannot represent this quadrilateral's unequal opposite
 * edges. CSS matrix3d supports a full homography (m14/m24 perspective terms),
 * making the preview correct without extra rendering work.

 * Store normalized corners (0..1) in the manifest, not matrix3d: translation
 * terms are in pixels and depend on render size. Deriving the matrix at render
 * time preserves the result at 1x/2x/4x export.
 */

export type Pt = { x: number; y: number };
export type Quad = [Pt, Pt, Pt, Pt]; // Order: top-left, top-right, bottom-right, bottom-left.

/**
 * Solve the 3x3 homography mapping the src quadrilateral onto dst.
 * Fix h[8] = 1 and solve the other eight unknowns with 8x8 Gaussian elimination.
 */
export function solveHomography(src: Quad, dst: Quad): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: X, y: Y } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
    b.push(Y);
  }
  const h = gauss(A, b);
  return [...h, 1];
}

function gauss(A: number[][], b: number[]): number[] {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    // Partial pivoting: a near-zero pivot makes the solution unstable.
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    }
    if (Math.abs(m[piv][col]) < 1e-12) throw new Error('Singular matrix: corners are degenerate');
    [m[col], m[piv]] = [m[piv], m[col]];
    const p = m[col][col];
    for (let c = col; c <= n; c++) m[col][c] /= p;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      if (!f) continue;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row) => row[n]);
}

/**
 * Build CSS placement from container-relative normalized corners (0..1).

 * Derive the box from average quadrilateral edge lengths so content is not
 * squashed before warping. The box approximates the screen's aspect ratio;
 * the homography adds only perspective.
 */
export function quadToCss(quad01: Quad, containerPx: number) {
  const q = quad01.map((p) => ({ x: p.x * containerPx, y: p.y * containerPx })) as Quad;
  const [tl, tr, br, bl] = q;

  const len = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
  const w = (len(tl, tr) + len(bl, br)) / 2;
  const h = (len(tl, bl) + len(tr, br)) / 2;

  // Place the box at the top-left. With transform-origin 0 0,
  // the homography maps box coordinates directly onto the quadrilateral.
  const box: Quad = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  const dst = q.map((p) => ({ x: p.x - tl.x, y: p.y - tl.y })) as Quad;
  const H = solveHomography(box, dst);

  // 3x3 homography -> 4x4 CSS matrix (column-major).
  const [a, bb, c, d, e, f, g, hh] = H;
  const m = [a, d, 0, g, bb, e, 0, hh, 0, 0, 1, 0, c, f, 0, 1];

  return {
    left: tl.x,
    top: tl.y,
    width: w,
    height: h,
    matrix3d: `matrix3d(${m.map((v) => round(v)).join(', ')})`,
  };
}

function round(v: number) {
  return Math.abs(v) < 1e-9 ? 0 : Number(v.toPrecision(9));
}

/**
 * Media quadrilateral: slightly wider than the alpha opening.

 * Calibration expands the opening outward to remove white screen remnants.
 * Unless media expands too, the backdrop leaks through as a white edge strip.
 * The photo always renders above the media, hiding any overflow, so generous
 * coverage is safe and costs nothing.
 */
export const MEDIA_OUTSET = 0.012;

export function mediaQuad(quad: Quad): Quad {
  const cx = quad.reduce((s, p) => s + p.x, 0) / 4;
  const cy = quad.reduce((s, p) => s + p.y, 0) / 4;
  return quad.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / d) * MEDIA_OUTSET, y: p.y + (dy / d) * MEDIA_OUTSET };
  }) as Quad;
}
