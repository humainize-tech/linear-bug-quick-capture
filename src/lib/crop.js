/**
 * Selection geometry. Pure — no DOM, no chrome APIs.
 * @module crop
 */

/** Drags smaller than this in CSS px are treated as stray clicks. */
export const MIN_DRAG_PX = 8;

/**
 * Turn two drag endpoints into a positive-area rect, so dragging up or
 * left works the same as down or right.
 * @param {{x: number, y: number}} start
 * @param {{x: number, y: number}} end
 * @returns {{left: number, top: number, width: number, height: number}}
 */
export function normalizeDragRect(start, end) {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

/**
 * Map a CSS-pixel viewport rect onto the captured image's device pixels.
 *
 * captureVisibleTab returns the viewport at devicePixelRatio scale, and
 * devicePixelRatio already folds in browser zoom, so scaling by it is the
 * whole correction. Results are clamped because the captured image can be
 * a rounding pixel off the computed viewport size.
 *
 * @param {{left: number, top: number, width: number, height: number}} rect
 * @param {number} dpr
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @returns {{sx: number, sy: number, sw: number, sh: number}}
 */
export function computeCropRect(rect, dpr, imageWidth, imageHeight) {
  const sx = Math.max(0, Math.min(Math.round(rect.left * dpr), imageWidth));
  const sy = Math.max(0, Math.min(Math.round(rect.top * dpr), imageHeight));
  const sw = Math.max(1, Math.min(Math.round(rect.width * dpr), imageWidth - sx));
  const sh = Math.max(1, Math.min(Math.round(rect.height * dpr), imageHeight - sy));
  return { sx, sy, sw, sh };
}
