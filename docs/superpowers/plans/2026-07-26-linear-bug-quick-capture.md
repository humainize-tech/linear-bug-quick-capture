# Linear Bug Quick Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Manifest V3 Chrome extension that creates a Linear issue from a drag-selected region of the current page, capturing the page URL automatically, with no backend.

**Architecture:** Three contexts — a service worker that owns all Linear network traffic and all storage, a shadow-DOM overlay injected into the active tab on toolbar click, and an options page for the API key. The worker is the only holder of the API key and the only caller of Linear, because Linear's pre-signed upload URLs require `x-goog-*` headers a page context cannot legally send.

**Tech Stack:** Vanilla ES modules, no bundler, no build step. `src/` is loaded unpacked directly. JSDoc annotations type-checked by `tsc --noEmit` (`checkJs`). No runtime dependencies.

## Global Constraints

- **No automated tests.** Verification is manual, per spec §10. Every task ends with a manual browser check and a type check, not a test run. Do not add test files or test tooling.
- **Only the service worker calls Linear.** No `fetch` to `api.linear.app` or any upload host from a content script, the options page, or page context.
- **The API key never leaves the service worker.** It must never appear in a `chrome.runtime` message, a `console.log`, an error message, or the DOM of any page.
- **Uploads are strictly sequential.** Prepare one upload, PUT it to completion, then prepare the next. Signed URLs expire 60 seconds after issue; batching prepares lets earlier URLs expire.
- **Every header returned by `fileUpload` must be sent on the PUT verbatim, including casing.** Altering or omitting any one returns HTTP 403.
- **Keep files under 500 lines** (repo `CLAUDE.md`).
- **Never write working files to the repo root.** Sources in `src/`, docs in `docs/`, scripts in `scripts/`. The sole root exceptions are `tsconfig.json`, `package.json`, and `.gitignore`, which their tools resolve from nowhere else.
- **Screenshot cap:** 5 images per draft.
- **Minimum drag:** 8×8 CSS pixels; below that, cancel instead of capturing.
- **Draft storage:** `chrome.storage.session` only, keyed `draft:<origin>`. Never `storage.local`, which would write screenshots to disk.
- **Session quota budget:** evict other origins' drafts oldest-first when all `draft:*` entries exceed 8 MB (10 MB quota).
- **Project cache TTL:** 5 minutes.
- **Success state auto-dismiss:** 3000 ms.
- **Restricted-page badge:** `!` for 4000 ms, then cleared.

**Task order rationale:** Tasks 1–4 prove the entire Linear contract bottom-up from the service worker console before any UI exists, because spec §11 lists four API details that could not be verified without a live key. Building UI on an unverified contract would mean debugging two unknowns at once.

**You will need:** a real Linear personal API key, and awareness that Tasks 3 and 4 create real assets and a real issue in the user's workspace. Task 4 tells you to delete the test issue afterward.

---

### Task 1: Scaffold, manifest, options page, key storage

