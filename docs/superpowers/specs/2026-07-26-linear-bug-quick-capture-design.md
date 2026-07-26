# Linear Bug Quick Capture — Design

**Date:** 2026-07-26
**Status:** Approved

A Chrome extension (Manifest V3) that turns whatever is on screen into a Linear bug ticket:
click the toolbar icon, fill three fields, drag-select one or more regions of the page, save.
The page URL is captured automatically. There is no backend — the extension talks to Linear's
GraphQL API directly, using a personal API key the user stores locally via an options page.

## 1. Goals and non-goals

### Goals

- Create a Linear issue with title, description, project, page URL, and zero or more
  region screenshots, in as few interactions as possible.
- Run entirely client-side. The only network destinations are Linear's API and Linear's
  upload storage.
- No always-on page UI. Activation is a toolbar icon click.
- Remember the last project used.

### Non-goals

- No OAuth. Personal API key only.
- No assignee, priority, label, status, estimate, or cycle fields. Title, description,
  project, and team are the whole form.
- No full-page or scrolling capture. Region-of-viewport only.
- No automated tests (see §10).
- No keyboard shortcut.
- No capture of page title, console errors, or environment metadata. URL only.

## 2. Architecture

Three execution contexts with one hard rule: **only the service worker talks to Linear.**

This is not stylistic. Linear's upload URLs are pre-signed Google Cloud Storage URLs whose
signature covers headers like `x-goog-content-length-range`. A page or content-script `fetch`
cannot send those — they are not CORS-safelisted, so the browser would strip them or fail
preflight, and the PUT returns 403. An extension service worker with matching
`host_permissions` bypasses CORS entirely. Keeping all Linear traffic there also means the API
key never enters the page's world.

```
src/                              <- load this directory unpacked
  manifest.json
  background/
    service-worker.js             action.onClicked, message router, injection
    linear-api.js                 GraphQL client + upload sequence
  content/
    bootstrap.js                  injected shim; dynamic-imports app.js as a module
    app.js                        state machine: needs-key | form | saving | success
    modal.js                      form UI, toast, thumbnails
    region-select.js              drag-to-select, capture handshake, crop
  lib/
    storage.js                    api key, sticky prefs, per-origin drafts, project cache
    crop.js                       DPR/rect math
    description.js                markdown builder
    types.js                      JSDoc typedefs shared across modules
  options/
    options.html
    options.js
    options.css
  icons/
    icon-16.png icon-32.png icon-48.png icon-128.png
docs/
  superpowers/specs/              this document
  qa-checklist.md                 manual verification script
tsconfig.json                     checkJs only; no build output
```

`tsconfig.json` sits at the repository root because that is the only place TypeScript resolves
it from. It exists solely to type-check the JSDoc annotations (`checkJs: true`, `noEmit: true`)
and produces no build artifacts. `src/` is loaded directly by Chrome; there is no build step.

Content scripts are split three ways so that no single file owns both the form and the
selector. `bootstrap.js` is what `chrome.scripting.executeScript` injects; it immediately does
`await import(chrome.runtime.getURL('content/app.js'))`, which lets the remaining content
modules use ordinary ES `import`. This requires `web_accessible_resources` for `content/*` and
`lib/*` — those files contain UI logic only, no secrets.

### Permissions

```json
"permissions": ["activeTab", "scripting", "storage"],
"host_permissions": [
  "https://api.linear.app/*",
  "https://uploads.linear.app/*",
  "https://storage.googleapis.com/*"
]
```

`activeTab` covers both overlay injection and `chrome.tabs.captureVisibleTab`, scoped to the
clicked tab and granted only on click. There are deliberately **no broad host permissions** for
page access, so the extension can read nothing until invoked.

The two upload hosts are both listed because `fileUpload` returns a signed URL whose host has
not yet been observed against a live key. During implementation, capture the actual host and
delete the other entry. See §3.4.

### Message protocol

The content script and service worker are the main seam. One-shot messages via
`chrome.runtime.sendMessage`:

