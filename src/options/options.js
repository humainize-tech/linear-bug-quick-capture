/**
 * Options page. Reads and writes the API key directly (it is an extension
 * page, not page context) but routes the connection test through the worker
 * so there is exactly one Linear client.
 * @module options
 */

import {
  getApiKey,
  setApiKey,
  clearApiKey,
  clearAllDrafts,
} from '../lib/storage.js';

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

$('clear-drafts').addEventListener('click', async () => {
  await clearAllDrafts();
  setStatus('All drafts cleared.', 'ok');
});

$('reset-sticky').addEventListener('click', async () => {
  await chrome.storage.local.remove('stickyPrefs');
  setStatus('Remembered project reset.', 'ok');
});

load();