Establishes the extension skeleton and answers spec §11 unknown #1 (whether personal keys use a bare `Authorization` header or a `Bearer` prefix) via a working connection test.

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/manifest.json`
- Create: `src/lib/types.js`
- Create: `src/lib/storage.js`
- Create: `src/background/linear-api.js`
- Create: `src/background/service-worker.js`
- Create: `src/options/options.html`
- Create: `src/options/options.css`
- Create: `src/options/options.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `lib/types.js` — JSDoc typedefs `CapturedImage`, `Draft`, `Project`, `Team`, `CreatePayload`.
  - `lib/storage.js` — `getApiKey(): Promise<string|null>`, `setApiKey(key: string): Promise<void>`, `clearApiKey(): Promise<void>`.
  - `background/linear-api.js` — `class LinearError extends Error` with `.code` of `'AUTH'|'NETWORK'|'GRAPHQL'|'UPLOAD'`; `graphql(query: string, variables?: object): Promise<object>`; `fetchViewer(): Promise<{id, name, email, organizationName}>`.
  - `background/service-worker.js` — message router handling `{type:'OPEN_OPTIONS'}` and `{type:'TEST_CONNECTION'}`.

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
.DS_Store
```

- [ ] **Step 2: Create `package.json`**

Only devDependencies, only for type-checking. There is no build and no runtime dependency.

```json
{
  "name": "linear-bug-quick-capture",
  "version": "0.1.0",
  "private": true,
  "description": "Chrome extension to create Linear bug tickets from a screen region",
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.268",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["chrome"],
    "allowJs": true,
    "checkJs": true,
    "noEmit": true,
    "strict": true,
    "noImplicitAny": false,
    "skipLibCheck": true
  },
  "include": ["src/**/*.js"]
}
```

- [ ] **Step 4: Install the type-checking devDependencies**

Run: `npm install`
Expected: `node_modules/` created, no errors. This is the only `npm install` in the project.

- [ ] **Step 5: Create `src/manifest.json`**

Both upload hosts are listed for now. Task 3 narrows this to the one Linear actually returns.

```json
{
  "manifest_version": 3,
  "name": "Linear Bug Quick Capture",
  "version": "0.1.0",
  "description": "Capture a region of the page and file it as a Linear bug.",
  "permissions": ["activeTab", "scripting", "storage"],
  "host_permissions": [
    "https://api.linear.app/*",
    "https://uploads.linear.app/*",
    "https://storage.googleapis.com/*"
  ],
  "background": {
    "service_worker": "background/service-worker.js",
    "type": "module"
  },
  "action": {
    "default_title": "Capture a Linear bug"
  },
  "options_page": "options/options.html",
  "web_accessible_resources": [
    {
      "resources": ["content/*.js", "lib/*.js"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

Note there is deliberately no `default_popup`. A popup would suppress `chrome.action.onClicked`, which Task 5 depends on.

- [ ] **Step 6: Create `src/lib/types.js`**

```js
/**
 * Shared JSDoc typedefs. This module intentionally exports nothing at runtime.
 * @module types
 */

/**
 * @typedef {Object} Team
 * @property {string} id
 * @property {string} key   Short team key, e.g. "ENG".
 * @property {string} name
 */

/**
 * @typedef {Object} Project
 * @property {string} id
 * @property {string} name
 * @property {Team[]} teams
 */

/**
 * A cropped region screenshot.
 * @typedef {Object} CapturedImage
 * @property {string} dataUrl  PNG as "data:image/png;base64,..."
 * @property {number} width    Device pixels.
 * @property {number} height   Device pixels.
 */

/**
 * @typedef {Object} Draft
 * @property {string} title
 * @property {string} description
 * @property {string|null} projectId
 * @property {string|null} teamId
 * @property {CapturedImage[]} images
 * @property {number} updatedAt  Epoch ms, used for LRU eviction.
 */

/**
 * @typedef {Object} CreatePayload
 * @property {string} title
 * @property {string} description
 * @property {string} pageUrl
 * @property {string} projectId
 * @property {string} teamId
 * @property {CapturedImage[]} images
 */

export {};
```

- [ ] **Step 7: Create `src/lib/storage.js`**

Only the key functions for now. Later tasks extend this file.

```js
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
```

- [ ] **Step 8: Create `src/background/linear-api.js`**

The `Authorization` header shape is the unknown this task resolves. Start with the bare key; Step 12 tells you what to do if it 401s.

```js
/**
 * Linear GraphQL client. Runs only in the service worker.
 * @module linear-api
 */

import { getApiKey } from '../lib/storage.js';

const ENDPOINT = 'https://api.linear.app/graphql';

/** Categorised failure, so callers can map to user-facing copy. */
export class LinearError extends Error {
  /**
   * @param {string} message
   * @param {'AUTH'|'NETWORK'|'GRAPHQL'|'UPLOAD'} code
   */
  constructor(message, code) {
    super(message);
    this.name = 'LinearError';
    this.code = code;
  }
}

/**
 * Execute a GraphQL document against Linear.
 * @param {string} query
 * @param {object} [variables]
 * @returns {Promise<any>} The `data` payload.
 */
export async function graphql(query, variables = {}) {
  const key = await getApiKey();
  if (!key) throw new LinearError('No API key set.', 'AUTH');

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        // Linear personal API keys are sent bare, with no "Bearer " prefix.
        Authorization: key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    throw new LinearError('Could not reach Linear. Check your connection.', 'NETWORK');
  }

  if (res.status === 401 || res.status === 403) {
    throw new LinearError('Linear rejected the API key.', 'AUTH');
  }

  /** @type {any} */
  let body;
  try {
    body = await res.json();
  } catch {
    throw new LinearError(`Linear returned HTTP ${res.status}.`, 'GRAPHQL');
  }

  if (body.errors?.length) {
    throw new LinearError(body.errors[0].message, 'GRAPHQL');
  }
  if (!res.ok) {
    throw new LinearError(`Linear returned HTTP ${res.status}.`, 'GRAPHQL');
  }
  return body.data;
}

/**
 * @returns {Promise<{id: string, name: string, email: string, organizationName: string}>}
 */
export async function fetchViewer() {
  const data = await graphql(`
    query Viewer {
      viewer { id name email organization { name } }
    }
  `);
  return {
    id: data.viewer.id,
    name: data.viewer.name,
    email: data.viewer.email,
    organizationName: data.viewer.organization.name,
  };
}
```

- [ ] **Step 9: Create `src/background/service-worker.js`**

```js
/**
 * Message router and action handler. Owns all Linear traffic and all storage.
 * @module service-worker
 */

import { fetchViewer, LinearError } from './linear-api.js';

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
```

- [ ] **Step 10: Create `src/options/options.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Linear Bug Quick Capture — Settings</title>
    <link rel="stylesheet" href="options.css" />
  </head>
  <body>
    <main>
      <h1>Linear Bug Quick Capture</h1>

      <section>
        <h2>Linear API key</h2>
        <label for="key">Personal API key</label>
        <div class="row">
          <input id="key" type="password" autocomplete="off" spellcheck="false"
                 placeholder="lin_api_..." />
          <button id="reveal" type="button" class="ghost">Show</button>
        </div>
        <div class="row">
          <button id="save" type="button">Save key</button>
          <button id="test" type="button" class="ghost">Test connection</button>
          <button id="clear" type="button" class="ghost danger">Clear key</button>
        </div>
        <p id="status" class="status" role="status"></p>

        <div class="note">
          <strong>Use a scoped key.</strong> This key is stored unencrypted in
          this extension's local storage, which is how it can work without a
          backend. Anyone with access to your Chrome profile directory can read
          it. In Linear, go to <em>Settings &rarr; Account &rarr; Security &amp;
          Access</em> and create a key limited to <em>Read</em> and
          <em>Create issues</em>, restricted to the teams you file bugs against
          — not a full-access key.
        </div>
      </section>
    </main>
    <script type="module" src="options.js"></script>
  </body>
</html>
```

- [ ] **Step 11: Create `src/options/options.css`**

```css
:root {
  --bg: #fff;
  --fg: #1b1b1f;
  --muted: #6b6b76;
  --line: #e3e3e8;
  --accent: #5e6ad2;
  --danger: #c0392b;
  --ok: #1f7a4d;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1b1b1f;
    --fg: #eceef3;
    --muted: #9a9aa5;
    --line: #33343b;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 32px;
  background: var(--bg);
  color: var(--fg);
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
main { max-width: 560px; margin: 0 auto; }
h1 { font-size: 20px; margin: 0 0 24px; }
h2 { font-size: 14px; margin: 0 0 12px; }
label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 6px; }
.row { display: flex; gap: 8px; margin-bottom: 12px; }
input {
  flex: 1; padding: 8px 10px; border: 1px solid var(--line);
  border-radius: 6px; background: var(--bg); color: var(--fg); font: inherit;
}
button {
  padding: 8px 14px; border: 1px solid transparent; border-radius: 6px;
  background: var(--accent); color: #fff; font: inherit; cursor: pointer;
}
button.ghost { background: transparent; border-color: var(--line); color: var(--fg); }
button.danger { color: var(--danger); }
.status { min-height: 20px; font-size: 13px; margin: 4px 0 0; }
.status.ok { color: var(--ok); }
.status.err { color: var(--danger); }
.note {
  margin-top: 20px; padding: 12px 14px; border: 1px solid var(--line);
  border-radius: 6px; font-size: 13px; color: var(--muted);
}
```

- [ ] **Step 12: Create `src/options/options.js`**

```js
/**
 * Options page. Reads and writes the API key directly (it is an extension
 * page, not page context) but routes the connection test through the worker
 * so there is exactly one Linear client.
 * @module options
 */

import { getApiKey, setApiKey, clearApiKey } from '../lib/storage.js';

/**
 * Look up a required element. Returns HTMLElement, which covers everything
 * the callers below need (textContent, className, addEventListener); only
 * the key field needs a narrower type, and it casts at its own site. Do not
 * be tempted to have this return an intersection of several element types —
 * `HTMLInputElement & HTMLButtonElement` collapses `.type` to the button's
 * literal union and stops type-checking.
 * @param {string} id
 * @returns {HTMLElement}
 */
function $(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node;
}

const keyInput = /** @type {HTMLInputElement} */ ($('key'));
const status = $('status');

/**
 * @param {string} text
 * @param {'ok'|'err'|''} kind
 */
function setStatus(text, kind = '') {
  status.textContent = text;
  status.className = `status ${kind}`;
}

async function load() {
  const existing = await getApiKey();
  if (existing) {
    keyInput.value = existing;
    setStatus('A key is saved.', '');
  }
}

$('reveal').addEventListener('click', () => {
  const revealed = keyInput.type === 'text';
  keyInput.type = revealed ? 'password' : 'text';
  $('reveal').textContent = revealed ? 'Show' : 'Hide';
});

$('save').addEventListener('click', async () => {
  const value = keyInput.value.trim();
  if (!value) {
    setStatus('Enter a key first.', 'err');
    return;
  }
  await setApiKey(value);
  setStatus('Key saved.', 'ok');
});

$('test').addEventListener('click', async () => {
  setStatus('Testing…', '');
  const res = await chrome.runtime.sendMessage({ type: 'TEST_CONNECTION' });
  if (res.ok) {
    setStatus(
      `Connected as ${res.viewer.name} in ${res.viewer.organizationName}.`,
      'ok'
    );
  } else {
    setStatus(res.message, 'err');
  }
});

$('clear').addEventListener('click', async () => {
  await clearApiKey();
  keyInput.value = '';
  setStatus('Key cleared.', '');
});

load();
```

- [ ] **Step 13: Type-check**

Run: `npm run typecheck`
Expected: exits 0 with no output.

- [ ] **Step 14: Load the extension and verify the connection test**

Run: (manual)
1. Open `chrome://extensions`, enable Developer mode, click **Load unpacked**, select the `src/` directory.
2. Click **Details → Extension options**.
3. Paste a real Linear personal API key, click **Save key**, then **Test connection**.

Expected: `Connected as <your name> in <your workspace>.`

**If it reports "Linear rejected the API key" instead**, that resolves spec §11 unknown #1 the other way. Change the header in `src/background/linear-api.js` from `Authorization: key` to:

```js
        Authorization: `Bearer ${key}`,
```

and update the comment above it to say keys require a `Bearer` prefix. Re-run the test. Record whichever form worked in the commit message so later tasks do not re-litigate it.

- [ ] **Step 15: Verify a bad key produces a clean error**

Run: (manual) Replace the key with `lin_api_bogus`, click **Save key**, then **Test connection**.
Expected: a red error message, no uncaught exception in the options page console, and no key material anywhere in the message.

- [ ] **Step 16: Commit**

```bash
git add .gitignore package.json package-lock.json tsconfig.json src/
git commit -m "feat: scaffold MV3 extension with options page and Linear connection test"
```

---

### Task 2: Project and team fetching

Answers spec §11 unknown #4 (the `projects` filter shape and whether `Project.teams` is a connection).

**Files:**
- Modify: `src/background/linear-api.js`
- Modify: `src/lib/storage.js`
- Modify: `src/background/service-worker.js`

**Interfaces:**
- Consumes: `graphql()`, `LinearError` from Task 1.
- Produces:
  - `linear-api.js` — `fetchProjects(): Promise<Project[]>` returning `{id, name, teams: [{id, key, name}]}`, sorted by name.
  - `storage.js` — `getCachedProjects(): Promise<Project[]|null>` (returns `null` past TTL), `setCachedProjects(projects: Project[]): Promise<void>`, `getStickyPrefs(): Promise<{lastProjectId: string|null, lastTeamId: string|null}>`, `setStickyPrefs(projectId: string, teamId: string): Promise<void>`.
  - `service-worker.js` — `self.__debug` dev hook exposing `{fetchProjects, fetchViewer}`.

- [ ] **Step 1: Add the projects query to `src/background/linear-api.js`**

Append:

```js
/**
 * All active (non-completed) projects visible to the key, with their teams.
 * A team-scoped key simply sees fewer projects, which is the desired
 * behaviour.
 * @returns {Promise<import('../lib/types.js').Project[]>}
 */
export async function fetchProjects() {
  const data = await graphql(`
    query Projects {
      projects(first: 250, filter: { state: { neq: "completed" } }) {
        nodes {
          id
          name
          teams { nodes { id key name } }
        }
      }
    }
  `);
  return data.projects.nodes
    .map((/** @type {any} */ p) => ({
      id: p.id,
      name: p.name,
      teams: p.teams.nodes.map((/** @type {any} */ t) => ({
        id: t.id,
        key: t.key,
        name: t.name,
      })),
    }))
    .sort((/** @type {any} */ a, /** @type {any} */ b) =>
      a.name.localeCompare(b.name)
    );
}
```

- [ ] **Step 2: Add caching and sticky prefs to `src/lib/storage.js`**

Append:

```js
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
```

- [ ] **Step 3: Add the dev hook to `src/background/service-worker.js`**

Change the import line to include `fetchProjects`, and append the hook at the end of the file:

```js
import { fetchViewer, fetchProjects, LinearError } from './linear-api.js';
```

```js
// Dev hook: inspect the service worker at chrome://extensions and call these
// from its console to exercise the Linear client without any UI. Task 10
// gates this behind a flag before the extension is considered done.
// @ts-ignore - augmenting the worker global for debugging
self.__debug = { fetchViewer, fetchProjects };
```

- [ ] **Step 4: Type-check**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Verify against the live API**

Run: (manual)
1. `chrome://extensions` → **Reload** the extension → click **service worker** to open its devtools.
2. In that console: `await self.__debug.fetchProjects()`

Expected: an array of `{id, name, teams}` objects. Confirm at least one has a populated `teams` array with `id`, `key`, and `name`.

**If the query errors**, spec §11 unknown #4 resolved differently. Two likely fixes:
- Filter argument rejected → drop `filter:` entirely and filter in JS after mapping, using whatever state field the schema exposes.
- `teams` is not a connection → replace `teams { nodes { id key name } }` with `teams { id key name }` and drop the `.nodes` in the mapper.

Introspect before guessing:

```js
await self.__debug.fetchProjects // if this throws, run the introspection below in the same console
```

```js
// Paste into the service worker console to inspect the Project type.
const { graphql } = await import('./linear-api.js');
await graphql(`{ __type(name: "Project") { fields { name type { name kind ofType { name } } } } }`);
```

- [ ] **Step 6: Verify a multi-team project exists (or note its absence)**

Run: (manual) In the same console:

```js
(await self.__debug.fetchProjects()).filter(p => p.teams.length > 1).map(p => p.name)
```

Expected: either a list of multi-team project names, or `[]`. Record which in the commit message — Task 6's conditional team dropdown needs to be verified against a real multi-team project, and if none exists, you must create one in Linear to test that path.

- [ ] **Step 7: Commit**

```bash
git add src/
git commit -m "feat: fetch Linear projects with teams, cache them, add sticky prefs"
```

---

### Task 3: Screenshot upload

Answers spec §11 unknowns #2 (exact `fileUpload` field names) and #3 (the signed upload URL host, so the manifest can be narrowed).

**Files:**
- Modify: `src/background/linear-api.js`
- Modify: `src/background/service-worker.js`
- Modify: `src/manifest.json`

**Interfaces:**
- Consumes: `graphql()`, `LinearError` from Task 1.
- Produces: `linear-api.js` — `uploadImage(dataUrl: string, filename: string): Promise<string>` returning the `assetUrl`.

- [ ] **Step 1: Introspect the upload mutation before writing it**

Run: (manual) In the service worker console:

```js
const { graphql } = await import('./linear-api.js');
await graphql(`{ __type(name: "Mutation") { fields(includeDeprecated: false) { name } } }`);
```

Expected: a field list containing `fileUpload`. Then inspect its argument and return shape:

```js
await graphql(`{
  __type(name: "Mutation") {
    fields { name args { name type { name kind ofType { name } } } }
  }
}`);
```

```js
await graphql(`{ __type(name: "UploadPayload") { fields { name type { name kind ofType { name } } } } }`);
await graphql(`{ __type(name: "UploadFile") { fields { name type { name kind ofType { name } } } } }`);
```

Write down the actual names for: the payload field holding the upload request, the signed URL field, the asset URL field, and the headers list field. Step 2 assumes `uploadFile { uploadUrl assetUrl headers { key value } }`; correct it to match what you just observed.

- [ ] **Step 2: Add `uploadImage` to `src/background/linear-api.js`**

Append:

```js
/**
 * Upload one image to Linear's asset storage and return its permanent
 * asset URL.
 *
 * The signed URL expires 60 seconds after `fileUpload` returns, and every
 * header Linear hands back is part of the signature — omitting or
 * re-casing any of them yields HTTP 403. So: prepare, then immediately PUT
 * the raw bytes with those exact headers. Callers must never prepare a
 * second upload before this one resolves.
 *
 * @param {string} dataUrl  "data:image/png;base64,..."
 * @param {string} filename
 * @returns {Promise<string>} assetUrl
 */
export async function uploadImage(dataUrl, filename) {
  // fetch() on a data: URL is the cheapest way to raw bytes in a worker.
  const blob = await (await fetch(dataUrl)).blob();
  const contentType = blob.type || 'image/png';

  const data = await graphql(
    `
      mutation FileUpload($contentType: String!, $filename: String!, $size: Int!) {
        fileUpload(contentType: $contentType, filename: $filename, size: $size) {
          success
          uploadFile {
            uploadUrl
            assetUrl
            headers { key value }
          }
        }
      }
    `,
    { contentType, filename, size: blob.size }
  );

  const payload = data.fileUpload;
  if (!payload?.success || !payload.uploadFile) {
    throw new LinearError('Linear refused to prepare the upload.', 'UPLOAD');
  }

  const { uploadUrl, assetUrl, headers } = payload.uploadFile;

  /** @type {Record<string, string>} */
  const signed = {};
  for (const h of headers ?? []) signed[h.key] = h.value;

  let res;
  try {
    res = await fetch(uploadUrl, { method: 'PUT', headers: signed, body: blob });
  } catch {
    throw new LinearError('Could not reach Linear to upload the screenshot.', 'NETWORK');
  }

  if (!res.ok) {
    const hint =
      res.status === 403
        ? ' The signed URL may have expired, or a required header was altered.'
        : '';
    throw new LinearError(`Screenshot upload failed (HTTP ${res.status}).${hint}`, 'UPLOAD');
  }

  return assetUrl;
}
```

- [ ] **Step 3: Expose it on the dev hook**

In `src/background/service-worker.js`, extend the import and the hook. A 1×1 red PNG is included so the console test needs no canvas (workers have none).

```js
import { fetchViewer, fetchProjects, uploadImage, LinearError } from './linear-api.js';
```

```js
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

// @ts-ignore - augmenting the worker global for debugging
self.__debug = { fetchViewer, fetchProjects, uploadImage, TINY_PNG };
```

- [ ] **Step 4: Type-check**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Verify an upload end to end and capture the host**

Run: (manual) Reload the extension, open the service worker console:

```js
const url = await self.__debug.uploadImage(self.__debug.TINY_PNG, 'test.png');
url
```

Expected: a URL string. Then:
1. Open that URL in a tab where you are signed in to Linear. A 1×1 image (or a download) confirms the bytes landed.
2. In the worker's devtools **Network** tab, find the `PUT` and record its **host**.

**If the PUT returns 403**, the signed headers were not sent verbatim. Check that you are not adding `Content-Type` yourself outside the `signed` map, and that no header casing was changed. `x-goog-content-length-range` must be present exactly as returned.

**If the mutation errors on field names**, go back to Step 1's introspection and correct the document.

- [ ] **Step 6: Narrow the manifest to the observed host**

In `src/manifest.json`, delete whichever of `https://uploads.linear.app/*` or `https://storage.googleapis.com/*` is *not* the host you recorded in Step 5. If it is a third host entirely, replace both entries with that one.

Then reload the extension and re-run Step 5's upload to confirm it still succeeds with the narrowed permission.

Expected: upload still returns an asset URL. This closes spec §11 unknown #3.

- [ ] **Step 7: Commit**

```bash
git add src/
git commit -m "feat: upload screenshots to Linear asset storage with verbatim signed headers"
```

---

### Task 4: Description builder and issue creation

Proves the whole Linear contract before any UI exists.

**Files:**
- Create: `src/lib/description.js`
- Modify: `src/background/linear-api.js`
- Modify: `src/background/service-worker.js`

**Interfaces:**
- Consumes: `graphql()`, `uploadImage()`, `LinearError`.
- Produces:
  - `description.js` — `buildDescription({description: string, pageUrl: string, assetUrls: string[]}): string`.
  - `linear-api.js` — `createIssue({title, description, teamId, projectId}): Promise<{identifier: string, url: string}>`.

- [ ] **Step 1: Create `src/lib/description.js`**

```js
/**
 * Builds the markdown body sent to Linear. Pure — no I/O, no chrome APIs.
 * @module description
 */

/**
 * @param {{description: string, pageUrl: string, assetUrls: string[]}} input
 * @returns {string}
 */
export function buildDescription({ description, pageUrl, assetUrls }) {
  /** @type {string[]} */
  const blocks = [];

  const body = (description ?? '').trim();
  if (body) blocks.push(body);

  blocks.push('---');
  blocks.push(`**Page:** ${pageUrl}`);

  if (assetUrls.length) {
    blocks.push(
      assetUrls.map((u, i) => `![screenshot-${i + 1}](${u})`).join('\n')
    );
  }

  return blocks.join('\n\n');
}
```

- [ ] **Step 2: Add `createIssue` to `src/background/linear-api.js`**

Append:

```js
/**
 * @param {{title: string, description: string, teamId: string, projectId: string}} input
 * @returns {Promise<{identifier: string, url: string}>}
 */
export async function createIssue({ title, description, teamId, projectId }) {
  const data = await graphql(
    `
      mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier url }
        }
      }
    `,
    { input: { title, description, teamId, projectId } }
  );

  if (!data.issueCreate?.success || !data.issueCreate.issue) {
    throw new LinearError('Linear did not create the issue.', 'GRAPHQL');
  }
  return {
    identifier: data.issueCreate.issue.identifier,
    url: data.issueCreate.issue.url,
  };
}
```

- [ ] **Step 3: Expose both on the dev hook**

In `src/background/service-worker.js`:

```js
import {
  fetchViewer,
  fetchProjects,
  uploadImage,
  createIssue,
  LinearError,
} from './linear-api.js';
import { buildDescription } from '../lib/description.js';
```

```js
// @ts-ignore - augmenting the worker global for debugging
self.__debug = {
  fetchViewer,
  fetchProjects,
  uploadImage,
  createIssue,
  buildDescription,
  TINY_PNG,
};
```

- [ ] **Step 4: Type-check**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Verify description formatting**

Run: (manual) In the service worker console:

```js
self.__debug.buildDescription({
  description: '  Button does nothing.  ',
  pageUrl: 'https://example.com/x',
  assetUrls: ['https://a/1.png', 'https://a/2.png'],
})
```

Expected exactly:

```
Button does nothing.

---

**Page:** https://example.com/x

![screenshot-1](https://a/1.png)
![screenshot-2](https://a/2.png)
```

Then check the empty-description case:

```js
self.__debug.buildDescription({ description: '', pageUrl: 'https://e.com', assetUrls: [] })
```

Expected exactly `---\n\n**Page:** https://e.com` — no leading blank lines.

- [ ] **Step 6: Create a real issue end to end**

This writes to the user's real Linear workspace. Pick a throwaway project.

Run: (manual) In the service worker console:

```js
const projects = await self.__debug.fetchProjects();
const p = projects[0];
const asset = await self.__debug.uploadImage(self.__debug.TINY_PNG, 'test.png');
await self.__debug.createIssue({
  title: 'Quick capture smoke test',
  description: self.__debug.buildDescription({
    description: 'Ignore me.',
    pageUrl: 'https://example.com/test',
    assetUrls: [asset],
  }),
  teamId: p.teams[0].id,
  projectId: p.id,
});
```

Expected: `{identifier: 'ABC-123', url: 'https://linear.app/...'}`. Open the URL and confirm the description shows the page line and the image renders inline in the body.

- [ ] **Step 7: Delete the test issue in Linear**

Run: (manual) Open the issue created in Step 6 and delete it.
Expected: the workspace is left clean. Do not skip — later tasks create more test issues, and untracked smoke-test tickets accumulate fast.

- [ ] **Step 8: Commit**

```bash
git add src/
git commit -m "feat: build issue description markdown and create Linear issues"
```

---

### Task 5: Activation and overlay mounting

First UI. Clicking the toolbar icon mounts a shadow-DOM overlay, or explains why it cannot.

**Files:**
- Create: `src/content/bootstrap.js`
- Create: `src/content/app.js`
- Modify: `src/background/service-worker.js`

**Interfaces:**
- Consumes: `{type:'PING'}`, `{type:'OPEN_OPTIONS'}` from Task 1.
- Produces:
  - `service-worker.js` — `chrome.action.onClicked` handler; message types `{type:'GET_INIT', origin}` (returns `{hasKey}` for now, extended in Task 6) and `{type:'OPEN_URL', url}`.
  - `content/app.js` — module-level `mount()`, `show()`, `hide()`, `unmount()`; responds to `{type:'PING'}` and `{type:'SHOW'}` from the worker.

- [ ] **Step 1: Add the action handler to `src/background/service-worker.js`**

Append:

```js
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
```

- [ ] **Step 2: Add the new message cases**

Inside `handleMessage`'s `switch`, before `default:`:

```js
    case 'GET_INIT': {
      const key = await getApiKey();
      return { ok: true, hasKey: Boolean(key) };
    }

    case 'OPEN_URL':
      await chrome.tabs.create({ url: msg.url });
      return { ok: true };
```

And add `getApiKey` to the storage import at the top of the file:

```js
import { getApiKey } from '../lib/storage.js';
```

- [ ] **Step 3: Create `src/content/bootstrap.js`**

```js
/**
 * The only file injected by chrome.scripting. It exists so the rest of the
 * overlay can use ordinary ES imports: executeScript cannot inject modules,
 * but a dynamic import of a web-accessible resource works, and runs in the
 * content script's isolated world rather than the page's.
 */
(async () => {
  try {
    const mod = await import(chrome.runtime.getURL('content/app.js'));
    mod.mount();
  } catch (err) {
    console.error('[linear-bug-capture] failed to load overlay', err);
  }
})();
```

If a site's CSP blocks the dynamic import (rare — the isolated world is normally exempt), the fallback is to list every content module in `executeScript`'s `files` array as classic scripts sharing a `window.__linearBugCapture` namespace. Only do this if you actually observe the failure.

- [ ] **Step 4: Create `src/content/app.js`**

For this task the overlay renders only the needs-key state and a placeholder, so mounting, isolation, and dismissal can be verified before the form exists. Task 6 replaces `render()`.

```js
/**
 * Overlay lifecycle and state machine. Runs in the content script's
 * isolated world. Holds no API key and makes no network calls — everything
 * goes through the service worker.
 * @module app
 */

const HOST_ID = 'linear-bug-quick-capture-host';

/** @type {HTMLDivElement|null} */
let host = null;
/** @type {ShadowRoot|null} */
let root = null;

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.panel {
  position: fixed; top: 16px; right: 16px; width: 340px;
  background: #fff; color: #1b1b1f;
  border: 1px solid #e3e3e8; border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0,0,0,.18);
  padding: 14px; z-index: 2147483647;
}
.head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.title { font-weight: 600; }
.x { border: 0; background: transparent; cursor: pointer; font-size: 16px; line-height: 1; color: #6b6b76; }
button.primary { padding: 8px 12px; border: 0; border-radius: 6px; background: #5e6ad2; color: #fff; cursor: pointer; font: inherit; }
p { margin: 0 0 10px; color: #6b6b76; }
`;

/** Remove the overlay entirely, including the document-level listener. */
export function unmount() {
  document.removeEventListener('keydown', onKeydown, true);
  host?.remove();
  host = null;
  root = null;
}

export function hide() {
  if (host) host.style.display = 'none';
}

export function show() {
  if (host) host.style.display = 'block';
}

/**
 * @param {{hasKey: boolean}} init
 */
function render(init) {
  if (!root) return;
  root.innerHTML = '';

  const panel = document.createElement('div');
  panel.className = 'panel';

  const head = document.createElement('div');
  head.className = 'head';
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = 'Report a bug';
  const close = document.createElement('button');
  close.className = 'x';
  close.textContent = '×';
  close.title = 'Close';
  close.addEventListener('click', hide);
  head.append(title, close);
  panel.append(head);

  if (!init.hasKey) {
    const p = document.createElement('p');
    p.textContent = 'Add your Linear API key to get started.';
    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = 'Open settings';
    btn.addEventListener('click', () =>
      chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' })
    );
    panel.append(p, btn);
  } else {
    const p = document.createElement('p');
    p.textContent = 'Form goes here.';
    panel.append(p);
  }

  root.append(panel);
}

/** Inject the overlay into the page. Idempotent. */
export async function mount() {
  if (host) {
    show();
    return;
  }

  host = document.createElement('div');
  host.id = HOST_ID;
  // Page CSS cannot reach into a shadow root, and `all: initial` on :host
  // stops inherited properties leaking in.
  root = host.attachShadow({ mode: 'open' });

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(CSS);
  root.adoptedStyleSheets = [sheet];

  document.documentElement.append(host);

  document.addEventListener('keydown', onKeydown, true);

  const init = await chrome.runtime.sendMessage({
    type: 'GET_INIT',
    origin: location.origin,
  });
  render({ hasKey: Boolean(init?.hasKey) });
}

/** @param {KeyboardEvent} e */
function onKeydown(e) {
  if (e.key === 'Escape' && host?.style.display !== 'none') hide();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'PING') {
    sendResponse({ ok: true });
    return;
  }
  if (msg?.type === 'SHOW') {
    // PING answers "this module is loaded", which is not the same as "the
    // overlay is mounted": a successful save auto-dismisses via unmount(),
    // leaving the module resident with host === null. show() would be a
    // silent no-op there and the icon would appear dead until a page reload,
    // so re-mount when there is nothing to show.
    if (host) show();
    else void mount();
    sendResponse({ ok: true });
  }
});
```

Note `adoptedStyleSheets` rather than an injected `<style>`: a strict page CSP can block inline styles, but constructed stylesheets in a shadow root are not affected.

- [ ] **Step 5: Type-check**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 6: Verify mounting, isolation, and the badge fallback**

Run: (manual) Reload the extension, then:
1. Open any ordinary site and click the toolbar icon. Expected: the panel appears top-right.
2. Press Escape. Expected: it hides. Click the icon again. Expected: it reappears without a second injection (check the page console for a duplicate-load error — there should be none).
3. Clear the key on the options page, reload the tab, click the icon. Expected: the needs-key state with a working **Open settings** button.
4. Re-save the key, reload the tab, click the icon. Expected: the "Form goes here." placeholder.
5. Open `chrome://extensions` and click the icon. Expected: a red `!` badge on the icon that clears after ~4 seconds, with a tooltip reading "Cannot capture a bug on this page". No error dialog.
6. Test on a site with a strict CSP — GitHub is a good one. Expected: the panel still renders, and the page console shows no `[linear-bug-capture] failed to load overlay` error.