| Message | Response |
| --- | --- |
| `{type:'PING'}` | `{ok:true}` — used to detect an already-mounted overlay |
| `{type:'GET_INIT', origin}` | `{hasKey, projects, lastProjectId, lastTeamId, draft}` |
| `{type:'CAPTURE_VIEWPORT'}` | `{dataUrl}` — full visible viewport PNG |
| `{type:'SAVE_DRAFT', origin, draft}` | `{ok:true}` |
| `{type:'DISCARD_DRAFT', origin}` | `{ok:true}` |
| `{type:'OPEN_OPTIONS'}` | `{ok:true}` |
| `{type:'OPEN_URL', url}` | `{ok:true}` |

Issue creation uses a long-lived `chrome.runtime.connect` port named `create-issue` instead of a
one-shot message, so upload progress can stream back to the modal:

- content → port: `{type:'CREATE_ISSUE', payload: CreatePayload}`
- port → content: `{type:'PROGRESS', phase:'upload', index, total}`
- port → content: `{type:'DONE', identifier, url}`
- port → content: `{type:'ERROR', message, code}`

## 3. Linear API contract

Auth header on every GraphQL request is the raw personal API key:

```
Authorization: <key>
Content-Type: application/json
```

Personal Linear keys are sent bare, without a `Bearer` prefix. Confirm this against a live key
on the first implementation step — it is the single most likely cause of a blanket 401.

### 3.1 Connection test (options page)

```graphql
query { viewer { id name email organization { name } } }
```

### 3.2 Project list

```graphql
query {
  projects(first: 250, filter: { state: { neq: "completed" } }) {
    nodes { id name teams { nodes { id key name } } }
  }
}
```

Returns all active workspace projects with their teams. A key restricted to specific teams
returns only what it can see, which is the desired behavior. The exact filter argument shape
and whether `Project.teams` is a connection must be confirmed by schema introspection before
coding against it; if the filter is not supported, fetch unfiltered and filter client-side.

### 3.3 Issue creation

```graphql
mutation CreateIssue($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue { id identifier url }
  }
}
```

Input: `{ title, description, teamId, projectId }`. `teamId` is required by Linear — every issue
belongs to exactly one team — which is why §5 resolves a team from the chosen project.

### 3.4 Screenshot upload

Verified contract:

1. `fileUpload(contentType, filename, size)` returns an upload request containing a signed
   `uploadUrl`, the final `assetUrl`, and a list of `headers` as key/value pairs.
2. PUT the raw bytes to `uploadUrl`.
3. **Every returned header must be sent verbatim, including casing.** They are part of the
   signature. Omitting or altering any one returns HTTP 403. Observed headers include
   `content-type`, `x-goog-content-length-range: N,N`,
   `cache-control: public, max-age=31536000`, and
   `Content-Disposition: attachment; filename="file.png"`.
4. Do not base64-encode or otherwise transform the body. `fetch(uploadUrl, {method:'PUT',
   body: blob})` with those headers.
5. **The signed URL expires 60 seconds after it is issued.**
6. Maximum size is 2 GB, far above anything a region screenshot produces.

The expiry drives a hard constraint: **prepare and PUT one file completely before preparing the
next.** Batching prepares lets the first URL expire while later ones are still being issued.

The exact mutation field names (`uploadFile` vs `uploadRequest`, `uploadUrl` vs `url`) come from
Linear's schema and must be confirmed by introspection on the first implementation step. The
flow itself is fixed.

`Content-Disposition: attachment` does not prevent inline rendering — Linear's client fetches
the asset as an image when it appears in markdown. Uploaded assets are served behind Linear
authentication, so anyone reading the issue must be signed in to Linear. That is fine for the
intended audience.

### 3.5 Description format

Built by `lib/description.js`:

```markdown
<user description, verbatim; omitted along with its blank line if empty>

---

**Page:** https://example.com/broken/page

![screenshot-1](https://uploads.linear.app/...)
![screenshot-2](https://uploads.linear.app/...)
```

