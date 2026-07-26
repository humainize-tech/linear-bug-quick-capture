/**
 * Drag-to-select a viewport region and return it as a cropped PNG.
 * @module region-select
 */

import { MIN_DRAG_PX, normalizeDragRect, computeCropRect } from '../lib/crop.js';

/** @typedef {import('../lib/types.js').CapturedImage} CapturedImage */

const OVERLAY_ID = 'linear-bug-quick-capture-selector';

/**
 * Run one selection cycle.
 * @returns {Promise<CapturedImage|null>} null if cancelled.
 */
export function selectRegion() {
  return new Promise((resolve) => {
    const layer = document.createElement('div');
    layer.id = OVERLAY_ID;
    const shadow = layer.attachShadow({ mode: 'open' });

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      :host { all: initial; }
      .dim {
        position: fixed; inset: 0; z-index: 2147483646;
        background: rgba(15,15,20,.35); cursor: crosshair;
      }
      .rect {
        position: fixed; border: 1px solid #5e6ad2;
        background: rgba(94,106,210,.14); pointer-events: none;
        display: none;
      }
      .readout {
        position: fixed; padding: 2px 6px; border-radius: 4px;
        background: #1b1b1f; color: #fff; pointer-events: none;
        font: 11px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        display: none;
      }
      .hint {
        position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
        padding: 6px 12px; border-radius: 6px; background: #1b1b1f; color: #fff;
        font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        pointer-events: none;
      }
    `);
    shadow.adoptedStyleSheets = [sheet];

    const dim = document.createElement('div');
    dim.className = 'dim';
    const rectEl = document.createElement('div');
    rectEl.className = 'rect';
    const readout = document.createElement('div');
    readout.className = 'readout';
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Drag to select a region — Esc to cancel';
    shadow.append(dim, rectEl, readout, hint);

    // Lock scroll so the selection rect cannot drift out of sync with the
    // frame that captureVisibleTab returns.
    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    document.documentElement.append(layer);

    /** @type {{x: number, y: number}|null} */
    let start = null;
    /** @type {{left: number, top: number, width: number, height: number}|null} */
    let rect = null;

    function cleanup() {
      document.documentElement.style.overflow = prevOverflow;
      layer.remove();
      window.removeEventListener('keydown', onKey, true);
    }

    /** @param {KeyboardEvent} e */
    function onKey(e) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      cleanup();
      resolve(null);
    }
    window.addEventListener('keydown', onKey, true);

    dim.addEventListener('mousedown', (e) => {
      start = { x: e.clientX, y: e.clientY };
      rectEl.style.display = 'block';
      readout.style.display = 'block';
    });

    dim.addEventListener('mousemove', (e) => {
      if (!start) return;
      rect = normalizeDragRect(start, { x: e.clientX, y: e.clientY });
      rectEl.style.left = `${rect.left}px`;
      rectEl.style.top = `${rect.top}px`;
      rectEl.style.width = `${rect.width}px`;
      rectEl.style.height = `${rect.height}px`;
      readout.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
      readout.style.left = `${rect.left}px`;
      readout.style.top = `${Math.max(0, rect.top - 20)}px`;
    });

    dim.addEventListener('mouseup', async () => {
      if (!start || !rect || rect.width < MIN_DRAG_PX || rect.height < MIN_DRAG_PX) {
        cleanup();
        resolve(null);
        return;
      }
      const committed = rect;

      // Hide our own chrome, then let the compositor paint twice, and only
      // THEN capture. Without this the dim layer and selection rectangle
      // land in the screenshot.
      dim.style.display = 'none';
      rectEl.style.display = 'none';
      readout.style.display = 'none';
      hint.style.display = 'none';
      await nextFrame();
      await nextFrame();

      const res = await chrome.runtime.sendMessage({ type: 'CAPTURE_VIEWPORT' });
      cleanup();

      if (!res?.ok) {
        resolve(null);
        return;
      }
      resolve(await cropDataUrl(res.dataUrl, committed));
    });
  });
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => r(undefined)));
}

/**
 * Crop the full-viewport capture down to the selected region.
 *
 * Bytes are read with fetch() rather than an <img src="data:...">, because
 * content-script DOM is subject to the page's CSP and a strict img-src
 * would block a data URI.
 *
 * @param {string} dataUrl
 * @param {{left: number, top: number, width: number, height: number}} rect
 * @returns {Promise<CapturedImage|null>}
 */
async function cropDataUrl(dataUrl, rect) {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const { sx, sy, sw, sh } = computeCropRect(
      rect,
      window.devicePixelRatio || 1,
      bitmap.width,
      bitmap.height
    );

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);

    return { dataUrl: canvas.toDataURL('image/png'), width: sw, height: sh };
  } catch {
    return null;
  }
}
