/**
 * Drag-to-select a viewport region and return it as a cropped PNG.
 * @module region-select
 */

import { MIN_DRAG_PX, normalizeDragRect, computeCropRect } from '../lib/crop.js';

/** @typedef {import('../lib/types.js').CapturedImage} CapturedImage */

const OVERLAY_ID = 'linear-bug-quick-capture-selector';

/**
 * The outcome of one selection cycle. `error` distinguishes a genuine
 * failure (which must be surfaced to the user) from a plain cancel (where
 * silence is correct) — both of which have a null `image`.
 * @typedef {Object} SelectionResult
 * @property {CapturedImage|null} image
 * @property {string|null} error
 */

/**
 * Run one selection cycle.
 * @returns {Promise<SelectionResult>}
 */
export function selectRegion() {
  return new Promise((resolve) => {
    const layer = document.createElement('div');
    layer.id = OVERLAY_ID;
    // Closed so the host page cannot reach into the selector's DOM.
    const shadow = layer.attachShadow({ mode: 'closed' });

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

    /** @param {Event} e */
    const blockScroll = (e) => e.preventDefault();
    // The documentElement lock above misses body-level and inner
    // overflow:auto scrollers, which are common in SPA layouts. Without
    // this, a trackpad nudge mid-drag scrolls the page under the fixed dim
    // layer and the captured frame no longer matches the selection — a
    // silently wrong screenshot.
    dim.addEventListener('wheel', blockScroll, { passive: false });
    dim.addEventListener('touchmove', blockScroll, { passive: false });

    document.documentElement.append(layer);

    /** @type {{x: number, y: number}|null} */
    let start = null;
    /** @type {{left: number, top: number, width: number, height: number}|null} */
    let rect = null;

    function cleanup() {
      document.documentElement.style.overflow = prevOverflow;
      dim.removeEventListener('wheel', blockScroll);
      dim.removeEventListener('touchmove', blockScroll);
      layer.remove();
      window.removeEventListener('keydown', onKey, true);
    }

    /** @param {KeyboardEvent} e */
    function onKey(e) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      cleanup();
      resolve({ image: null, error: null });
    }
    window.addEventListener('keydown', onKey, true);

    dim.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // ignore right/middle click
      start = { x: e.clientX, y: e.clientY };
      // Clear any geometry left by an earlier drag in this same cycle.
      // Without this, a mousedown/mouseup pair with no intervening mousemove
      // (which happens when a drag is released outside the viewport and the
      // user clicks back in) would commit the PREVIOUS rectangle and attach
      // the wrong region to the ticket. Also don't paint the box until there
      // is an actual drag to show.
      rect = null;
    });

    dim.addEventListener('mousemove', (e) => {
      if (!start) return;
      rect = normalizeDragRect(start, { x: e.clientX, y: e.clientY });
      rectEl.style.display = 'block';
      readout.style.display = 'block';
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
        resolve({ image: null, error: null }); // a stray click, not a failure
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

      try {
        const res = await chrome.runtime.sendMessage({ type: 'CAPTURE_VIEWPORT' });
        if (!res?.ok) {
          resolve({
            image: null,
            error: res?.message ?? 'Could not capture this page.',
          });
          return;
        }
        const image = await cropDataUrl(res.dataUrl, committed);
        resolve(
          image
            ? { image, error: null }
            : { image: null, error: 'Could not process the screenshot.' }
        );
      } catch {
        // sendMessage REJECTS (it does not return ok:false) when the
        // extension context is invalidated — which happens on every reload
        // or auto-update while this content script is still live. Without
        // this catch the rejection escaped the async listener, so cleanup()
        // never ran and the promise never settled: the page stayed
        // scroll-locked with the modal hidden and every selector element
        // already display:none, leaving the user no visual cue at all.
        resolve({ image: null, error: 'The extension reloaded. Try again.' });
      } finally {
        // Runs on every path above, including the rejection. cleanup() is
        // idempotent, so an Escape during the capture round-trip that
        // already cleaned up is harmless.
        cleanup();
      }
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
