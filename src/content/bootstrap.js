/**
 * The only file injected by chrome.scripting. It exists so the rest of the
 * overlay can use ordinary ES imports: executeScript cannot inject modules,
 * but a dynamic import of a web-accessible resource works, and runs in the
 * content script's isolated world rather than the page's.
 */
(async () => {
  try {
    const mod = await import(chrome.runtime.getURL('content/app.js'));
    mod.mount();
  } catch (err) {
    console.error('[linear-bug-capture] failed to load overlay', err);
  }
})();
