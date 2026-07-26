/**
 * Message router and action handler. Owns all Linear traffic and all storage.
 * @module service-worker
 */

import {
  fetchViewer,
  fetchProjects,
  uploadImage,
  createIssue,
  LinearError,
} from './linear-api.js';
import { buildDescription } from '../lib/description.js';
import {
  getApiKey,
  getCachedProjects,
  setCachedProjects,
  getStickyPrefs,
} from '../lib/storage.js';

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

    case 'GET_INIT': {
      const key = await getApiKey();
      if (!key) return { ok: true, hasKey: false };

      let projects = await getCachedProjects();
      if (!projects) {
        try {
          projects = await fetchProjects();
          await setCachedProjects(projects);
        } catch (err) {
          const e = /** @type {LinearError} */ (err);
          return { ok: false, hasKey: true, message: e.message, code: e.code };
        }
      }
      const prefs = await getStickyPrefs();
      return {
        ok: true,
        hasKey: true,
        projects,
        lastProjectId: prefs.lastProjectId,
        lastTeamId: prefs.lastTeamId,
      };
    }

    case 'OPEN_URL':
      await chrome.tabs.create({ url: msg.url });
      return { ok: true };

    case 'CAPTURE_VIEWPORT': {
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
        return { ok: true, dataUrl };
      } catch (err) {
        return {
          ok: false,
          message: 'Could not capture this page.',
          code: 'CAPTURE',
        };
      }
    }

    default:
      return { ok: false, message: `Unknown message type: ${msg?.type}` };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg).then(sendResponse);
  return true; // keep the channel open for the async response
});

const BADGE_MS = 4000;

/**
 * Flash an error badge on the toolbar icon. Used when a page forbids
 * injection, since there is no UI to put a message in.
 * @param {number} tabId
 * @param {string} title
 */
async function flashBadge(tabId, title) {
  await chrome.action.setBadgeText({ tabId, text: '!' });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#c0392b' });
  await chrome.action.setTitle({ tabId, title });
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    chrome.action.setTitle({ tabId, title: 'Capture a Linear bug' }).catch(() => {});
  }, BADGE_MS);
}

/**
 * True if the overlay is already mounted in this tab.
 * @param {number} tabId
 */
async function isMounted(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return res?.ok === true;
  } catch {
    return false; // no receiver: nothing injected yet
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  if (await isMounted(tab.id)) {
    await chrome.tabs.sendMessage(tab.id, { type: 'SHOW' });
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/bootstrap.js'],
    });
  } catch {
    // chrome://, the Web Store, chrome-extension://, view-source:, and the
    // PDF viewer all refuse injection. Nothing to do but say so.
    await flashBadge(tab.id, 'Cannot capture a bug on this page');
  }
});

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

// Dev hook: inspect the service worker at chrome://extensions and call these
// from its console to exercise the Linear client without any UI. Task 10
// gates this behind a flag before the extension is considered done.
// @ts-ignore - augmenting the worker global for debugging
self.__debug = {
  fetchViewer,
  fetchProjects,
  uploadImage,
  createIssue,
  buildDescription,
  TINY_PNG,
};
