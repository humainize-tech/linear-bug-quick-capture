/**
 * Message router and action handler. Owns all Linear traffic and all storage.
 * @module service-worker
 */

import { fetchViewer, fetchProjects, LinearError } from './linear-api.js';

/**
 * Route a one-shot message. Returns a plain serialisable object.
 * Never include the API key in a response.
 * @param {any} msg
 * @returns {Promise<any>}
 */
async function handleMessage(msg) {
  switch (msg?.type) {
    case 'PING':
      return { ok: true };

    case 'OPEN_OPTIONS':
      await chrome.runtime.openOptionsPage();
      return { ok: true };

    case 'TEST_CONNECTION':
      try {
        const viewer = await fetchViewer();
        return { ok: true, viewer };
      } catch (err) {
        const e = /** @type {LinearError} */ (err);
        return { ok: false, message: e.message, code: e.code ?? 'GRAPHQL' };
      }

    default:
      return { ok: false, message: `Unknown message type: ${msg?.type}` };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg).then(sendResponse);
  return true; // keep the channel open for the async response
});

// Dev hook: inspect the service worker at chrome://extensions and call these
// from its console to exercise the Linear client without any UI. Task 10
// gates this behind a flag before the extension is considered done.
// @ts-ignore - augmenting the worker global for debugging
self.__debug = { fetchViewer, fetchProjects };