- [ ] **Step 7: Commit**

```bash
git add src/
git commit -m "feat: mount shadow-DOM overlay on icon click with restricted-page fallback"
```

---

### Task 6: The bug form

**Files:**
- Create: `src/content/modal.js`
- Modify: `src/content/app.js`
- Modify: `src/background/service-worker.js`

**Interfaces:**
- Consumes: `GET_INIT` from Task 5; `fetchProjects`, `getCachedProjects`, `setCachedProjects`, `getStickyPrefs` from Task 2.
- Produces:
  - `service-worker.js` — `GET_INIT` now returns `{ok, hasKey, projects, lastProjectId, lastTeamId}`.
  - `content/modal.js` — `createModal(handlers): ModalController` where handlers are `{onTakeScreenshot, onSave, onDiscardDraft, onOpenOptions, onClose}` and the controller exposes `element: HTMLElement`, `getValues(): {title, description, projectId, teamId}`, `setValues(draft)`, `addImage(img: CapturedImage)`, `removeImage(index: number)`, `getImages(): CapturedImage[]`, `setBusy(label: string|null)`, `showToast(message: string, action?: {label, onClick})`, `showSuccess(identifier, url)`, `setFieldError(field, message)`.

- [ ] **Step 1: Extend `GET_INIT` in `src/background/service-worker.js`**

