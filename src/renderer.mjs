import { LIMITS, PALETTE, clamp, createBoard, createNode, normalizeUrl, validateBoard, fitCamera } from './core.mjs';
import { icon, hydrateIcons } from './icons.mjs';
import { openThemeEditor } from './theme-editor.mjs';

const $ = selector => document.querySelector(selector);
const desktop = !!window.webCanvas?.desktop;
const viewport = $('#viewport'), world = $('#world');
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const snapshots = new Map(), browserStates = new Map(), cards = new Map();
let board = createBoard(), selected = null, tool = 'select', space = false, drag = null, editing = null, modal = false, presenting = false, stop = 0;
let dirty = false, revision = 0, recoveryTimer, frame, toastTimer, dialogSubmit, dialogCancel, syncQueue = Promise.resolve(), liveIds = new Set();
const undo = [], redo = [];
let minimapBounds;
const displayNodes = () => presenting ? [...board.nodes.filter(n => n.id !== selected), ...board.nodes.filter(n => n.id === selected)] : board.nodes;

hydrateIcons();
async function invoke(action, payload) {
  if (!desktop) return {};
  const result = await window.webCanvas.invoke(action, payload);
  if (result?.error) throw new Error(result.error);
  return result;
}
function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6000);
}
function checkpoint() {
  undo.push(JSON.stringify(board));
  if (undo.length > 20) undo.shift();
  redo.length = 0;
}
function changed() {
  dirty = true;
  revision++;
  $('#save-dot').classList.remove('saved');
  $('#save-status').textContent = 'Changes kept in local recovery';
  clearTimeout(recoveryTimer);
  recoveryTimer = setTimeout(() => saveRecovery().catch(error => toast(`Recovery could not be saved: ${error.message}`)), 1100);
}
async function saveRecovery() {
  if (desktop) await invoke('recovery-save', board);
  else localStorage.setItem('webcanvas-recovery-v1', JSON.stringify(validateBoard(board)));
}
function sync() {
  if (!desktop) return;
  const copy = structuredClone(board);
  syncQueue = syncQueue.then(() => invoke('sync', copy)).then(scheduleLayout).catch(error => toast(error.message));
}
function scheduleLayout() {
  if (!frame) frame = requestAnimationFrame(() => { frame = null; updateCamera(); sendLayout(); });
}
function sendLayout() {
  if (!desktop) return;
  const rect = viewport.getBoundingClientRect();
  const occluders = [...document.querySelectorAll('.canvas-tools,.selection-tools,.minimap,.zoom-controls')].filter(el => el.getClientRects().length).map(el => { const r = el.getBoundingClientRect(); return { x: r.x - 4, y: r.y - 4, w: r.width + 8, h: r.height + 8 }; });
  window.webCanvas.layout({ camera: board.camera, nodes: displayNodes().map(({ id, type, x, y, w, h }) => ({ id, type, x, y, w, h })), occluders, viewport: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, blocked: modal || !!editing || !!drag || tool === 'hand' || space });
}
function updateCamera() {
  const { x, y, z } = board.camera;
  world.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
  viewport.style.backgroundSize = `${22 * z}px ${22 * z}px`;
  viewport.style.backgroundPosition = `${x}px ${y}px`;
  $('#zoom-label').textContent = `${Math.round(z * 100)}%`;
  viewport.classList.toggle('hand', tool === 'hand' || space);
  viewport.classList.toggle('panning', drag?.type === 'pan');
  renderMinimap();
}
function renderMinimap() {
  const { camera, nodes } = board;
  const visibleWorld = { x: -camera.x / camera.z, y: -camera.y / camera.z, w: viewport.clientWidth / camera.z, h: viewport.clientHeight / camera.z };
  const all = [...nodes, visibleWorld];
  const left = Math.min(...all.map(n => n.x)) - 60, top = Math.min(...all.map(n => n.y)) - 60;
  const right = Math.max(...all.map(n => n.x + n.w)) + 60, bottom = Math.max(...all.map(n => n.y + n.h)) + 60;
  const scale = Math.min(160 / (right - left), 76 / (bottom - top));
  const ox = (160 - (right - left) * scale) / 2, oy = (76 - (bottom - top) * scale) / 2;
  minimapBounds = { left, top, scale, ox, oy };
  const rect = (n, attrs) => `<rect x="${(n.x - left) * scale + ox}" y="${(n.y - top) * scale + oy}" width="${n.w * scale}" height="${n.h * scale}" rx="1" ${attrs}/>`;
  $('#minimap-svg').innerHTML = nodes.map(n => rect(n, `fill="${n.type === 'browser' ? 'var(--theme-map-browser)' : n.type === 'text' ? 'var(--theme-map-text)' : n.color}"`)).join('') + rect(visibleWorld, 'fill="var(--purple)" fill-opacity=".06" stroke="var(--purple)" stroke-width=".8"');
}
function cardMarkup(node) {
  if (node.type === 'browser') return `<div class="card-titlebar" data-drag><span class="site-icon">${icon('globe')}</span><span class="card-title">${escape(node.title)}</span><span class="card-state">${desktop ? 'LOADING' : 'PREVIEW'}</span><button data-action="focus" title="Focus website" aria-label="Focus website">${icon('expand')}</button><button data-action="remove" title="Remove website" aria-label="Remove website">${icon('close')}</button></div><div class="browser-controls"><button data-action="back" disabled title="Back" aria-label="Back">${icon('left')}</button><button data-action="forward" disabled title="Forward" aria-label="Forward">${icon('right')}</button><button data-action="reload" title="Reload" aria-label="Reload">${icon('reload')}</button><form class="address-form">${icon(node.url.startsWith('https:') ? 'lock' : 'globe')}<input class="address" aria-label="Website address" value="${escape(node.url)}" spellcheck="false"><button title="Navigate" aria-label="Navigate">${icon('arrow')}</button></form></div><div class="browser-body"><img class="snapshot" alt="Website snapshot" hidden><div class="browser-placeholder"><span class="preview-note">${desktop ? 'A window into the web' : 'Desktop browser preview'}</span><div class="placeholder-orbit">${icon('globe')}</div><strong class="placeholder-title">${escape(new URL(node.url).hostname)}</strong><p class="placeholder-description">${desktop ? 'Your live website is opening here.' : 'Real, interactive websites live here in the desktop app. Run npm start to explore.'}</p></div><button class="snapshot-action" data-action="focus">${icon('expand')}<span>Focus to browse</span></button></div><div class="resize-handle" data-resize></div>`;
  if (node.type === 'image') return `<img src="${escape(node.src)}" alt="${escape(node.title)}" draggable="false"><div class="resize-handle" data-resize></div>`;
  return `${node.type === 'note' ? `<div class="note-header" data-drag>${icon('grip')}<span>${escape(node.title)}</span></div>` : ''}<div class="node-text">${escape(node.text)}</div><div class="resize-handle" data-resize></div>`;
}
function render() {
  const ids = new Set(board.nodes.map(n => n.id));
  for (const [id, card] of cards) if (!ids.has(id)) { card.remove(); cards.delete(id); snapshots.delete(id); browserStates.delete(id); }
  board.nodes.forEach((node, index) => {
    let card = cards.get(node.id);
    if (!card) {
      card = document.createElement('div');
      card.className = `card ${node.type}`;
      card.dataset.id = node.id;
      card.innerHTML = cardMarkup(node);
      cards.set(node.id, card);
      world.append(card);
    }
    card.style.left = `${node.x}px`;
    card.style.top = `${node.y}px`;
    card.style.width = `${node.w}px`;
    card.style.height = `${node.h}px`;
    card.style.zIndex = presenting && selected === node.id ? board.nodes.length : index;
    card.style.setProperty('--node-color', node.color);
    card.classList.toggle('selected', selected === node.id);
    if (node.type !== 'browser' && node.type !== 'image' && editing !== node.id) card.querySelector('.node-text').textContent = node.text;
    if (node.type === 'browser') updateBrowser(node.id);
  });
  $('#board-name').value = board.name;
  $('#node-count').textContent = board.nodes.length;
  $('#outline-count').textContent = String(board.nodes.length).padStart(2, '0');
  $('#empty-state').hidden = board.nodes.length > 0;
  $('#outline').innerHTML = board.nodes.map(n => `<button class="outline-item ${selected === n.id ? 'selected' : ''}" data-id="${n.id}" title="Focus ${escape(n.title || n.type)}">${n.type === 'note' ? '<span class="note-dot"></span>' : icon(n.type === 'browser' ? 'globe' : n.type)}<span>${escape(n.title || n.type)}</span></button>`).join('');
  renderSelection();
  scheduleLayout();
}
function updateBrowser(id) {
  const node = board.nodes.find(n => n.id === id), card = cards.get(id);
  if (!node || !card) return;
  const state = browserStates.get(id) || {};
  card.querySelector('.card-title').textContent = node.title || new URL(node.url).hostname;
  card.querySelector('.card-state').textContent = !desktop ? 'PREVIEW' : state.error ? 'OFFLINE' : state.loading ? 'LOADING' : liveIds.has(id) ? 'LIVE' : 'SNAPSHOT';
  card.classList.toggle('is-live', liveIds.has(id));
  const address = card.querySelector('.address');
  if (document.activeElement !== address) address.value = node.url;
  card.querySelector('[data-action=back]').disabled = !state.back;
  card.querySelector('[data-action=forward]').disabled = !state.forward;
  card.querySelector('[data-action=reload]').disabled = !desktop;
  const image = card.querySelector('.snapshot');
  const snapshot = snapshots.get(id);
  image.hidden = !snapshot || !!state.error;
  if (snapshot && image.getAttribute('src') !== snapshot) image.src = snapshot;
  card.querySelector('.browser-placeholder').hidden = !!snapshot && !state.error;
  if (state.error) card.querySelector('.placeholder-description').textContent = state.error;
  else card.querySelector('.placeholder-description').textContent = desktop ? (state.loading ? 'Your live website is opening here.' : 'Focus this card to interact with the website.') : 'Real, interactive websites live here in the desktop app. Run npm start to explore.';
}
function renderSelection() {
  const node = board.nodes.find(n => n.id === selected);
  $('#selection-tools').hidden = !node || presenting || !!editing;
  if (!node) return;
  $('#selection-label').textContent = node.type.charAt(0).toUpperCase() + node.type.slice(1);
  $('#color-tools').innerHTML = ['note', 'shape'].includes(node.type) ? PALETTE.map(color => `<button class="swatch ${node.color === color ? 'current' : ''}" style="background:${color}" data-color="${color}" title="Change color to ${color}" aria-label="Change color to ${color}"></button>`).join('') : '';
}
function select(id, front = false) {
  selected = id;
  if (front && !presenting) {
    const index = board.nodes.findIndex(n => n.id === id);
    if (index >= 0 && index < board.nodes.length - 1) board.nodes.push(board.nodes.splice(index, 1)[0]);
  }
  render();
}
function centerPosition() { return { x: (viewport.clientWidth / 2 - board.camera.x) / board.camera.z, y: (viewport.clientHeight / 2 - board.camera.y) / board.camera.z }; }
function add(type, extra = {}) {
  if (board.nodes.length >= LIMITS.nodes || type === 'browser' && board.nodes.filter(n => n.type === 'browser').length >= LIMITS.browsers) { toast(`The prototype supports ${LIMITS.browsers} websites and ${LIMITS.nodes} total objects per board.`); return; }
  checkpoint();
  const center = centerPosition(), node = createNode(type, center.x - (type === 'browser' ? 310 : 145), center.y - (type === 'browser' ? 245 : 115), extra);
  board.nodes.push(node);
  changed(); sync(); select(node.id);
  if (type === 'browser') focusNode(node.id);
  return node;
}
function remove(id = selected) {
  if (!id) return;
  checkpoint();
  board.nodes = board.nodes.filter(n => n.id !== id);
  selected = null;
  changed(); sync(); render();
}
function focusNode(id, interact = false) {
  const node = board.nodes.find(n => n.id === id);
  if (!node) return;
  if (!presenting) select(id, true); else selected = id;
  if (presenting) board.camera = fitCamera([node], viewport.clientWidth, viewport.clientHeight - 50, 1);
  else {
    board.camera = fitCamera([node], viewport.clientWidth - 340, viewport.clientHeight - 100, 1);
    board.camera.x += 80; board.camera.y += 35;
  }
  if (interact && board.camera.z < 0.5) toast('This card is too large to browse at this window size. Resize the card or enlarge the window.');
  changed(); render();
  if (interact && desktop) setTimeout(() => invoke('browser', { id, command: 'focus' }).catch(error => toast(error.message)), 100);
}
function zoom(factor, origin) {
  const old = board.camera;
  const z = clamp(old.z * factor, LIMITS.minZoom, LIMITS.maxZoom);
  const point = origin || { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
  board.camera = { x: point.x - (point.x - old.x) * z / old.z, y: point.y - (point.y - old.y) * z / old.z, z };
  changed(); scheduleLayout();
}
function setTool(value) { tool = value; document.querySelectorAll('[data-tool]').forEach(el => el.classList.toggle('active', el.dataset.tool === value)); scheduleLayout(); }
function editNode(id) {
  const node = board.nodes.find(n => n.id === id);
  if (!node || !['note', 'text', 'shape'].includes(node.type) || presenting || editing) return;
  checkpoint(); editing = id; renderSelection(); sendLayout();
  const card = cards.get(id), editor = document.createElement('textarea');
  editor.className = 'node-editor'; editor.value = node.text; editor.maxLength = 8000; editor.setAttribute('aria-label', `Edit ${node.type}`);
  card.querySelector('.node-text').hidden = true;
  card.append(editor); editor.focus(); editor.select();
  editor.addEventListener('input', () => { node.text = editor.value; changed(); });
  const finish = () => { if (editing !== id) return; editing = null; editor.remove(); card.querySelector('.node-text').hidden = false; render(); };
  editor.addEventListener('blur', finish, { once: true });
  editor.addEventListener('keydown', event => { if (event.key === 'Escape' || event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); editor.blur(); } event.stopPropagation(); });
}
function openDialog({ title, description, content, submit = 'Done', iconName = 'globe', onSubmit, onCancel }) {
  if (modal) return;
  modal = true; sendLayout();
  $('#dialog-title').textContent = title; $('#dialog-description').textContent = description;
  $('#dialog-content').innerHTML = content; $('#dialog-error').textContent = '';
  $('#dialog-submit').textContent = submit; $('#dialog-submit').hidden = !onSubmit;
  $('#dialog-cancel').textContent = onSubmit ? 'Cancel' : 'Close';
  $('#dialog-icon').innerHTML = icon(iconName);
  dialogSubmit = onSubmit; dialogCancel = onCancel;
  $('#dialog').showModal();
  requestAnimationFrame(() => $('#dialog-content input')?.focus());
}
function closeDialog(cancel = false) {
  $('#dialog').close(); modal = false;
  if (cancel) dialogCancel?.();
  dialogSubmit = dialogCancel = null;
  scheduleLayout();
}
function websiteDialog() {
  openDialog({ title: 'Bring the web into your canvas.', description: 'A useful page, a new discovery, a place to start.', content: '<label class="dialog-label" for="new-url">WEBSITE ADDRESS</label><input id="new-url" class="dialog-input" placeholder="https://example.com" autocomplete="off" required><div class="dialog-hint">Each website has its own isolated session. Sign-ins stay in memory until you close the app. Up to 8 websites per canvas.</div>', submit: 'Add to canvas ↗', onSubmit: () => {
    const url = normalizeUrl($('#new-url').value);
    if (!add('browser', { url, title: new URL(url).hostname })) throw new Error('Remove a website before adding another.');
  } });
}
function help() {
  openDialog({ title: 'A little space. A lot of possibility.', description: 'Move between the big picture and the little details.', iconName: 'sparkles', content: `<div class="help-grid"><span>Select / hand tool</span><kbd>V / H</kbd><span>Add website / note / text</span><kbd>W / N / T</kbd><span>Add shape / image</span><kbd>S / I</kbd><span>Pan the canvas</span><kbd>Drag background / Space + drag</kbd><span>Zoom / fit everything</span><kbd>Ctrl + scroll / F</kbd><span>Edit a note, text, or shape</span><kbd>Double-click</kbd><span>Remove / undo / redo</span><kbd>Delete / Ctrl Z / Ctrl Shift Z</kbd><span>Save / open board</span><kbd>Ctrl S / Ctrl O</kbd><span>Present / previous / next / exit</span><kbd>P / ← / → / Esc</kbd></div><div class="engine-info">${desktop ? '<strong>Chromium, on your canvas.</strong>' : '<strong>You are in the canvas-only preview.</strong> Run <code>npm install</code> and <code>npm start</code> for live websites.'}<br>At 50–175% zoom, fully visible, uncovered websites are live. Distant, clipped, or covered cards show periodic snapshots. Use Focus to browse them. Pages re-render at the canvas scale; this is not a pixel-perfect camera transform.<br><br>Drag a card by its header; resize from its lower-right corner. Notes and text move by dragging their body. Presentation follows the object list order. Browser content remains interactive on live presentation stops.<br><br>Camera, microphone, geolocation, downloads, popups, HTTP authentication, and external protocols are blocked. DRM, passkeys, and some sign-in flows may fail. Board files contain layout, text, images, and URLs—not cookies or browsing history.</div>` });
}
function confirmAction(title, description, submit) {
  return new Promise(resolve => openDialog({ title, description, content: '', iconName: 'canvas', submit, onSubmit: () => resolve(true), onCancel: () => resolve(false) }));
}
async function saveBoard(saveAs = false) {
  const savedRevision = revision;
  if (desktop) {
    modal = true; sendLayout();
    try {
      const result = await invoke(saveAs ? 'save-as' : 'save', board);
      if (result.canceled) return false;
      if (savedRevision === revision) dirty = false;
      $('#save-status').textContent = `Saved ${result.filename}`;
    } finally { modal = false; scheduleLayout(); }
  } else {
    const blob = new Blob([JSON.stringify(validateBoard(board), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `${board.name.replace(/[^\w -]/g, '') || 'Untitled'}.webcanvas`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    dirty = false; $('#save-status').textContent = 'Board exported';
  }
  if (!dirty) $('#save-dot').classList.add('saved');
  await saveRecovery();
  return true;
}
function loadBoard(raw, resetHistory = true) {
  board = validateBoard(raw); selected = null; editing = null;
  if (resetHistory) { undo.length = 0; redo.length = 0; }
  snapshots.clear(); browserStates.clear(); liveIds.clear();
  cards.forEach(el => el.remove()); cards.clear();
  changed(); sync(); render();
}
async function openBoard() {
  if (dirty && !await confirmAction('Open another perspective?', 'Your current canvas is kept in local recovery until the next edit. Save a board file first if you want to keep both.', 'Open a board')) return;
  if (!desktop) return $('#board-input').click();
  modal = true; sendLayout();
  try { const result = await invoke('open'); if (result.board) { loadBoard(result.board); dirty = false; $('#save-dot').classList.add('saved'); $('#save-status').textContent = `Opened ${result.filename}`; } }
  finally { modal = false; scheduleLayout(); }
}
async function newBoard() {
  if (dirty && !await confirmAction('Make room for something new?', 'Save a board file first to keep this canvas. Starting a new canvas replaces the local recovery copy.', 'New canvas')) return;
  if (presenting) togglePresentation(false);
  await invoke('new'); loadBoard({ version: 1, name: 'Untitled canvas', camera: { x: 100, y: 100, z: 1 }, nodes: [] });
}
function togglePresentation(value = !presenting) {
  if (value && !board.nodes.length) return toast('Add an object before presenting.');
  presenting = value; document.body.classList.toggle('presenting', value);
  $('#presentation-controls').hidden = !value;
  if (value) { stop = Math.max(0, board.nodes.findIndex(n => n.id === selected)); setTool('select'); }
  requestAnimationFrame(() => { if (value) presentationStop(0); else render(); scheduleLayout(); });
}
function presentationStop(delta) {
  stop = clamp(stop + delta, 0, board.nodes.length - 1);
  const node = board.nodes[stop];
  if (!node) return;
  $('#stop-count').textContent = `${stop + 1} / ${board.nodes.length}`;
  $('#previous-stop').disabled = stop === 0;
  $('#next-stop').disabled = stop === board.nodes.length - 1;
  $('#presentation-live').hidden = node.type !== 'browser';
  focusNode(node.id);
}

world.addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.target.closest('button,input,textarea,form') || modal || editing) return;
  if (tool === 'hand' || space) return;
  const card = event.target.closest('.card'); if (!card) return;
  const node = board.nodes.find(n => n.id === card.dataset.id);
  if (presenting) return;
  if (node.type === 'browser' && !event.target.closest('[data-drag],[data-resize]')) { select(node.id); return; }
  event.stopPropagation(); event.preventDefault();
  checkpoint(); select(node.id, true);
  drag = { type: event.target.closest('[data-resize]') ? 'resize' : 'move', id: node.id, px: event.clientX, py: event.clientY, x: node.x, y: node.y, w: node.w, h: node.h };
  viewport.setPointerCapture(event.pointerId); scheduleLayout();
});
viewport.addEventListener('pointerdown', event => {
  if (event.button !== 0 && event.button !== 1 || event.target.closest('.canvas-tools,.selection-tools,.zoom-controls,.minimap,#empty-state') || editing) return;
  if (event.target.closest('.card') && tool !== 'hand' && !space && event.button !== 1) return;
  event.preventDefault();
  selected = null; renderSelection(); cards.forEach(el => el.classList.remove('selected'));
  drag = { type: 'pan', px: event.clientX, py: event.clientY, x: board.camera.x, y: board.camera.y };
  viewport.setPointerCapture(event.pointerId); scheduleLayout();
});
viewport.addEventListener('pointermove', event => {
  if (!drag) return;
  const dx = event.clientX - drag.px, dy = event.clientY - drag.py;
  if (drag.type === 'pan') { board.camera.x = clamp(drag.x + dx, -200000, 200000); board.camera.y = clamp(drag.y + dy, -200000, 200000); }
  else {
    const node = board.nodes.find(n => n.id === drag.id);
    if (drag.type === 'move') { node.x = clamp(drag.x + dx / board.camera.z, -100000, 100000); node.y = clamp(drag.y + dy / board.camera.z, -100000, 100000); }
    else { node.w = clamp(drag.w + dx / board.camera.z, node.type === 'browser' ? 360 : 120, 1800); node.h = clamp(drag.h + dy / board.camera.z, node.type === 'browser' ? 260 : 80, 1400); }
    const card = cards.get(node.id); card.style.left = `${node.x}px`; card.style.top = `${node.y}px`; card.style.width = `${node.w}px`; card.style.height = `${node.h}px`;
  }
  scheduleLayout();
});
function endDrag() { if (drag) { drag = null; changed(); render(); } }
viewport.addEventListener('pointerup', endDrag); viewport.addEventListener('pointercancel', endDrag);
viewport.addEventListener('wheel', event => {
  if (event.target.closest('input,textarea,.canvas-tools,.selection-tools')) return;
  event.preventDefault();
  if (event.ctrlKey || event.metaKey) { const rect = viewport.getBoundingClientRect(); zoom(Math.exp(-event.deltaY * .003), { x: event.clientX - rect.x, y: event.clientY - rect.y }); }
  else { board.camera.x = clamp(board.camera.x - (event.shiftKey ? event.deltaY : event.deltaX), -200000, 200000); board.camera.y = clamp(board.camera.y - (event.shiftKey ? 0 : event.deltaY), -200000, 200000); changed(); scheduleLayout(); }
}, { passive: false });
world.addEventListener('dblclick', event => { if (!event.target.closest('button,input,textarea')) editNode(event.target.closest('.card')?.dataset.id); });
world.addEventListener('click', event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const id = button.closest('.card').dataset.id;
  const action = button.dataset.action;
  if (action === 'remove') return remove(id);
  if (action === 'focus') { if (!desktop) toast('Run npm start to use live websites in the desktop app.'); return focusNode(id, true); }
  invoke('browser', { id, command: action }).catch(error => toast(error.message));
});
world.addEventListener('submit', event => {
  event.preventDefault();
  const id = event.target.closest('.card').dataset.id;
  try {
    const url = normalizeUrl(event.target.querySelector('.address').value);
    const node = board.nodes.find(n => n.id === id); checkpoint(); node.url = url;
    browserStates.set(id, { loading: desktop }); snapshots.delete(id);
    changed(); updateBrowser(id);
    if (desktop) invoke('navigate', { id, url }).catch(error => toast(error.message)); else toast('Website address saved. Open the desktop app to browse.');
    event.target.querySelector('.address').blur(); scheduleLayout();
  } catch (error) { toast(error.message); }
});
world.addEventListener('focusin', event => { if (event.target.matches('.address')) event.target.select(); });
$('#dialog-form').addEventListener('submit', async event => {
  event.preventDefault();
  const handler = dialogSubmit;
  if (!handler) return closeDialog();
  $('#dialog-submit').disabled = true;
  try { await handler(); closeDialog(); } catch (error) { $('#dialog-error').textContent = error.message; }
  finally { $('#dialog-submit').disabled = false; }
});
$('#dialog-close').onclick = $('#dialog-cancel').onclick = () => closeDialog(true);
$('#dialog').addEventListener('cancel', event => { event.preventDefault(); closeDialog(true); });
$('#add-website').onclick = $('#empty-add').onclick = websiteDialog;
$('#help').onclick = $('#help-tip').onclick = $('#footer-help').onclick = $('#about').onclick = help;
$('#theme-settings').onclick = () => { if (!modal) openThemeEditor({ openDialog, toast }); };
$('#save-board').onclick = () => saveBoard().catch(error => toast(error.message));
$('#open-board').onclick = () => openBoard().catch(error => toast(error.message));
$('#new-board').onclick = () => newBoard().catch(error => toast(error.message));
$('#canvas-nav').onclick = $('#fit').onclick = () => { board.camera = fitCamera(board.nodes, viewport.clientWidth, viewport.clientHeight); changed(); scheduleLayout(); };
$('.brand').onclick = event => { event.preventDefault(); $('#fit').click(); };
$('#zoom-in').onclick = () => zoom(1.2); $('#zoom-out').onclick = () => zoom(1 / 1.2); $('#zoom-label').onclick = () => zoom(1 / board.camera.z);
$('#board-name').addEventListener('input', event => { board.name = event.target.value; changed(); });
$('#outline').onclick = event => { const item = event.target.closest('[data-id]'); if (item) focusNode(item.dataset.id); };
$('#delete-node').onclick = () => remove(); $('#focus-node').onclick = () => focusNode(selected, true);
$('#duplicate-node').onclick = () => { const node = board.nodes.find(n => n.id === selected); if (node) add(node.type, { ...node, id: crypto.randomUUID(), x: node.x + 30, y: node.y + 30 }); };
$('#color-tools').onclick = event => { const node = board.nodes.find(n => n.id === selected); if (node && event.target.dataset.color) { checkpoint(); node.color = event.target.dataset.color; changed(); render(); } };
$('#arrange').onclick = () => {
  checkpoint(); let x = 0, y = 0, rowHeight = 0;
  board.nodes.forEach(n => { if (x && x + n.w > 1500) { x = 0; y += rowHeight + 50; rowHeight = 0; } n.x = x; n.y = y; x += n.w + 50; rowHeight = Math.max(rowHeight, n.h); });
  board.camera = fitCamera(board.nodes, viewport.clientWidth, viewport.clientHeight); changed(); render();
};
document.querySelectorAll('[data-tool]').forEach(button => { button.onclick = () => {
  const value = button.dataset.tool;
  if (['select', 'hand'].includes(value)) return setTool(value);
  if (value === 'browser') return websiteDialog();
  if (value === 'image') return $('#image-input').click();
  setTool('select'); const node = add(value); if (node && ['text', 'note'].includes(value)) editNode(node.id);
}; });
$('#image-input').onchange = async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) return toast('Choose a PNG, JPEG, or WebP image up to 5 MB.');
  try {
    const src = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not read image.')); reader.readAsDataURL(file); });
    const image = new Image(); image.src = src; await image.decode();
    const w = Math.min(500, Math.max(150, image.naturalWidth));
    add('image', { src, title: file.name, w, h: clamp(w * image.naturalHeight / image.naturalWidth, 100, 700) });
  } catch (error) { toast(error.message); }
};
$('#board-input').onchange = async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  try { if (file.size > LIMITS.fileBytes) throw new Error('This board exceeds the 24 MB file limit.'); loadBoard(JSON.parse(await file.text())); toast(`Opened ${file.name}`); }
  catch (error) { toast(error.message); }
};
$('#minimap').onclick = event => {
  const rect = $('#minimap-svg').getBoundingClientRect(), b = minimapBounds;
  if (!b) return;
  const x = ((event.clientX - rect.left) * 160 / rect.width - b.ox) / b.scale + b.left;
  const y = ((event.clientY - rect.top) * 76 / rect.height - b.oy) / b.scale + b.top;
  board.camera.x = viewport.clientWidth / 2 - x * board.camera.z; board.camera.y = viewport.clientHeight / 2 - y * board.camera.z; changed(); scheduleLayout();
};
$('#present').onclick = () => togglePresentation(); $('#exit-presentation').onclick = () => togglePresentation(false);
$('#previous-stop').onclick = () => presentationStop(-1); $('#next-stop').onclick = () => presentationStop(1);
$('#presentation-live').onclick = () => { const node = board.nodes[stop]; if (node) { focusNode(node.id, true); if (!desktop) toast('Live browsing is available in the desktop app.'); } };
function historyChange(forward = false) {
  const from = forward ? redo : undo, to = forward ? undo : redo;
  if (!from.length) return;
  to.push(JSON.stringify(board)); loadBoard(JSON.parse(from.pop()), false);
}
function shortcut(key, ctrl = false, shift = false) {
  if (key === 'escape') { if (modal) return closeDialog(true); if (presenting) return togglePresentation(false); setTool('select'); selected = null; render(); return; }
  if (modal) return;
  if (ctrl) {
    if (key === 's') saveBoard(shift).catch(error => toast(error.message));
    if (key === 'o') openBoard().catch(error => toast(error.message));
    if (key === 'z') historyChange(shift);
    if (key === 'y') historyChange(true);
    if (key === 'l' && selected) { const input = cards.get(selected)?.querySelector('.address'); input?.focus(); input?.select(); }
    return;
  }
  if (presenting) { if (key === 'arrowright') presentationStop(1); if (key === 'arrowleft') presentationStop(-1); return; }
  if (key === 'delete' || key === 'backspace') remove();
  else if (key === 'v') setTool('select'); else if (key === 'h') setTool('hand');
  else if (key === 'w') websiteDialog(); else if (key === 'n' || key === 't') { const node = add(key === 'n' ? 'note' : 'text'); if (node) editNode(node.id); }
  else if (key === 's') add('shape'); else if (key === 'i') $('#image-input').click();
  else if (key === 'f') $('#fit').click(); else if (key === 'p') togglePresentation(); else if (key === '?') help();
}
document.addEventListener('keydown', event => {
  if (event.target.matches('input,textarea,select,[contenteditable=true]')) return;
  if (event.target.closest('button') && [' ', 'Enter'].includes(event.key)) return;
  if (event.code === 'Space' && !modal) { event.preventDefault(); space = true; scheduleLayout(); return; }
  if (event.ctrlKey || event.metaKey || ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight'].includes(event.key)) event.preventDefault();
  shortcut(event.key.toLowerCase(), event.ctrlKey || event.metaKey, event.shiftKey);
});
document.addEventListener('keyup', event => { if (event.code === 'Space') { space = false; scheduleLayout(); } });
window.addEventListener('blur', () => { space = false; endDrag(); scheduleLayout(); });
new ResizeObserver(scheduleLayout).observe(viewport);
window.addEventListener('beforeunload', event => { if (!desktop && dirty) { event.preventDefault(); event.returnValue = ''; } });

if (desktop) {
  $('#engine-status').textContent = 'Chromium, with room to think.';
  window.webCanvas.onEvent(event => {
    if (event.type === 'snapshot') { if (board.nodes.some(n => n.id === event.id)) { snapshots.set(event.id, event.src); updateBrowser(event.id); } }
    else if (event.type === 'browser') {
      const node = board.nodes.find(n => n.id === event.id); if (!node) return;
      browserStates.set(event.id, { ...browserStates.get(event.id), ...event });
      if (event.url && /^https?:/.test(event.url) && event.url !== node.url) { node.url = event.url; changed(); }
      if (event.title && node.title !== event.title) { node.title = event.title.slice(0, 200); changed(); }
      updateBrowser(event.id);
    } else if (event.type === 'live') {
      liveIds = new Set(event.ids); board.nodes.filter(n => n.type === 'browser').forEach(n => updateBrowser(n.id));
      $('#live-status').textContent = `${event.ids.length} live · ${board.nodes.filter(n => n.type === 'browser').length - event.ids.length} snapshots`;
    } else if (event.type === 'notice') toast(event.message);
    else if (event.type === 'resize') scheduleLayout();
    else if (event.type === 'shortcut') { selected = event.id; shortcut(event.key, event.key !== 'escape'); }
    else if (event.type === 'closing') {
      (async () => {
        await saveRecovery();
        if (!dirty || await confirmAction('Close your canvas?', 'Your latest canvas will reopen from local recovery next time. Save a board file before closing to keep a named copy.', 'Close canvas')) await invoke('close');
        else scheduleLayout();
      })().catch(error => { toast(error.message); scheduleLayout(); });
    }
  });
} else $('#engine-status').textContent = 'Canvas preview · live websites need the desktop app';

try {
  const recovered = desktop ? (await invoke('recovery-load')).board : JSON.parse(localStorage.getItem('webcanvas-recovery-v1') || 'null');
  if (recovered) { board = validateBoard(recovered); dirty = true; $('#save-status').textContent = 'Restored from local recovery'; }
} catch (error) { toast(`Could not restore the last canvas: ${error.message}`); }
render(); sync();
