/**
 * Overlay lifecycle and state machine. Runs in the content script's
 * isolated world. Holds no API key and makes no network calls.
 * @module app
 */

import { createModal, MODAL_CSS } from './modal.js';
import { selectRegion } from './region-select.js';

const HOST_ID = 'linear-bug-quick-capture-host';

/** @type {HTMLDivElement|null} */
let host = null;
/** @type {ShadowRoot|null} */
let root = null;
/** @type {ReturnType<typeof createModal>|null} */
let modal = null;
/** True once a save has succeeded and the success panel is showing. */
let successShown = false;
/** @type {ReturnType<typeof setTimeout>|undefined} */
let dismissTimer;

/**
 * Events that must not escape the overlay into the host page.
 *
 * A shadow root hides our DOM but does nothing to contain events: the host
 * element still sits in the page's tree, so anything the user does inside the
 * overlay retargets at the shadow boundary and then keeps bubbling into the
 * page's own document-level handlers. Real sites act on that — single-key
 * search shortcuts swallow keystrokes, and focus traps watching
 * focusin/focusout pull focus back to their own field mid-sentence, so typing
 * either vanishes or lands in an unrelated page input.
 *
 * Stopping propagation at the host in the BUBBLE phase is the whole trick:
 * the event has already reached our own field by then, so typing still works
 * normally, but the page never learns it happened. Nothing here calls
 * preventDefault, and our Escape handler is unaffected because it listens on
 * document in the capture phase, which runs before the event gets here.
 */
const ISOLATED_EVENTS = [
  'keydown',
  'keyup',
  'keypress',
  'input',
  'change',
  'focusin',
  'focusout',
  'paste',
  'copy',
  'cut',
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
];

/** @param {Event} e */
function stopEvent(e) {
  e.stopPropagation();
}

const DRAFT_DEBOUNCE_MS = 300;
/** @type {ReturnType<typeof setTimeout>|undefined} */
let draftTimer;
/**
 * Set once an issue has been created, to stop a debounced save from writing
 * the draft back after the worker already cleared it. The form fields stay
 * editable during a save (only the Save button is disabled), so a user
 * typing mid-upload can arm a timer that would otherwise fire after the
 * issue exists and resurrect a draft for a bug that was already filed.
 */
let draftsFrozen = false;

