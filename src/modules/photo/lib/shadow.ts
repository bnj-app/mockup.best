/**
 * Device shadow: measured values. Use a ten-step soft shadow ramp diagonally down and right,
 * colored rgba(2, 8, 23, α) rather than pure black. Levels scale the same ramp; measured first-step
 * alpha: Soft .235 · Medium .32 · Hard .43 → k = .55 / .74 / 1.0. Geometry scales by the same k
 * (Soft's widest step is 55% of Hard's). Store the ramp as fractions of device width so shadows
 * look identical in 1080 and 2160 exports.
 */

export const SHADOW_LEVELS: Record<string, number> = {
  None: 0,
  Soft: 0.55,
  Medium: 0.74,
  Hard: 1,
};

/** [offset, blur, spread] as fractions of device width, plus alpha. */
const RAMP: Array<[number, number, number, number]> = [
  [0.00163, 0.00179, 0.0, 0.26],
  [0.00179, 0.00195, -0.00098, 0.227],
  [0.00309, 0.00326, -0.00179, 0.204],
  [0.00635, 0.00668, -0.00277, 0.18],
  [0.01287, 0.01368, -0.00358, 0.157],
  [0.02362, 0.02508, -0.00456, 0.125],
  [0.03974, 0.04218, -0.00537, 0.1],
  [0.06222, 0.06596, -0.00635, 0.08],
  [0.09202, 0.09756, -0.00717, 0.055],
  [0.13029, 0.13828, -0.00814, 0.024],
];

/** CSS box-shadow string for preview. */
export function shadowCss(level: string, deviceWidth: number): string {
  const k = SHADOW_LEVELS[level] ?? 0;
  if (!k) return 'none';
  return RAMP.map(([o, b, s, a]) => {
    const px = (v: number) => `${(v * deviceWidth * k).toFixed(2)}px`;
    return `rgba(2, 8, 23, ${(a * k).toFixed(3)}) ${px(o)} ${px(o)} ${px(b)} ${px(s)}`;
  }).join(', ');
}

/**
 * Export: canvas can draw only one shadow at a time, so draw the rectangle once per ramp step.
 * There is no spread equivalent; simulate it by insetting the rectangle by that amount.
 */
export function paintShadow(
  ctx: CanvasRenderingContext2D,
  level: string,
  rect: { x: number; y: number; w: number; h: number; r: number },
  fill: string,
) {
  const k = SHADOW_LEVELS[level] ?? 0;
  const path = (x: number, y: number, w: number, h: number, r: number) => {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  };

  if (k) {
    for (const [o, b, s, a] of RAMP) {
      const off = o * rect.w * k;
      const blur = b * rect.w * k;
      const sp = s * rect.w * k; // Negative
      ctx.save();
      ctx.shadowColor = `rgba(2, 8, 23, ${a * k})`;
      ctx.shadowBlur = blur;
      ctx.shadowOffsetX = off;
      ctx.shadowOffsetY = off;
      ctx.fillStyle = 'rgba(0,0,0,1)';
      path(rect.x - sp, rect.y - sp, rect.w + sp * 2, rect.h + sp * 2, Math.max(0, rect.r + sp));
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.save();
  ctx.fillStyle = fill;
  path(rect.x, rect.y, rect.w, rect.h, rect.r);
  ctx.fill();
  ctx.restore();
}
