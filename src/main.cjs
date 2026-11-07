const { app, BrowserWindow, WebContentsView, ipcMain, dialog, session, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const smoke = process.env.WEBCANVAS_SMOKE === '1';
if (smoke) app.setPath('userData', path.resolve(__dirname, '../.cache/smoke-profile'));
app.enableSandbox();
let win, core, snapshotTimer, currentPath, closing = false;
const views = new Map();
let latestLayout;
let recoveryQueue = Promise.resolve();
const shellUrl = pathToFileURL(path.join(__dirname, 'index.html')).href;
const emit = (payload) => { if (win && !win.isDestroyed()) win.webContents.send('canvas:event', payload); };
const authorized = (event) => win && event.sender === win.webContents && event.senderFrame && event.senderFrame === win.webContents.mainFrame && event.senderFrame.url.split('#')[0] === shellUrl;
function hideViews() { for (const entry of views.values()) entry.view.setVisible(false); }
function destroyView(id) {
  const entry = views.get(id);
  if (!entry) return;
  views.delete(id);
  win.contentView.removeChildView(entry.view);
  if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
  entry.session.clearStorageData().catch(() => {});
  entry.session.closeAllConnections().catch(() => {});
}
function report(entry, extra = {}) {
  const wc = entry.view.webContents;
  if (wc.isDestroyed()) return;
  if (core.isWebUrl(wc.getURL())) entry.url = wc.getURL();
  emit({ type: 'browser', id: entry.id, url: entry.url, title: wc.getTitle(), loading: wc.isLoading(), back: wc.navigationHistory.canGoBack(), forward: wc.navigationHistory.canGoForward(), ...extra });
}
async function capture(entry) {
  const wc = entry.view.webContents;
  if (entry.capturing || wc.isDestroyed() || wc.isLoading() || !entry.loaded) return;
  entry.capturing = true;
  try {
    const image = await wc.capturePage(undefined, { stayHidden: true, stayAwake: false });
    if (!image.isEmpty() && views.get(entry.id) === entry) emit({ type: 'snapshot', id: entry.id, src: image.resize({ width: Math.min(1000, image.getSize().width) }).toDataURL() });
  } catch { /* A page can close or navigate while being captured. */ }
  finally { entry.capturing = false; }
}
function makeView(node) {
  // An ephemeral, separate session per card also prevents origin zoom/cookie coupling.
  const isolatedSession = session.fromPartition(`webcanvas-${randomUUID()}`);
  const view = new WebContentsView({ webPreferences: { session: isolatedSession, nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, devTools: false, backgroundThrottling: true, safeDialogs: true, navigateOnDragDrop: false } });
  const entry = { id: node.id, view, session: isolatedSession, url: node.url, loaded: false, capturing: false };
  const wc = view.webContents;
  views.set(node.id, entry);
  view.setBounds({ x: 0, y: 0, width: Math.round(node.w - 2), height: Math.round(node.h - 85) });
  view.setBackgroundColor('#ffffff');
  win.contentView.addChildView(view);
  view.setVisible(false);
  isolatedSession.setPermissionCheckHandler(() => false);
  isolatedSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(false);
    emit({ type: 'notice', message: `${permission} permission was blocked. Device access is disabled in this prototype.` });
  });
  isolatedSession.setDevicePermissionHandler(() => false);
  isolatedSession.on('will-download', (event, item) => { event.preventDefault(); item.cancel(); emit({ type: 'notice', message: 'Downloads are disabled in this prototype.' }); });
  wc.setWindowOpenHandler(() => { emit({ type: 'notice', message: 'A popup was blocked. Add its website as a new card instead.' }); return { action: 'deny' }; });
  const guard = (event, url) => {
    if (!core.isWebUrl(url)) { event.preventDefault(); emit({ type: 'notice', message: 'Navigation blocked: only HTTP and HTTPS websites are allowed.' }); }
  };
  wc.on('will-navigate', guard);
  wc.on('will-redirect', (event, url, _inPlace, isMainFrame) => { if (isMainFrame) guard(event, url); });
  wc.on('will-frame-navigate', event => { if (event.isMainFrame) guard(event, event.url); });
  wc.on('will-attach-webview', event => event.preventDefault());
  for (const name of ['did-start-loading', 'did-stop-loading', 'page-title-updated', 'did-navigate', 'did-navigate-in-page']) wc.on(name, () => report(entry));
  wc.on('did-finish-load', () => { entry.loaded = true; report(entry, { error: null }); applyLayout(); setTimeout(() => capture(entry), 500); });
  wc.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3) { entry.loaded = false; view.setVisible(false); report(entry, { error: `Could not load ${url}: ${description}` }); }
  });
  wc.on('render-process-gone', () => { entry.loaded = false; view.setVisible(false); report(entry, { error: 'This website stopped responding. Use Reload to try again.' }); });
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'Escape' || ((input.control || input.meta) && ['s', 'o', 'l'].includes(input.key.toLowerCase()))) {
      event.preventDefault();
      win.webContents.focus();
      emit({ type: 'shortcut', key: input.key.toLowerCase(), id: entry.id });
    }
  });
  wc.loadURL(node.url).catch(() => {});
  return entry;
}
function applyLayout() {
  if (!latestLayout || !win || win.isDestroyed()) return;
  const { board, viewport, blocked, occluders } = latestLayout;
  const visible = [];
  for (const [index, node] of board.nodes.entries()) {
    const entry = views.get(node.id);
    if (!entry) continue;
    const bounds = core.contentRect(node, board.camera, viewport);
    const live = entry.loaded && core.liveEligibility(node, index, board, viewport, blocked) && !occluders.some(o => core.overlaps({ x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height }, o));
    const wasLive = entry.view.getVisible();
    if (!live && wasLive) capture(entry);
    // Fully-contained views only: native content must never cover the app chrome.
    entry.view.setVisible(live);
    if (live) {
      entry.view.setBounds(bounds);
      entry.view.webContents.setZoomFactor(board.camera.z);
      visible.push(node.id);
    }
  }
  emit({ type: 'live', ids: visible });
}
function receiveLayout(payload) {
  if (!payload || !Array.isArray(payload.nodes) || payload.nodes.length > core.LIMITS.nodes) return;
  const size = win.getContentBounds();
  const vp = payload.viewport;
  if (!vp || ![vp.x, vp.y, vp.width, vp.height].every(Number.isFinite) || vp.x < 0 || vp.y < 0 || vp.width <= 0 || vp.height <= 0 || vp.x + vp.width > size.width + 1 || vp.y + vp.height > size.height + 1) return;
  try {
    const board = core.validateBoard({ version: 1, camera: payload.camera, nodes: payload.nodes.map(n => ({ ...n, type: views.has(n.id) ? 'browser' : 'note', url: views.get(n.id)?.url })) });
    const occluders = (Array.isArray(payload.occluders) ? payload.occluders : []).slice(0, 12).filter(o => o && [o.x, o.y, o.w, o.h].every(Number.isFinite) && o.w > 0 && o.h > 0);
    latestLayout = { board, viewport: vp, occluders, blocked: !!payload.blocked };
    applyLayout();
  } catch { /* Ignore invalid geometry rather than passing it to native APIs. */ }
}
async function syncBoard(raw) {
  const board = core.validateBoard(raw);
  const nodes = board.nodes.filter(n => n.type === 'browser');
  for (const id of views.keys()) if (!nodes.some(n => n.id === id)) destroyView(id);
  for (const node of nodes) {
    const entry = views.get(node.id);
    if (!entry) makeView(node);
    else if (entry.url !== node.url) {
      entry.url = node.url; entry.loaded = false; entry.view.setVisible(false);
      entry.view.webContents.loadURL(node.url).catch(() => {});
    }
  }
  return { ok: true };
}
async function writeBoard(filename, board) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(core.validateBoard(board), null, 2), { flag: 'wx' });
    await fs.rename(temporary, filename);
  } catch (error) { await fs.unlink(temporary).catch(() => {}); throw error; }
}
async function command(action, payload) {
  if (action === 'sync') return syncBoard(payload);
  if (action === 'navigate') {
    const entry = views.get(payload?.id);
    if (!entry) throw new Error('Website not found.');
    const url = core.normalizeUrl(payload.url);
    entry.url = url;
    entry.loaded = false;
    entry.view.setVisible(false);
    entry.view.webContents.loadURL(url).catch(() => {});
    return { url };
  }
  if (action === 'browser') {
    const entry = views.get(payload?.id);
    if (!entry) throw new Error('Website not found.');
    const wc = entry.view.webContents;
    if (payload.command === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (payload.command === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    else if (payload.command === 'reload') { entry.loaded = false; entry.view.setVisible(false); wc.reload(); }
    else if (payload.command === 'focus') wc.focus();
    return { ok: true };
  }
  if (action === 'save' || action === 'save-as') {
    const board = core.validateBoard(payload);
    hideViews();
    try {
      let filename = action === 'save' ? currentPath : null;
      if (!filename) {
        const result = await dialog.showSaveDialog(win, { title: 'Save canvas', defaultPath: `${board.name.replace(/[^\w -]/g, '') || 'Untitled'}.webcanvas`, filters: [{ name: 'Web Canvas board', extensions: ['webcanvas'] }] });
        if (result.canceled) return { canceled: true };
        filename = result.filePath;
      }
      await writeBoard(filename, board);
      currentPath = filename;
      return { ok: true, filename: path.basename(filename) };
    } finally { applyLayout(); }
  }
  if (action === 'open') {
    hideViews();
    try {
      const result = await dialog.showOpenDialog(win, { title: 'Open canvas', properties: ['openFile'], filters: [{ name: 'Web Canvas board', extensions: ['webcanvas', 'json'] }] });
      if (result.canceled) return { canceled: true };
      const filename = result.filePaths[0];
      if ((await fs.stat(filename)).size > core.LIMITS.fileBytes) throw new Error('This board exceeds the 24 MB file limit.');
      const board = core.validateBoard(JSON.parse(await fs.readFile(filename, 'utf8')));
      currentPath = filename;
      return { board, filename: path.basename(filename) };
    } finally { applyLayout(); }
  }
  if (action === 'new') { currentPath = null; return { ok: true }; }
  if (action === 'recovery-save') {
    const board = core.validateBoard(payload);
    recoveryQueue = recoveryQueue.catch(() => {}).then(() => writeBoard(path.join(app.getPath('userData'), 'recovery.webcanvas'), board));
    await recoveryQueue;
    return { ok: true };
  }
  if (action === 'recovery-load') {
    try { return { board: core.validateBoard(JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'recovery.webcanvas'), 'utf8'))) }; } catch { return { board: null }; }
  }
  if (action === 'close') { closing = true; win.close(); return { ok: true }; }
  throw new Error('Unsupported canvas command.');
}
app.whenReady().then(async () => {
  core = await import('./core.mjs');
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({ width: 1440, height: 960, minWidth: 1000, minHeight: 720, title: 'Web Canvas', backgroundColor: '#f8f9fc', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, webviewTag: false } });
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ipcMain.handle('canvas:command', async (event, action, payload) => {
    if (!authorized(event)) throw new Error('Unauthorized caller.');
    try { return await command(action, payload); } catch (error) { return { error: error.message }; }
  });
  ipcMain.on('canvas:layout', (event, payload) => { if (authorized(event)) receiveLayout(payload); });
  win.on('resize', () => { hideViews(); emit({ type: 'resize' }); });
  win.on('close', event => {
    if (!closing && !smoke) { event.preventDefault(); hideViews(); emit({ type: 'closing' }); }
    else { for (const id of views.keys()) destroyView(id); }
  });
  win.on('closed', () => { clearInterval(snapshotTimer); win = null; });
  await win.loadURL(shellUrl);
  snapshotTimer = setInterval(() => { for (const entry of views.values()) if (!entry.view.getVisible()) capture(entry); }, 8000);
  if (smoke) require('./smoke.cjs').run({ win, views, command, receiveLayout, core, app }).catch(error => { console.error(error); app.exit(1); });
}).catch(error => { console.error(error); app.exit(1); });
app.on('login', (event, _wc, _details, _auth, callback) => { event.preventDefault(); callback(); emit({ type: 'notice', message: 'HTTP authentication is not supported in this prototype.' }); });
app.on('window-all-closed', () => app.quit());