function scheduleDraftSave() {
  if (draftsFrozen) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(async () => {
    // Re-check: the save may have completed while this timer was pending.
    if (draftsFrozen || !modal) return;
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

export function unmount() {
  clearTimeout(dismissTimer);
  successShown = false;
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
  // `host` alone is not enough. A notice state (no key, or projects failed to
  // load) and the post-success state both leave a mounted host with no live
  // form, and re-showing those presents a stale panel forever — a key saved
  // in the meantime, or a network that recovered, would never be picked up.
  if (host && modal && !successShown) {
    show();
    return;
  }
  if (host) unmount(); // stale notice or success panel: rebuild from scratch

  host = document.createElement('div');
  host.id = HOST_ID;
  // Closed, not open: with an open root any script on the host page could
  // read `host.shadowRoot` and enumerate the project list and team keys,
  // poll the title/description fields, or click Save. Nothing here reads
  // `.shadowRoot` off the host — `root` is the only handle.
  root = host.attachShadow({ mode: 'closed' });

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(MODAL_CSS);
  root.adoptedStyleSheets = [sheet];

  // Contain the overlay's own events so the page cannot react to them.
  // These live on the host and die with it, so unmount() needs no counterpart.
  for (const type of ISOLATED_EVENTS) host.addEventListener(type, stopEvent);

  document.documentElement.append(host);
  document.addEventListener('keydown', onKeydown, true);

  /** @type {any} */
  let init;
  try {
    init = await chrome.runtime.sendMessage({
      type: 'GET_INIT',
      origin: location.origin,
    });
  } catch {
    // sendMessage rejects when the worker cannot be reached at all — the
    // extension was reloaded or updated while this content script stayed
    // live. Without this the host is left appended with an empty shadow
    // root: an invisible overlay and a keydown listener with nothing to
    // close.
    renderNotice(
      'Could not reach the extension background. Try again.',
      'Open settings',
      () => chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' })
    );
    return;
  }

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
      onTakeScreenshot: async () => {
        modal?.clearToast();
        hide(); // keeps modal state in memory; does not unmount
        const { image, error } = await selectRegion();
        show();
        if (image) {
          modal?.addImage(image);
          scheduleDraftSave();
        }
        // A cancel yields no error and must stay silent. A real failure —
        // captureVisibleTab refusing on a restricted page, a crop error, the
        // extension reloading mid-capture — has to say so, or the user drags
        // a region and nothing happens with no explanation.
        else if (error) {
          modal?.showToast(error);
        }
      },
      onSave: () => {
        if (!modal) return;
        clearTimeout(draftTimer); // don't let a queued save outlive this one
        modal.clearToast();
        const values = modal.getValues();

        modal.setFieldError('title', values.title ? null : 'Give the bug a name.');
        modal.setFieldError('project', values.projectId ? null : 'Pick a project.');
        // A project with no visible team (possible with a team-scoped API
        // key) would otherwise fail the guard below with nothing shown.
        if (values.projectId && !values.teamId) {
          modal.setFieldError('project', 'No team available for this project.');
        }
        if (!values.title || !values.projectId || !values.teamId) return;

        modal.setBusy('Saving…');

        const port = chrome.runtime.connect({ name: 'create-issue' });
        // Tracks whether the save reached a real outcome, so the
        // onDisconnect handler below can tell "the worker died mid-save"
        // from "the port closed because we're finished with it".
        let settled = false;

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
            // Escape hides the overlay but preserves its state, so a save
            // can finish while the panel is display:none. Reveal it — the
            // identifier and the "Open in Linear" link are the only record
            // the user gets that the issue exists.
            show();
            settled = true;
            // The worker has already cleared this origin's draft. Freeze so
            // nothing writes it back: the fields stay editable during a save,
            // so a user typing mid-upload can have armed a timer that would
            // otherwise fire now and resurrect a draft for a filed bug.
            draftsFrozen = true;
            clearTimeout(draftTimer);
            port.disconnect();
            modal?.showSuccess(msg.identifier, msg.url);
            successShown = true;
            dismissTimer = setTimeout(unmount, 3000);
            return;
          }
          if (msg.type === 'ERROR') {
            // The overlay may be hidden (Escape mid-flight). A toast written
            // into a display:none host is no feedback at all.
            show();
            settled = true;
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
          // MV3 can kill an idle service worker at any moment, including
          // mid-upload. Re-enabling Save silently would leave the user
          // staring at a button with no idea whether the issue was created,
          // which spec §7 forbids — every failure has to say something.
          //
          // The `settled` guard matters in the other direction too: after a
          // DONE the worker has nothing left to do and may be killed
          // immediately, which would otherwise paint an "interrupted" toast
          // over the success panel.
          if (settled) return;
          // As with the ERROR branch: the overlay may be hidden, and this
          // toast is the only sign the save did not complete.
          show();
          modal?.setBusy(null);
          modal?.showToast(
            'Saving was interrupted before it finished. Check Linear for a partly created issue, then save again.'
          );
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
    },
    init.projects ?? [],
    { lastProjectId: init.lastProjectId, lastTeamId: init.lastTeamId }
  );

  root.innerHTML = '';
  root.append(modal.element);
  draftsFrozen = false;
  if (init.draft) modal.setValues(init.draft);
  // After setValues, so the caret lands after any restored text. Must be after
  // the append too — focus() on a detached element is a no-op.
  modal.focusTitle();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'PING') {
    sendResponse({ ok: true });
    return;
  }
  if (msg?.type === 'SHOW') {
    // PING answers "this module is loaded", not "a usable overlay is on
    // screen". After an auto-dismiss host is null; after a notice or a
    // success panel there is a host but no live form. Only show() when there
    // is genuinely a form to reveal — otherwise re-initialize. mount()
    // tears down a stale host itself.
    if (host && modal && !successShown) show();
    else void mount();
    sendResponse({ ok: true });
  }
});