Replace the `GET_INIT` case with:

```js
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
```

Extend the storage import:

```js
import {
  getApiKey,
  getCachedProjects,
  setCachedProjects,
  getStickyPrefs,
} from '../lib/storage.js';
```

- [ ] **Step 2: Create `src/content/modal.js`**

```js
/**
 * The bug form UI. Pure view layer: it renders, collects values, and calls
 * handlers. It performs no network or storage access.
 * @module modal
 */

/** @typedef {import('../lib/types.js').CapturedImage} CapturedImage */
/** @typedef {import('../lib/types.js').Project} Project */

export const MAX_IMAGES = 5;

export const MODAL_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.panel {
  position: fixed; top: 16px; right: 16px; width: 340px;
  background: #fff; color: #1b1b1f;
  border: 1px solid #e3e3e8; border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0,0,0,.18);
  padding: 14px; z-index: 2147483647;
}
.head { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
.title { font-weight:600; }
.x { border:0; background:transparent; cursor:pointer; font-size:16px; line-height:1; color:#6b6b76; }
label { display:block; font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:#6b6b76; margin:10px 0 4px; }
input[type=text], textarea, select {
  width:100%; padding:7px 9px; border:1px solid #e3e3e8; border-radius:6px;
  background:#fff; color:#1b1b1f; font:inherit;
}
textarea { min-height:72px; resize:vertical; }
.err { color:#c0392b; font-size:12px; margin-top:4px; }
.hidden { display:none !important; }
.shots { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
.shot { position:relative; width:64px; height:44px; border:1px solid #e3e3e8; border-radius:4px; overflow:hidden; }
.shot canvas { width:100%; height:100%; display:block; object-fit:cover; }
.shot .rm {
  position:absolute; top:1px; right:1px; width:16px; height:16px; border:0;
  border-radius:50%; background:rgba(0,0,0,.65); color:#fff; cursor:pointer;
  font-size:11px; line-height:16px; padding:0;
}
.foot { display:flex; gap:8px; align-items:center; margin-top:14px; }
.foot .spacer { flex:1; }
button.primary { padding:8px 12px; border:0; border-radius:6px; background:#5e6ad2; color:#fff; cursor:pointer; font:inherit; }
button.primary:disabled { opacity:.55; cursor:default; }
button.ghost { padding:8px 10px; border:1px solid #e3e3e8; border-radius:6px; background:transparent; color:#1b1b1f; cursor:pointer; font:inherit; }
button.shot-btn { width:100%; margin-top:8px; padding:8px; border:1px dashed #c9c9d2; border-radius:6px; background:transparent; color:#1b1b1f; cursor:pointer; font:inherit; }
.toast {
  margin-top:12px; padding:9px 11px; border-radius:6px;
  background:#fdecea; color:#8e2b20; border:1px solid #f5c6c0; font-size:12px;
}
.toast button { margin-top:6px; }
.success { text-align:center; padding:18px 6px; }
.success .id { font-weight:600; font-size:15px; margin-bottom:6px; }
.success a { color:#5e6ad2; cursor:pointer; text-decoration:underline; }
p.note { margin:0 0 10px; color:#6b6b76; }
`;

