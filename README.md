# Linear Bug Quick Capture

A Chrome extension for filing Linear bugs without leaving the page you found them on.
Click the toolbar icon, describe what broke, drag a box around the broken thing, and save.
The screenshot, the page URL, and your description land in Linear as a new issue.

- **Region screenshots** — drag to select any part of the page; up to 5 per bug. The
  captured image contains no dimming and no selection rectangle.
- **Project, team, and status pickers** — filled from your workspace, and sticky, so
  filing ten bugs in a row means picking them once.
- **Per-site drafts** — close the panel mid-sentence and your text and screenshots are
  still there when you come back.
- **No backend.** The extension talks to Linear's API directly from your browser.

## Requirements

- Google Chrome 112 or later (or a Chromium browser with Manifest V3 support)
- A Linear account that can create issues

There is **no build step**. The extension is plain ES modules and the icons are committed,
so the code you clone is the code Chrome loads. `npm install` is only needed if you want to
run the type checker — see [Development](#development).

## Setup

### 1. Get the code

```bash
git clone git@github.com:eightpointcompass/linear-bug-quick-capture.git
cd linear-bug-quick-capture
```

### 2. Load the unpacked extension

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** with the toggle in the top-right corner.
3. Click **Load unpacked**.
4. Select the **`src/` folder inside the repo** — not the repo root.

> **This is the step people get wrong.** `manifest.json` lives at `src/manifest.json`, so
> pointing Chrome at the repository root gives you *"Manifest file is missing or
> unreadable."* Select `src/`.

"Linear Bug Quick Capture" should now appear in your extensions list.

### 3. Pin it to the toolbar

The extension is driven entirely by its toolbar icon, so pin it or you'll have no way to
open it:

1. Click the **puzzle-piece icon** in the Chrome toolbar.
2. Find **Linear Bug Quick Capture** in the list.
3. Click the **pin icon** next to it.

### 4. Create a Linear API key

In Linear, go to **Settings → Account → Security & Access** and create a personal API key.

**Create a scoped key, not a full-access one.** Limit it to **Read** and **Create issues**,
restricted to the teams you actually file bugs against. The key is stored unencrypted in
the extension's local storage — that's how this works without a backend — so anyone with
access to your Chrome profile directory can read it. A narrow key limits what that's worth.

Copy the key; Linear only shows it once.

### 5. Add the key to the extension

1. Right-click the pinned icon and choose **Options** (or find the extension on
   `chrome://extensions` and click **Details → Extension options**).
2. Paste the key into **Personal API key** and click **Save key**.
3. Click **Test connection**. You should see your name and workspace.

If the test fails, the message will tell you whether the key was rejected outright or is
missing the **Create issues** permission.

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

**To attach a screenshot**, click *Take screenshot*. The panel hides, the page dims, and
you drag a box around the region you want. Escape or a single click without dragging
cancels. Repeat for up to 5 screenshots; remove one with the ✕ on its thumbnail.

**To save**, click *Save bug* or press <kbd>⌘</kbd>+<kbd>Return</kbd>
(<kbd>Ctrl</kbd>+<kbd>Enter</kbd> on Windows/Linux). You'll get the new issue's identifier
and a link to open it in Linear.

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
that owns them. So if you file into "Triage" and your next bug goes to a different team,
you get that team's "Triage" if it has one, and its default status if it doesn't.

### Drafts

Drafts are saved per site as you type and live in session storage — memory-only, never
written to disk, cleared when Chrome quits. A draft started on one tab restores on any
other tab of the same site, and never crosses between sites.

## Settings reference

| Control | What it does |
| --- | --- |
| **Save key** / **Clear key** | Stores or removes your Linear API key. |
| **Test connection** | Verifies the key and shows your name and workspace. |
| **Clear all drafts** | Discards every saved draft across all sites. |
| **Reset remembered selections** | Forgets the sticky project, team, and status. |

## Where it won't work

Chrome forbids extensions from injecting into some pages, so the icon can't open a panel on
`chrome://` pages, the Chrome Web Store, other extensions' pages, `view-source:`, or the
built-in PDF viewer. On those you'll get a red **!** badge on the icon instead.

## Troubleshooting

**"Manifest file is missing or unreadable"** — you selected the repo root. Select `src/`.

**The panel shows "Add your Linear API key" after you saved one** — a tab that already had
the panel open keeps its old state. Reload the tab. (The content script deliberately does
not watch storage, since noticing would cost either the `tabs` permission or a storage
listener running in page context.)

**"No projects found"** — your key is scoped to teams that have no projects, or is missing
**Read** permission.

**Changes to the code don't take effect** — click the reload icon on the extension's card
at `chrome://extensions`, then reload the page you're testing on.

## Development

```bash
npm install         # devDependencies only: typescript + @types/chrome
npm run typecheck   # tsc --noEmit against the JSDoc types
```

There are no automated tests, deliberately — the risk in this codebase is concentrated in
the overlay, the capture handshake, and the live Linear contract, none of which a
mocked-`fetch` unit test would catch. Run [`docs/qa-checklist.md`](docs/qa-checklist.md)
against a real workspace instead, and delete the test issues you create.

| Path | What lives there |
| --- | --- |
| `src/background/` | Service worker and the Linear GraphQL client. Owns all network and storage access. |
| `src/content/` | The overlay: panel UI, region selection, lifecycle. Holds no API key. |
| `src/lib/` | Shared helpers — storage, types, cropping, description building. |
| `src/options/` | Settings page. |
| `docs/superpowers/specs/` | Design docs. Start with the architecture doc for the message protocol and API contracts. |

The API key never reaches page context: content scripts go through messages, and the
overlay is mounted in a **closed** shadow root so nothing on the host page can read the
form or the project list.
