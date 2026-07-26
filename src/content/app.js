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