/**
 * @typedef {Object} ModalHandlers
 * @property {() => void} onTakeScreenshot
 * @property {() => void} onSave
 * @property {() => void} onDiscardDraft
 * @property {() => void} onClose
 * @property {(url: string) => void} onOpenUrl
 * @property {() => void} onChange  Fired on any field edit (debounced by caller).
 */

/**
 * @param {ModalHandlers} handlers
 * @param {Project[]} projects
 * @param {{lastProjectId: string|null, lastTeamId: string|null}} prefs
 */
export function createModal(handlers, projects, prefs) {
  /** @type {CapturedImage[]} */
  let images = [];

  const panel = el('div', 'panel');

  // header
  const head = el('div', 'head');
  const title = el('span', 'title');
  title.textContent = 'Report a bug';
  const close = el('button', 'x');
  close.textContent = '×';
  close.title = 'Close';
  close.addEventListener('click', handlers.onClose);
  head.append(title, close);

  // body
  const body = el('div', 'body');

  const nameInput = /** @type {HTMLInputElement} */ (document.createElement('input'));
  nameInput.type = 'text';
  nameInput.placeholder = 'What is broken?';
  const nameErr = el('div', 'err hidden');

  const descInput = /** @type {HTMLTextAreaElement} */ (
    document.createElement('textarea')
  );
  descInput.placeholder = 'Steps to reproduce, expected vs actual…';

  const projectSelect = /** @type {HTMLSelectElement} */ (
    document.createElement('select')
  );
  const projectErr = el('div', 'err hidden');

  const teamLabel = el('label', 'team-label hidden');
  teamLabel.textContent = 'Team';
  const teamSelect = /** @type {HTMLSelectElement} */ (
    document.createElement('select')
  );
  teamSelect.classList.add('hidden');

  const noProjects = el('p', 'note hidden');
  noProjects.textContent =
    'No projects found. Your API key may be scoped to teams without projects.';

  projectSelect.append(optionEl('', 'Select a project…'));
  for (const p of projects) {
    projectSelect.append(
      optionEl(p.id, p.teams.length === 1 ? `${p.name} (${p.teams[0].key})` : p.name)
    );
  }
  if (!projects.length) {
    projectSelect.classList.add('hidden');
    noProjects.classList.remove('hidden');
  }

  /**
   * A project may span several teams, but an issue needs exactly one. Show
   * the team select only when the choice is genuinely ambiguous.
   */
  function syncTeamSelect() {
    const project = projects.find((p) => p.id === projectSelect.value);
    teamSelect.innerHTML = '';

    if (!project || project.teams.length <= 1) {
      teamSelect.classList.add('hidden');
      teamLabel.classList.add('hidden');
      return;
    }
    for (const t of project.teams) {
      teamSelect.append(optionEl(t.id, `${t.name} (${t.key})`));
    }
    const sticky = project.teams.find((t) => t.id === prefs.lastTeamId);
    teamSelect.value = sticky ? sticky.id : project.teams[0].id;
    teamSelect.classList.remove('hidden');
    teamLabel.classList.remove('hidden');
  }

  projectSelect.addEventListener('change', () => {
    syncTeamSelect();
    handlers.onChange();
  });
  teamSelect.addEventListener('change', handlers.onChange);
  nameInput.addEventListener('input', handlers.onChange);
  descInput.addEventListener('input', handlers.onChange);

  if (prefs.lastProjectId && projects.some((p) => p.id === prefs.lastProjectId)) {
    projectSelect.value = prefs.lastProjectId;
  }
  syncTeamSelect();

  const shotBtn = el('button', 'shot-btn');
  shotBtn.textContent = 'Take screenshot';
  shotBtn.addEventListener('click', handlers.onTakeScreenshot);

  const shots = el('div', 'shots');

  body.append(
    labelEl('Bug name'), nameInput, nameErr,
    labelEl('Description'), descInput,
    labelEl('Project'), projectSelect, projectErr, noProjects,
    teamLabel, teamSelect,
    shotBtn, shots
  );

  // footer
  const foot = el('div', 'foot');
  const discard = el('button', 'ghost');
  discard.textContent = 'Discard draft';
  discard.addEventListener('click', handlers.onDiscardDraft);
  const spacer = el('div', 'spacer');
  const save = /** @type {HTMLButtonElement} */ (el('button', 'primary'));
  save.textContent = 'Save bug';
  save.addEventListener('click', handlers.onSave);
  foot.append(discard, spacer, save);

  const toastSlot = el('div', 'toast-slot');

  panel.append(head, body, foot, toastSlot);

  function renderShots() {
    shots.innerHTML = '';
    images.forEach((img, i) => {
      const wrap = el('div', 'shot');
      const canvas = /** @type {HTMLCanvasElement} */ (
        document.createElement('canvas')
      );
      canvas.width = 64;
      canvas.height = 44;
      // Draw via ImageBitmap rather than <img src="data:...">: content-script
      // DOM is still subject to the page's CSP, and a strict img-src would
      // blank a data-URI image. A canvas loads no URL at all.
      fetch(img.dataUrl)
        .then((r) => r.blob())
        .then(createImageBitmap)
        .then((bmp) => {
          canvas.getContext('2d')?.drawImage(bmp, 0, 0, 64, 44);
        })
        .catch(() => {});
      const rm = el('button', 'rm');
      rm.textContent = '×';
      rm.title = 'Remove';
      rm.addEventListener('click', () => {
        images.splice(i, 1);
        renderShots();
        handlers.onChange();
      });
      wrap.append(canvas, rm);
      shots.append(wrap);
    });
    shotBtn.disabled = images.length >= MAX_IMAGES;
    shotBtn.textContent =
      images.length >= MAX_IMAGES
        ? `Screenshot limit reached (${MAX_IMAGES})`
        : images.length
          ? 'Take another screenshot'
          : 'Take screenshot';
  }

  return {
    element: panel,

    getValues() {
      const project = projects.find((p) => p.id === projectSelect.value);
      const teamId =
        project && project.teams.length === 1
          ? project.teams[0].id
          : teamSelect.value || null;
      return {
        title: nameInput.value.trim(),
        description: descInput.value,
        projectId: projectSelect.value || null,
        teamId,
      };
    },

    /** @param {import('../lib/types.js').Draft} draft */
    setValues(draft) {
      nameInput.value = draft.title ?? '';
      descInput.value = draft.description ?? '';
      if (draft.projectId && projects.some((p) => p.id === draft.projectId)) {
        projectSelect.value = draft.projectId;
      }
      syncTeamSelect();
      if (draft.teamId) {
        const has = Array.from(teamSelect.options).some(
          (o) => o.value === draft.teamId
        );
        if (has) teamSelect.value = draft.teamId;
      }
      images = (draft.images ?? []).slice(0, MAX_IMAGES);
      renderShots();
    },

    /** @param {CapturedImage} img */
    addImage(img) {
      if (images.length >= MAX_IMAGES) return;
      images.push(img);
      renderShots();
    },

    getImages: () => images,

    clear() {
      nameInput.value = '';
      descInput.value = '';
      images = [];
      renderShots();
      nameErr.classList.add('hidden');
      projectErr.classList.add('hidden');
      toastSlot.innerHTML = '';
    },

    /** @param {string|null} label null re-enables the button. */
    setBusy(label) {
      save.disabled = Boolean(label);
      save.textContent = label ?? 'Save bug';
    },

    /**
     * @param {'title'|'project'} field
     * @param {string|null} message
     */
    setFieldError(field, message) {
      const node = field === 'title' ? nameErr : projectErr;
      node.textContent = message ?? '';
      node.classList.toggle('hidden', !message);
    },

    /**
     * @param {string} message
     * @param {{label: string, onClick: () => void}} [action]
     */
    showToast(message, action) {
      toastSlot.innerHTML = '';
      const toast = el('div', 'toast');
      toast.textContent = message;
      if (action) {
        const btn = el('button', 'ghost');
        btn.textContent = action.label;
        btn.addEventListener('click', action.onClick);
        toast.append(document.createElement('br'), btn);
      }
      toastSlot.append(toast);
    },

    clearToast() {
      toastSlot.innerHTML = '';
    },

    /**
     * @param {string} identifier
     * @param {string} url
     */
    showSuccess(identifier, url) {
      panel.innerHTML = '';
      const box = el('div', 'success');
      const id = el('div', 'id');
      id.textContent = `${identifier} created`;
      const link = el('a');
      link.textContent = 'Open in Linear';
      link.addEventListener('click', () => handlers.onOpenUrl(url));
      box.append(id, link);
      panel.append(box);
    },
  };
}

/**
 * @param {string} tag
 * @param {string} [cls]
 * @returns {HTMLElement}
 */
function el(tag, cls) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

/** @param {string} text */
function labelEl(text) {
  const node = document.createElement('label');
  node.textContent = text;
  return node;
}

/**
 * @param {string} value
 * @param {string} text
 */
function optionEl(value, text) {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = text;
  return node;
}
```

- [ ] **Step 3: Rewrite `src/content/app.js` to use the modal**

Replace the whole file:

```js
/**
 * Overlay lifecycle and state machine. Runs in the content script's
 * isolated world. Holds no API key and makes no network calls.
 * @module app
 */

import { createModal, MODAL_CSS } from './modal.js';

const HOST_ID = 'linear-bug-quick-capture-host';

/** @type {HTMLDivElement|null} */
let host = null;
/** @type {ShadowRoot|null} */
let root = null;
/** @type {ReturnType<typeof createModal>|null} */
let modal = null;