Screenshots are embedded inline only. No `attachmentCreate` calls, so issue creation is exactly
one mutation after the uploads finish.

## 4. UX flows

### 4.1 Activation

1. User clicks the toolbar icon. `chrome.action.onClicked` fires (there is no
   `default_popup`, which would suppress it).
2. The service worker sends `PING` to the tab. If it answers, the overlay is already mounted
   and is told to show itself. Otherwise `chrome.scripting.executeScript` injects
   `content/bootstrap.js`.
3. If injection throws — `chrome://*`, the Chrome Web Store, `chrome-extension://`,
   `view-source:`, and the PDF viewer all forbid it — the worker catches the error, sets the
   action badge to `!` with a tooltip explaining that this page cannot be captured, and clears
   both after 4 seconds. No `notifications` permission needed.

### 4.2 The modal

Mounted into a **shadow root** on a fixed-position host in the upper right, at maximum
`z-index`, with `all: initial` on the host so page CSS cannot reach in. Styles are applied via
`adoptedStyleSheets` rather than an injected `<style>` element, which a strict page CSP could
block.

States:

- **needs-key** — "Add your Linear API key to get started" plus an *Open settings* button that
  messages the worker to open the options page.
- **form** — Title (text), Description (textarea, markdown passed through as typed), Project
  (select), Team (select, conditional — see §5), a *Take screenshot* button, a thumbnail strip,
  and a footer with *Discard draft* and *Save bug*.
- **saving** — Save disabled, label shows `Uploading 2 of 3…` then `Creating issue…`.
- **success** — `BUG-123 created` with a link, auto-dismissing and unmounting after 3 seconds.
  Clicking the link messages the worker to `chrome.tabs.create` the issue URL rather than
  navigating from page context.

Escape or the close button hides the modal. Because drafts persist (§6), nothing is lost.

### 4.3 Region capture

Triggered by *Take screenshot*:

1. The modal is hidden with its state intact in memory (not unmounted).
2. `region-select.js` covers the viewport with a dimmed fixed layer, sets
   `cursor: crosshair`, and locks page scroll (`overflow: hidden` on the documentElement,
   restored afterward) so the selection rectangle cannot drift out of sync with the frame that
   gets captured.
3. mousedown → mousemove draws a live rectangle with a pixel-dimension readout → mouseup
   commits. Escape cancels and returns to the form. A drag smaller than 8×8 CSS pixels is
   treated as a stray click and cancels.
4. **On commit, the selector hides its own dim layer and rectangle, waits two
   `requestAnimationFrame` ticks, and only then sends `CAPTURE_VIEWPORT`.** Without this the
   dimming overlay appears in the screenshot. This is the single most common defect in
   region-capture extensions.
5. The worker calls `chrome.tabs.captureVisibleTab(windowId, {format:'png'})` and returns the
   full viewport data URL.
6. **The content script crops**, not the worker. It has a real DOM, so an ordinary
   `<canvas>` does the work — no `OffscreenCanvas`, no hand-rolled base64 in a worker context
   that lacks `FileReader`. Crop math lives in `lib/crop.js`:

   ```
   sx = round(rect.left   * devicePixelRatio)
   sy = round(rect.top    * devicePixelRatio)
   sw = round(rect.width  * devicePixelRatio)
   sh = round(rect.height * devicePixelRatio)
   ```

   clamped to the captured image's bounds, since `captureVisibleTab` output can be off by a
   rounding pixel. `devicePixelRatio` already incorporates browser zoom, so no separate zoom
   correction is needed — but this must be verified empirically at several zoom levels (§10).
7. The cropped PNG data URL is appended to the draft's image list, the modal is shown again,
   and a thumbnail appears.

**Thumbnails are drawn into a `<canvas>`, never an `<img src="data:…">`.** DOM created by a
content script is still subject to the host page's CSP, and a site with `img-src 'self'` would
blank a data-URI thumbnail. Drawing an `ImageBitmap` into a canvas loads no URL at all.

