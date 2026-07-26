/**
 * Options page. Reads and writes the API key directly (it is an extension
 * page, not page context) but routes the connection test through the worker
 * so there is exactly one Linear client.
 * @module options
 */

import { getApiKey, setApiKey, clearApiKey } from '../lib/storage.js';

const $ = (/** @type {string} */ id) =>
  /** @type {HTMLInputElement & HTMLButtonElement & HTMLParagraphElement} */ (
    document.getElementById(id)
  );

const keyInput = $('key');
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