export function unmount() {
  document.removeEventListener('keydown', onKeydown, true);
  host?.remove();
  host = null;
  root = null;
  modal = null;
}

export function hide() {
  if (host) host.style.display = 'none';
}

export function show() {
  if (host) host.style.display = 'block';
}

/** @param {KeyboardEvent} e */
function onKeydown(e) {
  if (e.key === 'Escape' && host && host.style.display !== 'none') hide();
}

/** Simple needs-key / error panel used when the form cannot be shown. */
function renderNotice(text, actionLabel, onAction) {
  if (!root) return;
  root.innerHTML = '';
  const panel = document.createElement('div');
  panel.className = 'panel';
  const head = document.createElement('div');
  head.className = 'head';
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = 'Report a bug';
  const close = document.createElement('button');
  close.className = 'x';
  close.textContent = '×';
  close.addEventListener('click', hide);
  head.append(title, close);
  const p = document.createElement('p');
  p.className = 'note';
  p.textContent = text;
  panel.append(head, p);
  if (actionLabel) {
    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = actionLabel;
    btn.addEventListener('click', onAction);
    panel.append(btn);
  }
  root.append(panel);
}

export async function mount() {
  if (host) {
    show();
    return;
  }

  host = document.createElement('div');
  host.id = HOST_ID;
  root = host.attachShadow({ mode: 'open' });

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(MODAL_CSS);
  root.adoptedStyleSheets = [sheet];

  document.documentElement.append(host);
  document.addEventListener('keydown', onKeydown, true);

  const init = await chrome.runtime.sendMessage({
    type: 'GET_INIT',
    origin: location.origin,
  });

  if (!init?.hasKey) {
    renderNotice('Add your Linear API key to get started.', 'Open settings', () =>
      chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' })
    );
    return;
  }
  if (!init.ok) {
    renderNotice(init.message ?? 'Could not load projects from Linear.', 'Open settings', () =>
      chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' })
    );
    return;
  }

  modal = createModal(
    {
      onClose: hide,
      onTakeScreenshot: () => {
        // Wired up in Task 7.
      },
      onSave: () => {
        // Wired up in Task 8.
      },
      onDiscardDraft: () => {
        modal?.clear();
      },
      onOpenUrl: (url) => chrome.runtime.sendMessage({ type: 'OPEN_URL', url }),
      onChange: () => {
        // Wired up in Task 9.
      },
    },
    init.projects ?? [],
    { lastProjectId: init.lastProjectId, lastTeamId: init.lastTeamId }
  );

  root.innerHTML = '';
  root.append(modal.element);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'PING') {
    sendResponse({ ok: true });
    return;
  }
  if (msg?.type === 'SHOW') {
    // PING answers "this module is loaded", which is not the same as "the
    // overlay is mounted": a successful save auto-dismisses via unmount(),
    // leaving the module resident with host === null. show() would be a
    // silent no-op there and the icon would appear dead until a page reload,
    // so re-mount when there is nothing to show.
    if (host) show();
    else void mount();
    sendResponse({ ok: true });
  }
});
```

- [ ] **Step 4: Type-check**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Verify the form and the conditional team select**

Run: (manual) Reload the extension, reload a test page, click the icon.
1. Expected: Bug name, Description, Project select populated with real project names, a **Take screenshot** button, and a footer with **Discard draft** / **Save bug**.
2. Select a single-team project. Expected: no Team select appears, and the project's option shows its team key in parentheses.
3. Select the multi-team project identified in Task 2 Step 6. Expected: a Team select appears listing exactly that project's teams. (If no multi-team project exists in the workspace, create one in Linear now — this path cannot ship unverified.)
4. Switch back to a single-team project. Expected: the Team select disappears again.
5. Close and reopen the overlay. Expected: the project select defaults to the sticky project if one was previously saved; on a fresh install it shows "Select a project…".

- [ ] **Step 6: Verify the no-projects state**

Run: (manual) Temporarily change `fetchProjects` to `return [];`, reload, reopen the overlay.
Expected: the "No projects found…" note appears in place of the project select. Then revert the change.

- [ ] **Step 7: Commit**

```bash
git add src/
git commit -m "feat: bug form with project select and conditional team select"
```

---

### Task 7: Region selection, capture, and crop

**Files:**
- Create: `src/lib/crop.js`
- Create: `src/content/region-select.js`
- Modify: `src/content/app.js`
- Modify: `src/background/service-worker.js`

**Interfaces:**
- Consumes: `createModal().addImage()` from Task 6.
- Produces:
  - `lib/crop.js` — `MIN_DRAG_PX: number`, `normalizeDragRect(start, end): {left, top, width, height}`, `computeCropRect(rect, dpr, imageWidth, imageHeight): {sx, sy, sw, sh}`.
  - `content/region-select.js` — `selectRegion(): Promise<CapturedImage|null>` resolving `null` on cancel.
  - `service-worker.js` — message `{type:'CAPTURE_VIEWPORT'}` returning `{ok, dataUrl}`.

- [ ] **Step 1: Create `src/lib/crop.js`**

```js
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
```

- [ ] **Step 2: Add the capture message to `src/background/service-worker.js`**

Add to the `switch`, before `default:`:

```js
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
```

- [ ] **Step 3: Create `src/content/region-select.js`**

```js
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
```

- [ ] **Step 4: Wire it into `src/content/app.js`**

Add the import:

```js
import { selectRegion } from './region-select.js';
```

Replace the `onTakeScreenshot` handler in the `createModal` call:

```js
      onTakeScreenshot: async () => {
        modal?.clearToast();
        hide(); // keeps modal state in memory; does not unmount
        const image = await selectRegion();
        show();
        if (image) modal?.addImage(image);
      },
```

- [ ] **Step 5: Type-check**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 6: Verify capture correctness**

Run: (manual) Reload the extension and the test page. Click the icon, then **Take screenshot**.
1. Expected: the modal disappears, the page dims, the cursor is a crosshair, and a hint appears.
2. Drag a region over some recognisable text. Expected: a live rectangle with a `W × H` readout, then on release the modal returns with a thumbnail.
3. **Open the thumbnail's underlying data URL** (in the page console: `document.getElementById('linear-bug-quick-capture-host')` is closed to inspection, so instead verify visually at Task 8 when the image lands in Linear — or temporarily `console.log` the `dataUrl` from `onTakeScreenshot` and paste it into a new tab). Expected: **the image shows the page content with no dimming and no selection rectangle.** This is the single most important check in the plan.
4. Press **Take screenshot**, then Escape. Expected: selection cancels, the modal returns, no thumbnail added.
5. Press **Take screenshot**, then single-click without dragging. Expected: cancels, no thumbnail.
6. Add 5 screenshots. Expected: the button disables and reads "Screenshot limit reached (5)". Remove one with its ✕. Expected: the button re-enables.
7. Try to scroll during selection. Expected: the page does not scroll.

- [ ] **Step 7: Verify zoom and scroll accuracy**

Run: (manual) For each of 80%, 100%, 125%, and 200% browser zoom (Cmd/Ctrl +/-), and then once on a page scrolled well down:
- Select a tight region around a specific, identifiable word.
- Check the resulting thumbnail (or the logged data URL) contains that word and not its neighbours.

Expected: the crop matches the selection at every zoom level and when scrolled. If it is offset or scaled, the `devicePixelRatio` assumption in `computeCropRect` is wrong for that case — log `window.devicePixelRatio`, `window.innerWidth`, and `bitmap.width` and reconcile them before proceeding.

- [ ] **Step 8: Commit**

```bash
git add src/
git commit -m "feat: drag-to-select region capture with DPR-correct cropping"
```

---

### Task 8: Save flow

**Files:**
- Modify: `src/background/service-worker.js`
- Modify: `src/content/app.js`

**Interfaces:**
- Consumes: `uploadImage`, `createIssue` from Tasks 3–4; `buildDescription` from Task 4; `setStickyPrefs` from Task 2; modal controller from Task 6.
- Produces: `service-worker.js` — a `chrome.runtime.onConnect` handler for the port named `create-issue`, accepting `{type:'CREATE_ISSUE', payload: CreatePayload}` and emitting `{type:'PROGRESS', phase:'upload', index, total}`, `{type:'DONE', identifier, url}`, or `{type:'ERROR', message, code}`.

- [ ] **Step 1: Add the port handler to `src/background/service-worker.js`**

Append. Note the deliberate `for` loop rather than `Promise.all` — that is the 60-second-expiry constraint made concrete.

```js
/**
 * Issue creation runs over a port rather than a one-shot message so upload
 * progress can stream back to the modal.
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'create-issue') return;

  port.onMessage.addListener(async (msg) => {
    if (msg?.type !== 'CREATE_ISSUE') return;
    /** @type {import('../lib/types.js').CreatePayload} */
    const payload = msg.payload;

    try {
      /** @type {string[]} */
      const assetUrls = [];

      // STRICTLY SEQUENTIAL. Each signed upload URL expires 60s after it is
      // issued, so preparing the next upload before finishing this one can
      // expire the earlier URL. Do not convert this to Promise.all.
      for (let i = 0; i < payload.images.length; i++) {
        port.postMessage({
          type: 'PROGRESS',
          phase: 'upload',
          index: i + 1,
          total: payload.images.length,
        });
        const url = await uploadImage(
          payload.images[i].dataUrl,
          `screenshot-${i + 1}.png`
        );
        assetUrls.push(url);
      }

      port.postMessage({ type: 'PROGRESS', phase: 'create', index: 0, total: 0 });

      const description = buildDescription({
        description: payload.description,
        pageUrl: payload.pageUrl,
        assetUrls,
      });

      const issue = await createIssue({
        title: payload.title,
        description,
        teamId: payload.teamId,
        projectId: payload.projectId,
      });

      await setStickyPrefs(payload.projectId, payload.teamId);
      port.postMessage({ type: 'DONE', identifier: issue.identifier, url: issue.url });
    } catch (err) {
      const e = /** @type {LinearError} */ (err);
      port.postMessage({
        type: 'ERROR',
        message: e.message ?? 'Something went wrong.',
        code: e.code ?? 'GRAPHQL',
      });
    }
  });
});
```

Extend the storage import to include `setStickyPrefs`:

```js
import {
  getApiKey,
  getCachedProjects,
  setCachedProjects,
  getStickyPrefs,
  setStickyPrefs,
} from '../lib/storage.js';
```

- [ ] **Step 2: Wire the save handler in `src/content/app.js`**

Replace the `onSave` handler:

```js
      onSave: () => {
        if (!modal) return;
        modal.clearToast();
        const values = modal.getValues();

        modal.setFieldError('title', values.title ? null : 'Give the bug a name.');
        modal.setFieldError('project', values.projectId ? null : 'Pick a project.');
        if (!values.title || !values.projectId || !values.teamId) return;

        modal.setBusy('Saving…');

        const port = chrome.runtime.connect({ name: 'create-issue' });

        port.onMessage.addListener((msg) => {
          if (msg.type === 'PROGRESS') {
            modal?.setBusy(
              msg.phase === 'upload'
                ? `Uploading ${msg.index} of ${msg.total}…`
                : 'Creating issue…'
            );
            return;
          }
          if (msg.type === 'DONE') {
            port.disconnect();
            modal?.showSuccess(msg.identifier, msg.url);
            setTimeout(unmount, 3000);
            return;
          }
          if (msg.type === 'ERROR') {
            port.disconnect();
            modal?.setBusy(null);
            // Field values are untouched, so the user can fix and retry.
            modal?.showToast(
              msg.message,
              msg.code === 'AUTH'
                ? {
                    label: 'Open settings',
                    onClick: () =>
                      chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' }),
                  }
                : undefined
            );
          }
        });

        port.onDisconnect.addListener(() => {
          // Fires if the worker was terminated mid-save.
          if (modal) modal.setBusy(null);
        });

        port.postMessage({
          type: 'CREATE_ISSUE',
          payload: {
            title: values.title,
            description: values.description,
            pageUrl: location.href,
            projectId: values.projectId,
            teamId: values.teamId,
            images: modal.getImages(),
          },
        });
      },
