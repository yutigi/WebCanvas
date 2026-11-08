const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const colorFields = [['accent', 'Accent'], ['canvas', 'Canvas'], ['surface', 'Panels'], ['text', 'Text']];

export function openThemeEditor({ openDialog, toast }) {
  const themes = window.canvasTheme, draft = themes.getSettings(), presets = themes.getPresets();
  const pending = new Set();
  let editBlocked = false;
  let unsubscribeSystem = () => {};
  openDialog({
    title: 'Make this space yours.', description: 'Choose a preset or create your own. Preview changes, then apply to save.',
    iconName: 'palette', submit: 'Apply theme',
    onCancel: () => { unsubscribeSystem(); themes.restore(); },
    onSubmit: () => {
      if (editBlocked) throw new Error('Delete a custom theme or choose a preset before applying.');
      if (document.querySelector('.theme-editor [aria-invalid="true"]')) throw new Error('Enter colors in the format #7561d9.');
      const unnamed = draft.customThemes.find(theme => !theme.name.trim());
      if (unnamed) {
        draft.selected = unnamed.id; fillEditor(); nameInput.focus();
        throw new Error('Give every custom theme a name before applying.');
      }
      const saved = themes.commit(draft);
      unsubscribeSystem();
      toast(saved ? 'Theme saved on this computer.' : 'Theme applied for this session. Local storage could not be saved.');
    },
    content: `<div class="theme-editor">
      <div class="theme-section-heading"><h3>Theme presets</h3><button type="button" class="theme-system" id="theme-system" aria-pressed="false">Use system appearance</button></div>
      <div id="theme-presets" class="theme-preset-grid" role="group" aria-label="Theme presets"></div>
      <div id="theme-customs" class="theme-preset-grid theme-custom-grid" role="group" aria-label="Custom themes"></div>
      <div class="theme-editor-fields">
        <div class="theme-name-row">
          <div><label class="dialog-label" for="theme-name">CUSTOM THEME NAME</label><input id="theme-name" class="dialog-input" maxlength="40" required autocomplete="off"></div>
          <div><label class="dialog-label" for="theme-mode">APPEARANCE</label><select id="theme-mode" class="dialog-input"><option value="light">Light</option><option value="dark">Dark</option></select></div>
        </div>
        <div class="theme-color-grid">${colorFields.map(([key, label]) => `<div>
          <label class="dialog-label" for="theme-${key}-hex">${label.toUpperCase()}</label>
          <div class="theme-color-field"><input type="color" id="theme-${key}" data-theme-color="${key}" aria-label="${label} color picker">
          <input type="text" id="theme-${key}-hex" class="dialog-input" data-theme-hex="${key}" aria-label="${label} hex color" maxlength="7" pattern="#[0-9A-Fa-f]{6}" spellcheck="false" required></div>
        </div>`).join('')}</div>
        <div class="theme-editor-note"><output id="theme-contrast" aria-live="polite"></output><button type="button" id="theme-delete" class="theme-delete" hidden>Delete custom theme</button></div>
      </div>
    </div>`
  });
  const editor = document.querySelector('.theme-editor');
  const nameInput = editor.querySelector('#theme-name'), modeInput = editor.querySelector('#theme-mode');
  const error = document.getElementById('dialog-error');
  function card(theme) {
    return `<button type="button" class="theme-preset" data-theme-id="${theme.id}" aria-pressed="${theme.id === draft.selected}">
      <span class="theme-preview" aria-hidden="true" style="--preview-canvas:${theme.colors.canvas};--preview-surface:${theme.colors.surface};--preview-accent:${theme.colors.accent}"></span>
      <span class="theme-preset-name">${escapeHtml(theme.name || 'My theme')}</span></button>`;
  }
  function renderChoices() {
    const focusedId = document.activeElement?.dataset.themeId;
    editor.querySelector('#theme-presets').innerHTML = presets.map(card).join('');
    editor.querySelector('#theme-customs').innerHTML = draft.customThemes.map(card).join('');
    editor.querySelector('#theme-customs').hidden = !draft.customThemes.length;
    editor.querySelector('#theme-system').setAttribute('aria-pressed', String(draft.selected === 'system'));
    editor.querySelector('#theme-delete').hidden = !draft.selected.startsWith('custom-');
    if (focusedId) editor.querySelector(`[data-theme-id="${focusedId}"]`)?.focus({ preventScroll: true });
  }
  function preview() {
    themes.preview(draft);
    const { text, canvas, surface } = themes.resolve(draft).colors;
    editor.querySelector('#theme-contrast').textContent = `Text contrast ${Math.min(themes.contrast(text, surface), themes.contrast(text, canvas)).toFixed(1)}:1`;
  }
  function fillEditor() {
    const theme = themes.resolve(draft);
    nameInput.value = draft.selected.startsWith('custom-') ? theme.name : `${theme.name} custom`;
    modeInput.value = theme.mode;
    for (const [key] of colorFields) {
      editor.querySelector(`#theme-${key}`).value = theme.colors[key];
      const hex = editor.querySelector(`#theme-${key}-hex`);
      hex.value = theme.colors[key]; hex.setCustomValidity(''); hex.removeAttribute('aria-invalid');
    }
    error.textContent = ''; editBlocked = false;
    renderChoices(); preview();
  }
  function select(id) {
    // Trying a different preset discards a new, unapplied custom draft.
    draft.customThemes = draft.customThemes.filter(t => !pending.has(t.id) || t.id === id);
    for (const candidate of pending) if (candidate !== id) pending.delete(candidate);
    draft.selected = id; fillEditor();
  }
  function edit(change) {
    let theme = draft.customThemes.find(t => t.id === draft.selected);
    if (!theme) {
      if (draft.customThemes.length >= 12) { editBlocked = true; error.textContent = 'You can save up to 12 custom themes. Delete one to add another.'; return; }
      theme = { ...themes.resolve(draft), id: `custom-${crypto.randomUUID()}`, name: nameInput.value };
      draft.customThemes.push(theme); pending.add(theme.id); draft.selected = theme.id;
    }
    change(theme); editBlocked = false; error.textContent = ''; renderChoices(); preview();
  }
  editor.addEventListener('click', event => {
    const choice = event.target.closest('[data-theme-id]');
    if (choice) select(choice.dataset.themeId);
  });
  editor.querySelector('#theme-system').onclick = () => select('system');
  nameInput.oninput = () => edit(theme => { theme.name = nameInput.value; });
  modeInput.onchange = () => edit(theme => { theme.mode = modeInput.value; });
  editor.querySelectorAll('[data-theme-color],[data-theme-hex]').forEach(input => {
    input.oninput = () => {
      const key = input.dataset.themeColor || input.dataset.themeHex, value = input.value.toLowerCase();
      const valid = themes.validColor(value);
      input.setCustomValidity(valid ? '' : 'Use a six-digit hex color, such as #7561d9.');
      input.setAttribute('aria-invalid', String(!valid));
      if (!valid) return;
      const picker = editor.querySelector(`#theme-${key}`), hex = editor.querySelector(`#theme-${key}-hex`);
      picker.value = value; hex.value = value; hex.setCustomValidity(''); hex.removeAttribute('aria-invalid');
      edit(theme => { theme.colors[key] = value; });
    };
  });
  editor.querySelector('#theme-delete').onclick = () => {
    const mode = themes.resolve(draft).mode;
    draft.customThemes = draft.customThemes.filter(t => t.id !== draft.selected);
    pending.delete(draft.selected);
    draft.selected = mode; fillEditor();
  };
  fillEditor();
  unsubscribeSystem = themes.onSystemChange(() => {
    if (draft.selected === 'system') fillEditor();
  });
}
