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
            settled = true;
            // The worker has already cleared this origin's draft. Freeze so
            // nothing writes it back: the fields stay editable during a save,
            // so a user typing mid-upload can have armed a timer that would
            // otherwise fire now and resurrect a draft for a filed bug.
            draftsFrozen = true;
            clearTimeout(draftTimer);
            port.disconnect();
            modal?.showSuccess(msg.identifier, msg.url);
            setTimeout(unmount, 3000);
            return;
          }
          if (msg.type === 'ERROR') {
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
