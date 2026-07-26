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

const KEY_PREFS = 'stickyPrefs';
const KEY_PROJECT_CACHE = 'projectsCache';
const PROJECT_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * @returns {Promise<import('./types.js').Project[]|null>} null when absent or stale.
 */
export async function getCachedProjects() {
  const out = await chrome.storage.session.get(KEY_PROJECT_CACHE);
  const entry = out[KEY_PROJECT_CACHE];
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > PROJECT_CACHE_TTL_MS) return null;
  return entry.projects;
}

/**
 * @param {import('./types.js').Project[]} projects
 * @returns {Promise<void>}
 */
export async function setCachedProjects(projects) {
  await chrome.storage.session.set({
    [KEY_PROJECT_CACHE]: { fetchedAt: Date.now(), projects },
  });
}

/**
 * @returns {Promise<{lastProjectId: string|null, lastTeamId: string|null}>}
 */
export async function getStickyPrefs() {
  const out = await chrome.storage.local.get(KEY_PREFS);
  return out[KEY_PREFS] ?? { lastProjectId: null, lastTeamId: null };
}

/**
 * @param {string} projectId
 * @param {string} teamId
 * @returns {Promise<void>}
 */
export async function setStickyPrefs(projectId, teamId) {
  await chrome.storage.local.set({
    [KEY_PREFS]: { lastProjectId: projectId, lastTeamId: teamId },
  });
}