```

- [ ] **Step 3: Type-check**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 4: Verify a full successful save**

Run: (manual) Reload the extension and the test page. Fill in a name and description, pick a project, take two screenshots, click **Save bug**.
Expected: the button shows `Uploading 1 of 2…`, `Uploading 2 of 2…`, `Creating issue…`, then a success panel reading `ABC-123 created` with an **Open in Linear** link. The panel disappears after about 3 seconds.

Click the link before it dismisses on a second run. Expected: a new tab opens the issue.

In Linear, confirm: the title matches, the description shows your text, then `---`, then the `**Page:**` line with the correct URL, then **both screenshots rendering inline** and showing the regions you selected with no dimming.

Delete the test issue.

- [ ] **Step 5: Verify validation**

Run: (manual) Reopen the overlay. Click **Save bug** with everything blank.
Expected: "Give the bug a name." under the name field and "Pick a project." under the project field. No network request (check the service worker's Network tab).

- [ ] **Step 6: Verify the error path preserves the form**

Run: (manual) On the options page, save a deliberately bad key (`lin_api_bogus`). Reopen the overlay, fill in the form, take a screenshot, and click **Save bug**.
Expected: a red toast reading that Linear rejected the API key, with an **Open settings** button. **The name, description, project, and thumbnail are all still there**, and **Save bug** is clickable again.

Now restore the good key on the options page and click **Save bug** again in the same overlay.
Expected: it succeeds. Delete the test issue.

- [ ] **Step 7: Commit**

```bash
git add src/
git commit -m "feat: create issues over a port with sequential uploads and progress"
```

---

### Task 9: Per-origin drafts

**Files:**
- Modify: `src/lib/storage.js`
- Modify: `src/background/service-worker.js`
- Modify: `src/content/app.js`

**Interfaces:**
- Consumes: modal `getValues`/`getImages`/`setValues`/`clear` from Task 6.
- Produces:
  - `storage.js` — `getDraft(origin): Promise<Draft|null>`, `setDraft(origin, draft): Promise<{ok: boolean, reason?: string}>`, `clearDraft(origin): Promise<void>`, `clearAllDrafts(): Promise<void>`.
  - `service-worker.js` — messages `{type:'SAVE_DRAFT', origin, draft}` and `{type:'DISCARD_DRAFT', origin}`; `GET_INIT` additionally returns `draft`.

- [ ] **Step 1: Add draft functions to `src/lib/storage.js`**

Append:

```js
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
```

- [ ] **Step 2: Add draft messages to `src/background/service-worker.js`**

Extend the storage import:

```js
import {
  getApiKey,
  getCachedProjects,
  setCachedProjects,
  getStickyPrefs,
  setStickyPrefs,
  getDraft,
  setDraft,
  clearDraft,
} from '../lib/storage.js';
```

Add to the `switch`, before `default:`:

```js
    case 'SAVE_DRAFT': {
      const res = await setDraft(msg.origin, msg.draft);
      return { ok: res.ok, reason: res.reason };
    }

    case 'DISCARD_DRAFT':
      await clearDraft(msg.origin);
      return { ok: true };
```

In the `GET_INIT` case, add the draft to the successful return. Replace its final `return` with:

```js
      const draft = await getDraft(msg.origin);
      return {
        ok: true,
        hasKey: true,
        projects,
        lastProjectId: prefs.lastProjectId,
        lastTeamId: prefs.lastTeamId,
        draft,
      };
```

In the port handler's success path, clear the draft. After the `setStickyPrefs` call and before `port.postMessage({type:'DONE'...})`, add:

```js
      await clearDraft(new URL(payload.pageUrl).origin);
```

- [ ] **Step 3: Wire drafts into `src/content/app.js`**

Add near the top, after the other module state:

```js
const DRAFT_DEBOUNCE_MS = 300;
/** @type {ReturnType<typeof setTimeout>|undefined} */
let draftTimer;

function scheduleDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(async () => {
    if (!modal) return;
    const values = modal.getValues();
    const res = await chrome.runtime.sendMessage({
      type: 'SAVE_DRAFT',
      origin: location.origin,
      draft: {
        title: values.title,
        description: values.description,
        projectId: values.projectId,
        teamId: values.teamId,
        images: modal.getImages(),
        updatedAt: Date.now(),
      },
    });
    if (res && res.ok === false && res.reason === 'too-large') {
      modal.showToast(
        'Too many or too large screenshots to keep a draft. Save the bug now, or remove a screenshot.'
      );
    }
  }, DRAFT_DEBOUNCE_MS);
}
```

Replace the `onChange` and `onDiscardDraft` handlers:

```js
      onDiscardDraft: async () => {
        clearTimeout(draftTimer);
        await chrome.runtime.sendMessage({
          type: 'DISCARD_DRAFT',
          origin: location.origin,
        });
        modal?.clear();
      },
      onOpenUrl: (url) => chrome.runtime.sendMessage({ type: 'OPEN_URL', url }),
      onChange: scheduleDraftSave,
```

After `root.append(modal.element);` at the end of `mount()`, restore any draft:

```js
  if (init.draft) modal.setValues(init.draft);
```

And in `onTakeScreenshot`, persist after adding an image so a capture survives a close. Change its body's last line to:

```js
        if (image) {
          modal?.addImage(image);
          scheduleDraftSave();
        }
```

- [ ] **Step 4: Type-check**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Verify draft persistence and origin scoping**

Run: (manual) Reload the extension.
1. On `https://example.com`, open the overlay, type a name and description, take one screenshot. Press Escape to close.
2. Click the icon again. Expected: name, description, and thumbnail all restored.
3. Open a **second tab** on `https://example.com` and click the icon. Expected: the same draft is restored there.
4. Open a tab on a **different domain** and click the icon. Expected: an empty form. This is the important negative check — the captured URL belongs to the origin the draft was started on, so drafts must not cross domains.
5. Back on `https://example.com`, click **Discard draft**. Expected: the form empties. Close and reopen. Expected: still empty.
6. Rebuild a draft, then complete a successful save. Reopen the overlay. Expected: empty — a successful save clears the draft. Delete the test issue.

- [ ] **Step 6: Verify drafts never touch disk**

Run: (manual) With a draft holding a screenshot, quit Chrome entirely and reopen it. Navigate back to the same origin and click the icon.
Expected: an empty form. `chrome.storage.session` is memory-only, which is the whole point — screenshots of whatever the user was looking at must not persist to the profile directory.

- [ ] **Step 7: Commit**

```bash
git add src/
git commit -m "feat: per-origin session drafts with LRU eviction and discard"
```

---

### Task 10: Icons, debug-hook gating, and QA checklist

**Files:**
- Create: `scripts/generate-icons.mjs`
- Create: `src/icons/icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png`
- Create: `docs/qa-checklist.md`
- Modify: `src/manifest.json`
- Modify: `src/background/service-worker.js`

**Interfaces:**
- Consumes: everything prior.
- Produces: no new runtime interfaces.

- [ ] **Step 1: Create `scripts/generate-icons.mjs`**

Node's built-in `zlib` is enough to write a valid PNG, so this needs no dependency and no image tooling. The mark is a rounded indigo square with a white crosshair, echoing the selection cursor.

```js
/**
 * Generate the extension's PNG icons with no external dependencies.
 * Usage: node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'icons');
const SIZES = [16, 32, 48, 128];

const BG = [94, 106, 210, 255]; // #5e6ad2
const FG = [255, 255, 255, 255];

/** @param {number} size */
function pixels(size) {
  const radius = size * 0.22;
  const bar = Math.max(1, Math.round(size * 0.08));
  const inset = Math.round(size * 0.22);
  const mid = size / 2;
  const rows = [];

  for (let y = 0; y < size; y++) {
    const row = [0]; // PNG filter type 0 for each scanline
    for (let x = 0; x < size; x++) {
      const inRounded =
        insideRoundedRect(x + 0.5, y + 0.5, size, radius);
      if (!inRounded) {
        row.push(0, 0, 0, 0);
        continue;
      }
      const onVertical =
        Math.abs(x + 0.5 - mid) < bar / 2 && y >= inset && y <= size - inset;
      const onHorizontal =
        Math.abs(y + 0.5 - mid) < bar / 2 && x >= inset && x <= size - inset;
      row.push(...(onVertical || onHorizontal ? FG : BG));
    }
    rows.push(Buffer.from(row));
  }
  return Buffer.concat(rows);
}

function insideRoundedRect(x, y, size, r) {
  // Clamping to the inner rect makes dx/dy zero everywhere except the four
  // corner zones, so this single distance test covers the whole shape.
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/** @param {string} type @param {Buffer} data */
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

let TABLE = null;
function crc32(buf) {
  if (!TABLE) {
    TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

/** @param {number} size */
function png(size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(pixels(size))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  writeFileSync(join(OUT, `icon-${size}.png`), png(size));
  console.log(`wrote icon-${size}.png`);
}
```

