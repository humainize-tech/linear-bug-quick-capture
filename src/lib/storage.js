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
  // The cache is keyed by nothing but time, so a different key's workspace
  // would keep showing the previous key's projects for up to the TTL — and
  // saving against a stale project id yields a raw GraphQL error.
  // `clearCachedWorkspace` is a hoisted function declaration below.
  await clearCachedWorkspace();
}

/** @returns {Promise<void>} */
export async function clearApiKey() {
  await chrome.storage.local.remove(KEY_API);
  await clearCachedWorkspace();
}

const KEY_PREFS = 'stickyPrefs';
const KEY_PROJECT_CACHE = 'projectsCache';
const PROJECT_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * @returns {Promise<import('./types.js').Workspace|null>} null when absent or stale.
 */
export async function getCachedWorkspace() {
  const out = await chrome.storage.session.get(KEY_PROJECT_CACHE);
  const entry = out[KEY_PROJECT_CACHE];
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > PROJECT_CACHE_TTL_MS) return null;
  // An entry with no `statusesByTeam` was written by a build that predates the
  // Status field. Treating it as stale rather than returning it is what keeps
  // an in-place extension upgrade from showing an empty Status dropdown for
  // the rest of the TTL.
  if (!entry.statusesByTeam) return null;
  return { projects: entry.projects, statusesByTeam: entry.statusesByTeam };
}

/**
 * @param {import('./types.js').Workspace} workspace
 * @returns {Promise<void>}
 */
export async function setCachedWorkspace({ projects, statusesByTeam }) {
  await chrome.storage.session.set({
    [KEY_PROJECT_CACHE]: { fetchedAt: Date.now(), projects, statusesByTeam },
  });
}

/**
 * Drop the workspace cache. Called on any API key change: the cache carries no
 * identity of the key that filled it, so it must not outlive one.
 *
 * Declared as a function declaration so it hoists above `setApiKey` /
 * `clearApiKey`, which call it.
 * @returns {Promise<void>}
 */
export async function clearCachedWorkspace() {
  await chrome.storage.session.remove(KEY_PROJECT_CACHE);
}

/**
 * @returns {Promise<{lastProjectId: string|null, lastTeamId: string|null, lastStatusName: string|null}>}
 */
export async function getStickyPrefs() {
  const out = await chrome.storage.local.get(KEY_PREFS);
  const prefs = out[KEY_PREFS] ?? {};
  // Field-by-field rather than returning the stored object wholesale: a prefs
  // object written before `lastStatusName` existed would otherwise hand back
  // `undefined` for it, which is not what the type promises.
  return {
    lastProjectId: prefs.lastProjectId ?? null,
    lastTeamId: prefs.lastTeamId ?? null,
    lastStatusName: prefs.lastStatusName ?? null,
  };
}

/**
 * The status is remembered by *name*, not id: state ids are team-scoped, so an
 * id carries no meaning once the next bug goes to a different team, whereas
 * names like "Triage" and "Backlog" are shared across most teams.
 *
 * @param {string} projectId
 * @param {string} teamId
 * @param {string|null} [statusName]
 * @returns {Promise<void>}
 */
export async function setStickyPrefs(projectId, teamId, statusName = null) {
  await chrome.storage.local.set({
    [KEY_PREFS]: {
      lastProjectId: projectId,
      lastTeamId: teamId,
      lastStatusName: statusName,
    },
  });
}

/** @returns {Promise<void>} */
export async function clearStickyPrefs() {
  await chrome.storage.local.remove(KEY_PREFS);
}

const DRAFT_PREFIX = 'draft:';
/** Leave headroom under the 10 MB chrome.storage.session quota. */
const DRAFT_BUDGET_BYTES = 8 * 1024 * 1024;

/**
 * @param {string} origin
 * @returns {Promise<import('./types.js').Draft|null>}
 */
export async function getDraft(origin) {
  const key = DRAFT_PREFIX + origin;
  const out = await chrome.storage.session.get(key);
  return out[key] ?? null;
}

/**
 * Persist a draft, evicting other origins' drafts oldest-first if the total
 * would exceed the session budget. Screenshots dominate the payload, so this
 * is a real constraint rather than a theoretical one.
 *
 * @param {string} origin
 * @param {import('./types.js').Draft} draft
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function setDraft(origin, draft) {
  const key = DRAFT_PREFIX + origin;
  const all = await chrome.storage.session.get(null);

  /** @param {any} value */
  const sizeOf = (value) => JSON.stringify(value ?? null).length;

  const incoming = sizeOf(draft);
  if (incoming > DRAFT_BUDGET_BYTES) {
    return { ok: false, reason: 'too-large' };
  }

  /** @type {{k: string, size: number, updatedAt: number}[]} */
  const others = Object.entries(all)
    .filter(([k]) => k.startsWith(DRAFT_PREFIX) && k !== key)
    .map(([k, v]) => ({ k, size: sizeOf(v), updatedAt: v?.updatedAt ?? 0 }))
    .sort((a, b) => a.updatedAt - b.updatedAt);

  let total = incoming + others.reduce((n, o) => n + o.size, 0);
  /** @type {string[]} */
  const evict = [];
  for (const other of others) {
    if (total <= DRAFT_BUDGET_BYTES) break;
    evict.push(other.k);
    total -= other.size;
  }
  if (evict.length) await chrome.storage.session.remove(evict);

  await chrome.storage.session.set({ [key]: draft });
  return { ok: true };
}

/**
 * @param {string} origin
 * @returns {Promise<void>}
 */
export async function clearDraft(origin) {
  await chrome.storage.session.remove(DRAFT_PREFIX + origin);
}

/** @returns {Promise<void>} */
export async function clearAllDrafts() {
  const all = await chrome.storage.session.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(DRAFT_PREFIX));
  if (keys.length) await chrome.storage.session.remove(keys);
}
