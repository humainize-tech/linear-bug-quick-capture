/**
 * All extension storage access. Only the service worker and the options page
 * import this; content scripts go through messages so the API key stays
 * unreachable from page context.
 * @module storage
 */

const KEY_API = 'apiKey';

/** @returns {Promise<string|null>} */
export async function getApiKey() {
  const out = await chrome.storage.local.get(KEY_API);
  return out[KEY_API] ?? null;
}

/**
 * @param {string} key
 * @returns {Promise<void>}
 */
export async function setApiKey(key) {
  await chrome.storage.local.set({ [KEY_API]: key });
}

/** @returns {Promise<void>} */
export async function clearApiKey() {
  await chrome.storage.local.remove(KEY_API);
}