Each thumbnail has an ✕ to remove it. Captures accumulate up to 5 per draft; at the cap, *Take
screenshot* disables with an explanatory tooltip.

### 4.4 Save

1. Validate: title non-empty, a project chosen, and a team resolved. Otherwise inline field
   errors, no request.
2. The modal opens the `create-issue` port and sends the payload.
3. The worker uploads images **sequentially**, emitting `PROGRESS` per image.
4. The worker builds the description and calls `issueCreate`.
5. On success: clear the draft for that origin, persist sticky project and team, reply `DONE`.
6. On failure: reply `ERROR`. The modal renders a toast over the form with **every field value
   still populated**, and re-enables Save. Nothing is cleared and no draft is discarded, so the
   user can fix the problem and retry.

## 5. Project and team resolution

Linear requires a `teamId` on every issue, but a project may belong to several teams. So:

- The Project select lists all active projects.
- On selection, if the project has exactly one team, that team is used and **the Team select
  stays hidden**.
- If the project has more than one team, the Team select appears, populated with just that
  project's teams, preselected to the sticky team if it is among them and otherwise the first.
- Both project and team are persisted as sticky preferences on successful save.

The project list is cached in `chrome.storage.session` with a 5-minute TTL so reopening the
modal is instant rather than re-fetching. A stale-cache miss is harmless; worst case a
just-created project is missing for five minutes.

## 6. Data and storage model

```js
/**
 * @typedef {Object} CapturedImage
 * @property {string} dataUrl  cropped PNG as data:image/png;base64,...
 * @property {number} width    device pixels
 * @property {number} height   device pixels
 */

/**
 * @typedef {Object} Draft
 * @property {string} title
 * @property {string} description
 * @property {string|null} projectId
 * @property {string|null} teamId
 * @property {CapturedImage[]} images
 * @property {number} updatedAt   epoch ms, used for LRU eviction
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
```

| Key | Area | Contents |
| --- | --- | --- |
| `apiKey` | `storage.local` | Linear personal API key |
| `lastProjectId`, `lastTeamId` | `storage.local` | sticky preferences |
| `draft:<origin>` | `storage.session` | a `Draft` |
| `projectsCache` | `storage.session` | `{fetchedAt, projects}` |

**Drafts are keyed by `location.origin`** and live in `chrome.storage.session`: memory-only,
never written to disk, wiped when Chrome quits. A draft written on one tab restores in any
other tab on the same domain during the session, and never leaks across domains — which
matters because the captured URL belongs to the origin the draft was started on.

Drafts are written on form change, debounced 300 ms. Screenshots are the bulk of the payload,
so before each write the worker sums the serialized size of all `draft:*` entries and, if it
exceeds ~8 MB (against a 10 MB session quota), evicts other origins' drafts oldest-`updatedAt`
first until it fits. The current origin's draft is never evicted; if it alone exceeds the
budget the write is rejected and the modal warns that there are too many screenshots.

A draft is cleared by a successful save or by the *Discard draft* button, which also resets the
form to empty.

Note that content scripts cannot read `chrome.storage.session` without an explicit access-level
change. We never grant it — all storage access goes through the worker — which keeps the API
key unreachable from any page context.

## 7. Error handling

Every failure ends up as a toast over the intact form. Mapped cases:

| Condition | Message |
| --- | --- |
| HTTP 401 / 403 from the GraphQL endpoint | Key rejected. Toast includes an *Open settings* action. |
| GraphQL `errors[]` present | First `errors[0].message`, verbatim from Linear. |
| `issueCreate.success === false` | Generic creation-failed message. |
| Upload PUT non-2xx | Upload failed, with the status code. A 403 specifically hints at expiry or header mangling. |
| `fetch` rejects | Network unreachable — check your connection. |
| No projects returned | Save disabled, with a hint that the key may be scoped to teams without projects. |
| Injection blocked | `!` badge on the action for 4 seconds with an explanatory tooltip. |

The API key is never included in a message, log line, or error string.

## 8. Edge cases

