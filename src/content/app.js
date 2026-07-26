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
        if (image) modal?.addImage(image);
        // A cancel yields no error and must stay silent. A real failure —
        // captureVisibleTab refusing on a restricted page, a crop error, the
        // extension reloading mid-capture — has to say so, or the user drags
        // a region and nothing happens with no explanation.
        else if (error) modal?.showToast(error);
      },
      onSave: () => {
        if (!modal) return;
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
