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
- [ ] **Clear key** empties the field. An overlay already mounted in a tab
      keeps showing its form until that tab is reloaded — the content script
      does not watch storage, deliberately, since noticing would cost either
      the `tabs` permission or a storage listener in page context. Reload the
      tab, then confirm the icon shows the needs-key state.
- [ ] With no key set, clicking the icon shows the needs-key notice; then set
      a key in options, return to the tab, and click the icon again — the
      **form must appear** without a page reload. (This is the first-run path;
      it regressed once and is worth re-checking.)

## Project and team selection

- [ ] The project select is populated with real project names.
- [ ] A single-team project shows its team key in the option text and does
      **not** show a Team select.
- [ ] A multi-team project **does** show a Team select, listing only that
      project's teams.
- [ ] Switching from a multi-team to a single-team project hides the Team
      select again.
- [ ] The last-used project and team are preselected on reopen.

## Status

Statuses are scoped to **teams** in Linear, not projects, so everything here
turns on the team the selected project resolves to.

- [ ] With no project selected, Status is disabled and reads "Select a project
      first".
- [ ] Selecting a project fills Status with that team's real statuses, in the
      same order Linear shows them (Triage/Backlog first, Canceled and
      Duplicate last).
- [ ] Switching to a project on a **different** team re-populates Status, and
      keeps the same status **name** if that team has one by that name.
- [ ] Switching to a team that has no status by that name falls back to that
      team's own default status.
- [ ] Picking a status manually and *then* switching project carries the
      manual pick over — not the status of the last bug you filed.
- [ ] The status of the last **created** bug is preselected on reopen. File two
      bugs in a row and confirm the second one starts on the first one's status.
- [ ] A restored draft comes back with its status.
- [ ] The created issue actually lands in the chosen status in Linear — check
      the issue, not just the toast.

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
