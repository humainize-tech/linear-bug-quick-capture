# Linear Bug Quick Capture

A Chrome extension for filing Linear bugs without leaving the page you found them on.

**No account. No backend. No subscription. No tracking, analytics, or telemetry of any kind.**

## Why I built this

<!-- DRAFT — Allen, rewrite this in your own words before publishing. -->

Filing a bug properly takes about ninety seconds: switch to Linear, find the right project,
retype what you just saw, go back for the URL, take a screenshot, crop it, upload it. Ninety
seconds is long enough that I'd stop doing it. I'd tell myself I'd file it later, and later
I'd have forgotten the details that made it worth filing.

So I built the shortest path I could think of. Click the toolbar icon, type a sentence, drag
a box around the broken thing, hit save. The screenshot, the page URL, and your description
land in Linear as a real issue. Project, team, and status are sticky, so filing ten bugs in
a row means picking them once.

It started as a fun vibe coding project, and it turned out small enough to read end-to-end
in a sitting — about 2,000 lines of vanilla JavaScript with no build step and no
dependencies. It talks to Linear and to nothing else. So I figured I'd open-source it in
case it's useful to someone else.

## Demo

<!-- TODO: embed the walkthrough video here.
     GitHub renders MP4/MOV uploaded directly to a release or issue — drag the file into any
     GitHub comment box, then paste the resulting URL on its own line below.
     For a YouTube video, use a linked thumbnail instead:
     [![Watch the walkthrough](https://img.youtube.com/vi/VIDEO_ID/maxresdefault.jpg)](https://youtu.be/VIDEO_ID) -->

*A short video walkthrough is coming — check back shortly.*

<!-- TODO: add a screenshot or GIF of the capture panel and a region selection -->

## Features

**Region screenshots.** Drag to select any part of the page; up to 5 per bug. The captured
image contains no dimming and no selection rectangle — just the region you picked.

**Sticky project, team, and status pickers.** Filled from your workspace, and remembered
between bugs, so a run of ten bugs means picking them once.

**Per-site drafts.** Close the panel mid-sentence and your text and screenshots are still
there when you come back. Drafts live in memory only and never cross between sites.

**No backend.** The extension talks to Linear's API directly from your browser. There is no
server in between, nothing to sign up for, and nothing that phones home.

## Install - for non-developers

You don't need Git, a terminal, or any developer tools — just Chrome and about two minutes.
This extension isn't on the Chrome Web Store, so Chrome installs it from a folder on your
computer instead.

1. **Download the extension.** [Click here to download the .zip](https://github.com/humainize-tech/linear-bug-quick-capture/raw/main/linear-bug-quick-capture-extension-1-0-0.zip). It'll land in your Downloads folder.
2. **Unzip it.** Double-click the downloaded file (Mac), or right-click it and choose **Extract All...** (Windows). You'll end up with a folder named `linear-bug-quick-capture-extension-1-0-0` containing a folder called `src`.
3. **Move the folder somewhere permanent.** Drag it out of Downloads and into somewhere you won't clean out later — your Documents folder is fine. Chrome loads the extension from this folder every time it starts, so if you delete or move it later, the extension stops working.
4. **Open Chrome's extensions page.** Copy `chrome://extensions` into Chrome's address bar and press Enter. (Clicking a link to it won't work — Chrome only lets you type it.)
5. **Turn on Developer mode.** There's a toggle in the top-right corner of that page. Flip it on. This just means "let me install an extension from a folder" — you don't have to do anything developer-y.
6. **Click "Load unpacked."** A button appears in the top-left after step 5. Click it, and a file picker opens.
7. **Select the `src` folder.** Navigate into the folder you unzipped, then select the **`src`** folder inside it — not the outer folder. On Mac, single-click `src` to highlight it and click **Select**; on Windows, click into `src` and click **Select Folder**.
8. **Pin it to the toolbar.** Click the **puzzle-piece icon** in the Chrome toolbar, find **Linear Bug Quick Capture**, and click the **pin icon** next to it. The extension is driven entirely by its toolbar icon, so pin it or you'll have no way to open it.

That's it. The extension is installed and will stay installed. Now go to [Setup](#setup) to
add your Linear API key.

A few things you might see along the way, all normal:

- Chrome shows a **"Disable developer mode extensions"** warning each time it starts. Click the X to dismiss it. The extension keeps working.
- If you see a `__MACOSX` folder next to `src` after unzipping, ignore it — it's a harmless macOS leftover.
- If Chrome says the manifest is missing or the folder is invalid, you selected the wrong folder. Go back to step 7 and pick the `src` folder specifically.

**To update later**, download the new .zip, unzip it, replace your old folder with the new
one, then click the ↻ reload icon on the extension's card at `chrome://extensions`.

**To uninstall**, click **Remove** on the extension's card at `chrome://extensions`, then
delete the folder.

## Install - for developers

This extension isn't on the Chrome Web Store. Install it unpacked:

1. Clone or download this repository.
   ```bash
   git clone git@github.com:humainize-tech/linear-bug-quick-capture.git
   cd linear-bug-quick-capture
   ```
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked**.
5. Select the **`src/`** folder inside the repository — not the repository root.
6. Pin the extension to the toolbar — it has no other entry point.

There is **no build step**. The extension is plain ES modules and the icons are committed,
so the code you clone is the code Chrome loads. `npm install` is only needed if you want to
run the type checker — see [Development](#development).

Requirements: Chrome 112 or later (or a Chromium browser with Manifest V3 support), and a
Linear account that can create issues.

## Setup

**1. Create a Linear API key.** In Linear, go to **Settings → Account → Security & Access**
and create a personal API key.

**Create a scoped key, not a full-access one.** Limit it to **Read** and **Create issues**,
restricted to the teams you actually file bugs against. The key is stored unencrypted in the
extension's local storage — that's how this works without a backend — so anyone with access
to your Chrome profile directory can read it. A narrow key limits what that's worth.

Copy the key; Linear only shows it once.

**2. Add the key to the extension.** Right-click the pinned icon and choose **Options** (or
find the extension on `chrome://extensions` and click **Details → Extension options**). Paste
the key into **Personal API key** and click **Save key**.

**3. Click "Test connection."** You should see your name and workspace. If the test fails, the
message will tell you whether the key was rejected outright or is missing the **Create
issues** permission.

You're done. Open any web page and click the icon.

## Filing a bug

Click the toolbar icon and a panel opens in the top-right corner of the page.

| Field | Notes |
| --- | --- |
| **Bug name** | Required. Becomes the issue title. Focused automatically when the panel opens. |
| **Description** | Optional. Markdown is passed through as typed. |
| **Project** | Required. Lists all active projects your key can see. |
| **Team** | Only appears when the chosen project spans more than one team. |
| **Status** | The workflow status the issue is created in. See [below](#about-status). |

**To attach a screenshot**, click *Take screenshot*. The panel hides, the page dims, and you
drag a box around the region you want. Escape or a single click without dragging cancels.
Repeat for up to 5 screenshots; remove one with the ✕ on its thumbnail.

**To save**, click *Save bug* or press <kbd>⌘</kbd>+<kbd>Return</kbd>
(<kbd>Ctrl</kbd>+<kbd>Enter</kbd> on Windows/Linux). You'll get the new issue's identifier and
a link to open it in Linear.

**Escape** hides the panel without discarding anything. **Discard draft** clears the title,
description, and screenshots, and keeps your project/team/status selections.

### What the issue looks like in Linear

Your description, then a horizontal rule, then the page URL, then the screenshots:

```markdown
The date picker jumps to 1970 when you clear the field.

---

**Page:** https://example.com/settings/billing

![screenshot-1](https://uploads.linear.app/...)
```

### About status

**Linear scopes statuses to teams, not projects.** Every team defines its own set and can
rename and reorder them, so the Status options follow whichever team your chosen project
resolves to, and change when that team changes.

The remembered status is stored as a **name**, not an id — ids mean nothing outside the team
that owns them. So if you file into "Triage" and your next bug goes to a different team, you
get that team's "Triage" if it has one, and its default status if it doesn't.

### Drafts

Drafts are saved per site as you type and live in session storage — memory-only, never
written to disk, cleared when Chrome quits. A draft started on one tab restores on any other
tab of the same site, and never crosses between sites.

## Settings reference

| Control | What it does |
| --- | --- |
| **Save key** / **Clear key** | Stores or removes your Linear API key. |
| **Test connection** | Verifies the key and shows your name and workspace. |
| **Clear all drafts** | Discards every saved draft across all sites. |
| **Reset remembered selections** | Forgets the sticky project, team, and status. |

## Privacy

**There is no backend, no analytics, no telemetry, no tracking, and no account to create.**
The only server this extension ever talks to is Linear's, using your own API key. Nothing is
sent to me, because there is nowhere for it to be sent. It's roughly 2,000 lines of vanilla
JavaScript with no dependencies and no build step, so you can verify that yourself.

What the extension does touch:

- **Network.** Requests go to `api.linear.app` (the GraphQL API), and to `uploads.linear.app` / `storage.googleapis.com` for screenshot uploads — the latter is the signed URL Linear itself hands back for its asset storage. Those three hosts are the extension's entire `host_permissions` list; it cannot reach anywhere else.
- **Your API key.** Stored unencrypted in `chrome.storage.local`, which does **not** sync across profiles. It never reaches page context: content scripts go through messages, and the overlay is mounted in a **closed** shadow root, so nothing on the host page can read the form, the project list, or the key.
- **Screenshots.** Captured locally, cropped locally, and uploaded to your Linear workspace's asset storage when you save. They are not stored anywhere else.
- **Drafts and remembered selections.** Drafts live in `chrome.storage.session` — memory only, cleared when Chrome quits. Your sticky project/team/status and a short-lived cache of your project list live in local and session storage respectively.
- **Permissions.** `activeTab`, `scripting`, and `storage`. `activeTab` means the extension can only read the page for the tab you clicked the icon on, and only after you click it. **It cannot see any other site you visit, or any site in the background.**

## Where it won't work

Chrome forbids extensions from injecting into some pages, so the icon can't open a panel on
`chrome://` pages, the Chrome Web Store, other extensions' pages, `view-source:`, or the
built-in PDF viewer. On those you'll get a red **!** badge on the icon instead.

## Limitations

- **The API key is stored unencrypted**, because there's no backend to hold it. Use a scoped key limited to Read + Create issues on the teams you file against.
- **Up to 5 screenshots per bug**, and only regions of the visible viewport — there's no full-page or scrolling capture.
- **Statuses are team-scoped**, so the remembered status is matched by name and falls back to the team's default. See [About status](#about-status).
- **Drafts don't survive a Chrome restart**, by design — they're memory-only.
- **This tracks Linear's live API.** If Linear changes its GraphQL schema or its upload handshake, this will break. The whole client is in `src/background/linear-api.js`.

## Troubleshooting

**"Manifest file is missing or unreadable"** — you selected the repo root, or the outer
unzipped folder. Select `src/`.

**The panel shows "Add your Linear API key" after you saved one** — a tab that already had
the panel open keeps its old state. Reload the tab. (The content script deliberately does not
watch storage, since noticing would cost either the `tabs` permission or a storage listener
running in page context.)

**"No projects found"** — your key is scoped to teams that have no projects, or is missing
**Read** permission.

**Changes to the code don't take effect** — click the reload icon on the extension's card at
`chrome://extensions`, then reload the page you're testing on.

## Project structure

```
src/
  manifest.json      Manifest V3 config
  background/        Service worker and the Linear GraphQL client — owns all network
                     and storage access
  content/           The overlay: panel UI, region selection, lifecycle. Holds no API key.
  lib/               Shared helpers — storage, types, cropping, description building
  options/           Settings page
  icons/             Toolbar and store icons
docs/                Design specs, implementation plans, and the manual QA checklist
scripts/             One-off utilities (icon generation)
```

No build step. Edit files in `src/`, then hit the reload icon on `chrome://extensions`.

## Development

```bash
npm install         # devDependencies only: typescript + @types/chrome
npm run typecheck   # tsc --noEmit against the JSDoc types
```

There are no automated tests, deliberately — the risk in this codebase is concentrated in the
overlay, the capture handshake, and the live Linear contract, none of which a mocked-`fetch`
unit test would catch. Run [`docs/qa-checklist.md`](docs/qa-checklist.md) against a real
workspace instead, and delete the test issues you create.

Design docs live in `docs/superpowers/specs/`. Start with the architecture doc for the
message protocol and API contracts.

## Contributing

Issues and pull requests are welcome, especially fixes for changes in Linear's API. There's
no test suite — please describe what you tested manually, and don't paste API keys or
workspace data into an issue.

## Support this project

This is free and always will be — there's nothing to subscribe to and no paid tier. If it
saved you some time and you feel like saying thanks, you can buy me a coffee:

<a href="https://www.buymeacoffee.com/allenjhyang"><img src="https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=&slug=allenjhyang&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff" alt="Buy me a coffee" height="40"></a>

Entirely optional. Bug reports and PRs are worth just as much.

## License

[MIT](LICENSE)

---

Not affiliated with, endorsed by, or sponsored by Linear. Linear is a trademark of Linear
Orbit, Inc.