- [ ] **Step 2: Generate the icons**

Run: `node scripts/generate-icons.mjs`
Expected: four `wrote icon-N.png` lines, and four files in `src/icons/`. Open `src/icons/icon-128.png` in Preview to confirm it is an indigo rounded square with a white crosshair and a transparent background.

- [ ] **Step 3: Register the icons in `src/manifest.json`**

Add two top-level keys:

```json
  "icons": {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
```

and give the action its own icons by replacing the `action` block:

```json
  "action": {
    "default_title": "Capture a Linear bug",
    "default_icon": {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png"
    }
  },
```

- [ ] **Step 4: Gate the debug hook in `src/background/service-worker.js`**

The hook was scaffolding for Tasks 2–4. Keep it available but off by default, so it is not part of the shipped surface. Replace the `self.__debug = {...}` assignment with:

```js
// Dev-only console hook. Off by default. To enable, run
//   chrome.storage.local.set({ debugHooks: true })
// then reload the extension and inspect the service worker.
chrome.storage.local.get('debugHooks').then((out) => {
  if (!out.debugHooks) return;
  // @ts-ignore - augmenting the worker global for debugging
  self.__debug = {
    fetchViewer,
    fetchProjects,
    uploadImage,
    createIssue,
    buildDescription,
    TINY_PNG,
  };
});
```

- [ ] **Step 5: Add "clear drafts" to the options page**

In `src/options/options.html`, inside the `<section>` after the existing button row, add:

```html
        <div class="row">
          <button id="clear-drafts" type="button" class="ghost">Clear all drafts</button>
          <button id="reset-sticky" type="button" class="ghost">Reset remembered project</button>
        </div>
```

In `src/options/options.js`, extend the import and add the handlers:

```js
import {
  getApiKey,
  setApiKey,
  clearApiKey,
  clearAllDrafts,
} from '../lib/storage.js';
```

```js
$('clear-drafts').addEventListener('click', async () => {
  await clearAllDrafts();
  setStatus('All drafts cleared.', 'ok');
});

$('reset-sticky').addEventListener('click', async () => {
  await chrome.storage.local.remove('stickyPrefs');
  setStatus('Remembered project reset.', 'ok');
});
```

- [ ] **Step 6: Type-check**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 7: Verify icons and the gated hook**

Run: (manual) Reload the extension.
1. Expected: the toolbar shows the indigo crosshair icon rather than the default puzzle piece.
2. Inspect the service worker and evaluate `self.__debug`. Expected: `undefined`.
3. In that console run `await chrome.storage.local.set({debugHooks: true})`, reload the extension, and re-inspect. Expected: `self.__debug` is an object. Set it back to `false` afterward.
4. On the options page, click **Clear all drafts** and **Reset remembered project**. Expected: a green confirmation for each, and reopening the overlay shows an empty form with no preselected project.

- [ ] **Step 8: Create `docs/qa-checklist.md`**

```markdown
# Manual QA Checklist

This project has no automated tests, by design (see the design doc, §10). The
substantive risk is concentrated in the overlay, the capture handshake, and the
live Linear contract, none of which a mocked-`fetch` unit test would catch.

Run this list before considering a change to the overlay, the capture path, or
the Linear client complete. Delete any test issues you create in Linear.

## Setup and key handling

- [ ] No key set: clicking the icon shows "Add your Linear API key to get
      started" and **Open settings** opens the options page.
- [ ] Bad key: **Test connection** shows a red error, and the message contains
      no key material.
- [ ] Good key: **Test connection** shows your name and workspace.
- [ ] **Clear key** empties the field, and the overlay reverts to the needs-key
      state.

## Project and team selection

- [ ] The project select is populated with real project names.
- [ ] A single-team project shows its team key in the option text and does
      **not** show a Team select.
- [ ] A multi-team project **does** show a Team select, listing only that
      project's teams.
- [ ] Switching from a multi-team to a single-team project hides the Team
      select again.
- [ ] The last-used project and team are preselected on reopen.

## Capture

- [ ] The modal disappears during selection and the page dims with a crosshair
      cursor.
- [ ] The live rectangle tracks the drag and the `W × H` readout is correct.
- [ ] **The saved screenshot contains no dimming and no selection rectangle.**
      (The most common regression in this codebase.)
- [ ] Dragging up-and-left works the same as down-and-right.
- [ ] Escape during selection cancels and returns to the form with no
      thumbnail added.
- [ ] A single click without dragging cancels.
- [ ] The page cannot be scrolled during selection.
- [ ] Five screenshots disables the button with "Screenshot limit reached (5)";
      removing one re-enables it.
- [ ] Removing a thumbnail with its ✕ removes the right one.

## Crop accuracy

Select a tight region around one identifiable word and confirm the result
contains that word and not its neighbours:

- [ ] 80% browser zoom
- [ ] 100% browser zoom
- [ ] 125% browser zoom
- [ ] 200% browser zoom
- [ ] A page scrolled well down
- [ ] A page in a small window and again maximised

## Save

- [ ] Blank form: **Save bug** shows both field errors and issues no network
      request.
- [ ] Successful save shows `Uploading 1 of N…`, then `Creating issue…`, then
      `ABC-123 created`.
- [ ] The success panel self-dismisses after about 3 seconds.
- [ ] **Open in Linear** opens the issue in a new tab.
- [ ] In Linear: the title is right, the description shows the user's text,
      then `---`, then a correct `**Page:**` URL, then every screenshot
      rendering inline.
- [ ] Bad key at save time: a toast appears with **Open settings**, and the
      name, description, project, and thumbnails are all preserved.
- [ ] After fixing the key, clicking **Save bug** again in the same overlay
      succeeds.
- [ ] Offline (devtools → Network → Offline): a connection error toast, form
      preserved.

## Drafts

- [ ] A draft restores after closing and reopening the overlay.
- [ ] A draft restores in a second tab on the **same** origin.
- [ ] A **different** origin shows an empty form.
- [ ] **Discard draft** empties the form and the draft does not come back.
- [ ] A successful save clears the draft.
- [ ] Quitting and reopening Chrome clears all drafts (they must never be
      written to disk).

## Page compatibility

- [ ] `chrome://extensions`: the icon shows a red `!` for ~4 seconds with the
      "Cannot capture a bug on this page" tooltip, and nothing crashes.
- [ ] A strict-CSP site (GitHub works well): the overlay renders, thumbnails
      draw, and the page console shows no overlay-load error.
- [ ] A page with aggressive global CSS (heavy `* { }` rules): the panel is
      not visually broken — shadow DOM plus `all: initial` should hold.
- [ ] A very long page scrolled to the bottom: the panel still sits at the top
      right of the viewport.
- [ ] Clicking the icon twice does not inject a second overlay.
```

- [ ] **Step 9: Run the full checklist**

Run: (manual) Work through `docs/qa-checklist.md` end to end.
Expected: every box checked. Fix anything that fails before committing. Delete every test issue created along the way.

- [ ] **Step 10: Commit**

```bash
git add scripts/ src/ docs/
git commit -m "feat: add generated icons, gate debug hooks, add manual QA checklist"
```

---

## Self-Review

**Spec coverage.** Every numbered spec section maps to a task:

| Spec | Task |
| --- | --- |
| §2 file layout, permissions | 1 (scaffold, manifest), 3 (host narrowing) |
| §2 message protocol | 1, 5, 6, 7, 8, 9 (introduced incrementally) |
| §3.1 connection test | 1 |
| §3.2 project list | 2 |
| §3.3 issue creation | 4 |
| §3.4 upload flow, sequential, verbatim headers | 3, 8 |
| §3.5 description format | 4 |
| §4.1 activation, badge fallback | 5 |
| §4.2 modal, shadow DOM, states | 5, 6, 8 |
| §4.3 region capture, RAF handshake, crop, canvas thumbs | 7 |
| §4.4 save, progress, error, success | 8 |
| §5 project/team resolution | 2 (data), 6 (UI) |
| §6 storage model, per-origin drafts, eviction | 2 (prefs/cache), 9 (drafts) |
| §7 error handling | 1, 6, 8 |
| §8 edge cases | 5, 7, 8, 9, 10 |
| §9 security, scoped-key guidance | 1 (options note), 10 (clear drafts) |
| §10 manual QA | 10 |
| §11 four API unknowns | 1 (#1), 2 (#4), 3 (#2, #3) |

**Type consistency.** `Project`/`Team`/`Draft`/`CapturedImage`/`CreatePayload` are defined once in Task 1's `types.js` and referenced by import path thereafter. Storage function names are stable across Tasks 1, 2, and 9. The modal controller's method names used in Tasks 7–9 (`addImage`, `getImages`, `setValues`, `clear`, `setBusy`, `showToast`, `clearToast`, `showSuccess`, `setFieldError`) all exist on the object returned in Task 6 Step 2. Port message shapes are identical between Task 8's producer and consumer.

**Known intentional deviations from the spec, carried forward:**
1. `package.json` and `node_modules/` exist solely for `tsc` type-checking of the JSDoc. The spec mentioned `tsconfig.json` but not the devDependencies that make it functional. Nothing is bundled and there is no build step.
2. Two options-page controls beyond the spec's list — **Clear all drafts** and **Reset remembered project** — added in Task 10 Step 5 because §7 of the spec calls for them.
