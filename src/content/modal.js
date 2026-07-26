/**
 * The bug form UI. Pure view layer: it renders, collects values, and calls
 * handlers. It performs no network or storage access.
 * @module modal
 */

/** @typedef {import('../lib/types.js').CapturedImage} CapturedImage */
/** @typedef {import('../lib/types.js').Project} Project */

export const MAX_IMAGES = 5;

export const MODAL_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.panel {
  position: fixed; top: 16px; right: 16px; width: 340px;
  background: #fff; color: #1b1b1f;
  border: 1px solid #e3e3e8; border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0,0,0,.18);
  padding: 14px; z-index: 2147483647;
}
.head { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
.title { font-weight:600; }
.x { border:0; background:transparent; cursor:pointer; font-size:16px; line-height:1; color:#6b6b76; }
label { display:block; font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:#6b6b76; margin:10px 0 4px; }
input[type=text], textarea, select {
  width:100%; padding:7px 9px; border:1px solid #e3e3e8; border-radius:6px;
  background:#fff; color:#1b1b1f; font:inherit;
}
textarea { min-height:72px; resize:vertical; }
.err { color:#c0392b; font-size:12px; margin-top:4px; }
.hidden { display:none !important; }
.shots { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
.shot { position:relative; width:64px; height:44px; border:1px solid #e3e3e8; border-radius:4px; overflow:hidden; }
.shot canvas { width:100%; height:100%; display:block; object-fit:cover; }
.shot .rm {
  position:absolute; top:1px; right:1px; width:16px; height:16px; border:0;
  border-radius:50%; background:rgba(0,0,0,.65); color:#fff; cursor:pointer;
  font-size:11px; line-height:16px; padding:0;
}
.foot { display:flex; gap:8px; align-items:center; margin-top:14px; }
.foot .spacer { flex:1; }
button.primary { padding:8px 12px; border:0; border-radius:6px; background:#5e6ad2; color:#fff; cursor:pointer; font:inherit; }
button.primary:disabled { opacity:.55; cursor:default; }
button.ghost { padding:8px 10px; border:1px solid #e3e3e8; border-radius:6px; background:transparent; color:#1b1b1f; cursor:pointer; font:inherit; }
button.shot-btn { width:100%; margin-top:8px; padding:8px; border:1px dashed #c9c9d2; border-radius:6px; background:transparent; color:#1b1b1f; cursor:pointer; font:inherit; }
.toast {
  margin-top:12px; padding:9px 11px; border-radius:6px;
  background:#fdecea; color:#8e2b20; border:1px solid #f5c6c0; font-size:12px;
}
.toast button { margin-top:6px; }
.success { text-align:center; padding:18px 6px; }
.success .id { font-weight:600; font-size:15px; margin-bottom:6px; }
.success a { color:#5e6ad2; cursor:pointer; text-decoration:underline; }
p.note { margin:0 0 10px; color:#6b6b76; }
`;

/**
 * @typedef {Object} ModalHandlers
 * @property {() => void} onTakeScreenshot
 * @property {() => void} onSave
 * @property {() => void} onDiscardDraft
 * @property {() => void} onClose
 * @property {(url: string) => void} onOpenUrl
 * @property {() => void} onChange  Fired on any field edit (debounced by caller).
 */

/**
 * @param {ModalHandlers} handlers
 * @param {Project[]} projects
 * @param {{lastProjectId: string|null, lastTeamId: string|null}} prefs
 */
export function createModal(handlers, projects, prefs) {
  /** @type {CapturedImage[]} */
  let images = [];

  const panel = el('div', 'panel');

  // header
  const head = el('div', 'head');
  const title = el('span', 'title');
  title.textContent = 'Report a bug';
  const close = el('button', 'x');
  close.textContent = '×';
  close.title = 'Close';
  close.addEventListener('click', handlers.onClose);
  head.append(title, close);

  // body
  const body = el('div', 'body');

  const nameInput = /** @type {HTMLInputElement} */ (document.createElement('input'));
  nameInput.type = 'text';
  nameInput.placeholder = 'What is broken?';
  const nameErr = el('div', 'err hidden');

  const descInput = /** @type {HTMLTextAreaElement} */ (
    document.createElement('textarea')
  );
  descInput.placeholder = 'Steps to reproduce, expected vs actual…';

  const projectSelect = /** @type {HTMLSelectElement} */ (
    document.createElement('select')
  );
  const projectErr = el('div', 'err hidden');

  const teamLabel = el('label', 'team-label hidden');
  teamLabel.textContent = 'Team';
  const teamSelect = /** @type {HTMLSelectElement} */ (
    document.createElement('select')
  );
  teamSelect.classList.add('hidden');

  const noProjects = el('p', 'note hidden');
  noProjects.textContent =
    'No projects found. Your API key may be scoped to teams without projects.';

  projectSelect.append(optionEl('', 'Select a project…'));
  for (const p of projects) {
    projectSelect.append(
      optionEl(p.id, p.teams.length === 1 ? `${p.name} (${p.teams[0].key})` : p.name)
    );
  }
  if (!projects.length) {
    projectSelect.classList.add('hidden');
    noProjects.classList.remove('hidden');
  }

  /**
   * A project may span several teams, but an issue needs exactly one. Show
   * the team select only when the choice is genuinely ambiguous.
   */
  function syncTeamSelect() {
    const project = projects.find((p) => p.id === projectSelect.value);
    teamSelect.innerHTML = '';

    if (!project || project.teams.length <= 1) {
      teamSelect.classList.add('hidden');
      teamLabel.classList.add('hidden');
      return;
    }
    for (const t of project.teams) {
      teamSelect.append(optionEl(t.id, `${t.name} (${t.key})`));
    }
    const sticky = project.teams.find((t) => t.id === prefs.lastTeamId);
    teamSelect.value = sticky ? sticky.id : project.teams[0].id;
    teamSelect.classList.remove('hidden');
    teamLabel.classList.remove('hidden');
  }

  projectSelect.addEventListener('change', () => {
    syncTeamSelect();
    handlers.onChange();
  });
  teamSelect.addEventListener('change', handlers.onChange);
  nameInput.addEventListener('input', handlers.onChange);
  descInput.addEventListener('input', handlers.onChange);

  if (prefs.lastProjectId && projects.some((p) => p.id === prefs.lastProjectId)) {
    projectSelect.value = prefs.lastProjectId;
  }
  syncTeamSelect();

  // Cast because renderShots() sets .disabled, which HTMLElement lacks —
  // same reason `save` below is cast.
  const shotBtn = /** @type {HTMLButtonElement} */ (el('button', 'shot-btn'));
  shotBtn.textContent = 'Take screenshot';
  shotBtn.addEventListener('click', handlers.onTakeScreenshot);

  const shots = el('div', 'shots');

  body.append(
    labelEl('Bug name'), nameInput, nameErr,
    labelEl('Description'), descInput,
    labelEl('Project'), projectSelect, projectErr, noProjects,
    teamLabel, teamSelect,
    shotBtn, shots
  );

  // footer
  const foot = el('div', 'foot');
  const discard = el('button', 'ghost');
  discard.textContent = 'Discard draft';
  discard.addEventListener('click', handlers.onDiscardDraft);
  const spacer = el('div', 'spacer');
  const save = /** @type {HTMLButtonElement} */ (el('button', 'primary'));
  save.textContent = 'Save bug';
  save.addEventListener('click', handlers.onSave);
  foot.append(discard, spacer, save);

  const toastSlot = el('div', 'toast-slot');

  panel.append(head, body, foot, toastSlot);

  function renderShots() {
    shots.innerHTML = '';
    images.forEach((img, i) => {
      const wrap = el('div', 'shot');
      const canvas = /** @type {HTMLCanvasElement} */ (
        document.createElement('canvas')
      );
      canvas.width = 64;
      canvas.height = 44;
      // Draw via ImageBitmap rather than <img src="data:...">: content-script
      // DOM is still subject to the page's CSP, and a strict img-src would
      // blank a data-URI image. A canvas loads no URL at all.
      fetch(img.dataUrl)
        .then((r) => r.blob())
        .then(createImageBitmap)
        .then((bmp) => {
          canvas.getContext('2d')?.drawImage(bmp, 0, 0, 64, 44);
        })
        .catch(() => {});
      const rm = el('button', 'rm');
      rm.textContent = '×';
      rm.title = 'Remove';
      rm.addEventListener('click', () => {
        images.splice(i, 1);
        renderShots();
        handlers.onChange();
      });
      wrap.append(canvas, rm);
      shots.append(wrap);
    });
    shotBtn.disabled = images.length >= MAX_IMAGES;
    shotBtn.textContent =
      images.length >= MAX_IMAGES
        ? `Screenshot limit reached (${MAX_IMAGES})`
        : images.length
          ? 'Take another screenshot'
          : 'Take screenshot';
  }

  return {
    element: panel,

    getValues() {
      const project = projects.find((p) => p.id === projectSelect.value);
      const teamId =
        project && project.teams.length === 1
          ? project.teams[0].id
          : teamSelect.value || null;
      return {
        title: nameInput.value.trim(),
        description: descInput.value,
        projectId: projectSelect.value || null,
        teamId,
      };
    },

    /** @param {import('../lib/types.js').Draft} draft */
    setValues(draft) {
      nameInput.value = draft.title ?? '';
      descInput.value = draft.description ?? '';
      if (draft.projectId && projects.some((p) => p.id === draft.projectId)) {
        projectSelect.value = draft.projectId;
      }
      syncTeamSelect();
      if (draft.teamId) {
        const has = Array.from(teamSelect.options).some(
          (o) => o.value === draft.teamId
        );
        if (has) teamSelect.value = draft.teamId;
      }
      images = (draft.images ?? []).slice(0, MAX_IMAGES);
      renderShots();
    },

    /** @param {CapturedImage} img */
    addImage(img) {
      if (images.length >= MAX_IMAGES) return;
      images.push(img);
      renderShots();
    },

    getImages: () => images,

    clear() {
      nameInput.value = '';
      descInput.value = '';
      images = [];
      renderShots();
      nameErr.classList.add('hidden');
      projectErr.classList.add('hidden');
      toastSlot.innerHTML = '';
    },

    /** @param {string|null} label null re-enables the button. */
    setBusy(label) {
      save.disabled = Boolean(label);
      save.textContent = label ?? 'Save bug';
    },

    /**
     * @param {'title'|'project'} field
     * @param {string|null} message
     */
    setFieldError(field, message) {
      const node = field === 'title' ? nameErr : projectErr;
      node.textContent = message ?? '';
      node.classList.toggle('hidden', !message);
    },

    /**
     * @param {string} message
     * @param {{label: string, onClick: () => void}} [action]
     */
    showToast(message, action) {
      toastSlot.innerHTML = '';
      const toast = el('div', 'toast');
      toast.textContent = message;
      if (action) {
        const btn = el('button', 'ghost');
        btn.textContent = action.label;
        btn.addEventListener('click', action.onClick);
        toast.append(document.createElement('br'), btn);
      }
      toastSlot.append(toast);
    },

    clearToast() {
      toastSlot.innerHTML = '';
    },

    /**
     * @param {string} identifier
     * @param {string} url
     */
    showSuccess(identifier, url) {
      panel.innerHTML = '';
      const box = el('div', 'success');
      const id = el('div', 'id');
      id.textContent = `${identifier} created`;
      const link = el('a');
      link.textContent = 'Open in Linear';
      link.addEventListener('click', () => handlers.onOpenUrl(url));
      box.append(id, link);
      panel.append(box);
    },
  };
}

/**
 * @param {string} tag
 * @param {string} [cls]
 * @returns {HTMLElement}
 */
function el(tag, cls) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

/** @param {string} text */
function labelEl(text) {
  const node = document.createElement('label');
  node.textContent = text;
  return node;
}

/**
 * @param {string} value
 * @param {string} text
 */
function optionEl(value, text) {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = text;
  return node;
}