- **Restricted pages** — `chrome://*`, the Web Store, `chrome-extension://`, `view-source:`,
  the PDF viewer. Handled by the badge fallback in §4.1.
- **Browser zoom** — `devicePixelRatio` folds zoom in, so the §4.3 math should hold at 80%,
  125%, and 200%. Verified manually, not assumed.
- **Scrolled pages** — the crop is relative to the viewport, and scroll is locked during
  selection, so scroll offset never enters the math.
- **Stray click instead of drag** — under 8×8 CSS px cancels rather than producing a 1px image.
- **Second icon click while open** — `PING` detects the mounted overlay and shows it instead of
  double-injecting.
- **Page CSS bleeding into the modal** — shadow DOM plus `all: initial` on the host.
- **Page CSP** — `adoptedStyleSheets` instead of inline `<style>`; canvas thumbnails instead of
  data-URI `<img>`.
- **SPA navigation within a page** — the overlay stays mounted and the URL is read at save
  time, not at mount time, so the ticket records where the user actually was.
- **Service worker termination mid-save** — the `create-issue` port closing without `DONE` is
  treated as an error, and the draft survives because it was already persisted.
- **Very large regions** — a full 4K viewport at DPR 2 can produce a multi-megabyte PNG, which
  is well within Linear's 2 GB limit but pressures the session quota; handled by the 5-image
  cap and eviction in §6.

## 9. Security

The design stores a Linear personal API key in `chrome.storage.local`, unencrypted. This is
inherent to the no-backend requirement: there is nowhere else to put it. Chrome isolates
extension storage from web pages and from other extensions, but anyone with access to the
Chrome profile directory, or to devtools for this extension, can read the key.

Therefore the options page will explicitly recommend generating a **scoped** Linear personal
key rather than a full-access one — Linear supports restricting a key to specific permissions
(Read plus Create issues is sufficient here) and to specific teams. The page will state the
tradeoff plainly rather than burying it.

Supporting measures already in the design: the key never leaves the service worker, is never
exposed to page context, and is never written into a message or error string. The extension
requests no broad host permissions, so it can read no page it has not been explicitly invoked
on.

## 10. Verification

**Manual only.** No test files and no test tooling. This is a deliberate departure from the
repository's `CLAUDE.md`, which asks for TDD and for tests to be run after every change; it was
chosen explicitly for this project because the substantive risk here is concentrated in the
overlay, the capture handshake, and the live API contract — none of which unit tests with a
mocked `fetch` would have caught.

`docs/qa-checklist.md` will be written alongside the implementation, covering at minimum:

1. No key set → needs-key state → options page opens.
2. Bad key → *Test connection* shows the error; good key shows name and workspace.
3. Project list populates; a single-team project hides the Team select; a multi-team project
   reveals it.
4. Single capture; multiple captures; removing one; hitting the 5-image cap.
5. **The dim backdrop does not appear in any saved screenshot.**
6. Crop accuracy at 80%, 100%, 125%, and 200% browser zoom.
7. Crop accuracy on a page scrolled well down.
8. Escape cancels selection; a stray click cancels selection.
9. Draft restores in a second tab on the same domain; does **not** appear on a different
   domain; *Discard draft* clears it.
10. Deliberately bad key on save → toast appears with all field values preserved → fixing the
    key and retrying succeeds.
11. Success state shows the identifier, the link opens the issue, and it self-dismisses at 3
    seconds.
12. Restricted page (`chrome://extensions`) → `!` badge with tooltip, no crash.
13. Screenshots render inline in the created Linear issue, and the URL line is correct.

## 11. Open items for the first implementation step

These are contract details to confirm by introspecting Linear's schema and running against a
live key, before building on top of them:

1. Whether personal API keys use a bare `Authorization` header or a `Bearer` prefix.
2. Exact `fileUpload` mutation and response field names.
3. The host of the returned signed upload URL, so the manifest can be narrowed to it.
4. The `projects` query filter argument shape and whether `Project.teams` is a connection.
