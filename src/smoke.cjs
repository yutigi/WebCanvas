// Opt-in integration check against real Electron APIs and a local-only fixture.
exports.run = async ({ win, views, command, receiveLayout, core, app }) => {
  const assert = require('node:assert/strict');
  const http = require('node:http');
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const waitFor = async (predicate, label, timeout = 15000) => {
    const deadline = Date.now() + timeout;
    while (!await predicate()) {
      if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };
  const captureWhenReady = async (webContents, label) => {
    let image;
    await waitFor(async () => {
      try { image = await webContents.capturePage(); return !image.isEmpty(); }
      catch { return false; } // A newly shown native view may not have a compositor frame yet.
    }, label);
    return image;
  };
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" });
    if (req.url === '/media') {
      res.end(`<!doctype html><title>Video fixture</title><style>body{margin:0}video{width:100%;height:100vh;object-fit:fill}</style><video muted playsinline></video><script>
        const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 120;
        const context = canvas.getContext('2d');
        window.paintVideo = () => { context.fillStyle = 'hsl(' + (Date.now() / 10 % 360) + ',100%,50%)'; context.fillRect(0, 0, 160, 120); };
        paintVideo(); setInterval(paintVideo, 100);
        const video = document.querySelector('video'); video.srcObject = canvas.captureStream(10);
        window.videoFrames = 0;
        function frame() { window.videoFrames++; video.requestVideoFrameCallback(frame); }
        video.requestVideoFrameCallback(frame);
      </script>`);
      return;
    }
    res.end(`<!doctype html><title>${req.url === '/two' ? 'Second page' : 'First page'}</title><h1>Live browser fixture</h1><a href="/two">Next page</a><input aria-label="Test input"><button onclick="this.textContent='Clicked'">Click me</button>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await waitFor(() => views.size >= 1, 'renderer initialization');
    const url = `http://127.0.0.1:${server.address().port}/one`;
    const a = core.createNode('browser', 0, 0, { url, w: 400, h: 400 });
    const b = core.createNode('browser', 450, 0, { url, w: 400, h: 400 });
    const board = { version: 1, name: 'Smoke', nodes: [a, b], camera: { x: 100, y: 100, z: 1 } };
    await command('sync', board);
    await waitFor(() => [...views.values()].every(e => e.loaded), 'live fixture loading');
    const wc = views.get(a.id).view.webContents;
    assert.notEqual(views.get(a.id).session, views.get(b.id).session);
    assert.deepEqual(await wc.executeJavaScript('({node: typeof require, bridge: typeof window.webCanvas})'), { node: 'undefined', bridge: 'undefined' });
    const prefs = wc.getLastWebPreferences();
    assert.equal(prefs.sandbox, true); assert.equal(prefs.nodeIntegration, false); assert.equal(prefs.webSecurity, true); assert.equal(prefs.contextIsolation, true);
    assert.equal(wc.backgroundThrottling, false);
    await views.get(a.id).session.cookies.set({ url, name: 'isolation', value: 'a' });
    assert.equal((await views.get(b.id).session.cookies.get({ url })).length, 0);
    const frame = { x: 240, y: 141, width: 1150, height: 650 };
    receiveLayout({ ...board, viewport: frame, blocked: false, occluders: [] });
    assert.equal(views.get(a.id).view.getVisible(), true);
    assert.equal(views.get(b.id).view.getVisible(), true);
    assert.equal((await captureWhenReady(wc, 'live browser snapshot')).isEmpty(), false);
    await wc.executeJavaScript("document.querySelector('input').focus()");
    wc.insertText('Interactive');
    await waitFor(async () => await wc.executeJavaScript("document.querySelector('input').value") === 'Interactive', 'typing');
    await wc.executeJavaScript("document.querySelector('button').click()");
    assert.equal(await wc.executeJavaScript("document.querySelector('button').textContent"), 'Clicked');
    await wc.executeJavaScript("document.querySelector('a').click()");
    await waitFor(() => wc.getURL().endsWith('/two') && !wc.isLoading(), 'navigation');
    await command('browser', { id: a.id, command: 'back' });
    await waitFor(() => wc.getURL().endsWith('/one') && !wc.isLoading(), 'back');
    await command('browser', { id: a.id, command: 'forward' });
    await waitFor(() => wc.getURL().endsWith('/two') && !wc.isLoading(), 'forward');
    await command('browser', { id: a.id, command: 'reload' });
    await waitFor(() => views.get(a.id).loaded && !wc.isLoading(), 'reload');
    await assert.rejects(() => command('navigate', { id: a.id, url: 'file:///secret' }));
    await command('navigate', { id: a.id, url: url.replace('/one', '/media') });
    await waitFor(() => views.get(a.id).loaded && !wc.isLoading(), 'video fixture loading');
    receiveLayout({ ...board, viewport: frame, blocked: false });
    await wc.executeJavaScript("document.querySelector('video').play()", true);
    await waitFor(async () => await wc.executeJavaScript('window.videoFrames') > 2, 'video playback');
    views.get(b.id).view.webContents.focus();
    const framesBeforeBlur = await wc.executeJavaScript('window.videoFrames');
    await waitFor(async () => await wc.executeJavaScript('window.videoFrames') > framesBeforeBlur + 2, 'unfocused live video');
    await waitFor(() => views.get(a.id).mediaPlaying, 'media playback detection');
    await win.webContents.executeJavaScript(`window.smokeSnapshots = []; window.webCanvas.onEvent(event => {
      if (event.type === 'snapshot' && event.id === ${JSON.stringify(a.id)}) window.smokeSnapshots.push(event.src);
    }); void 0;`);
    receiveLayout({ ...board, viewport: frame, blocked: true });
    assert.equal(views.get(a.id).view.getVisible(), false);
    win.blur();
    await waitFor(() => !win.isFocused(), 'app focus loss');
    const hiddenFrames = await wc.executeJavaScript('window.videoFrames');
    await waitFor(async () => await wc.executeJavaScript('window.videoFrames') > hiddenFrames + 2, 'hidden video keeps rendering', 5000);
    await waitFor(async () => await win.webContents.executeJavaScript('new Set(window.smokeSnapshots).size >= 3'), 'changing video previews within five seconds', 5000);
    await wc.executeJavaScript("document.querySelector('video').pause()");
    await waitFor(() => !views.get(a.id).mediaPlaying, 'paused media returns to slow previews');
    await wc.executeJavaScript("document.querySelector('video').play()", true);
    await waitFor(() => views.get(a.id).mediaPlaying, 'resumed media detection');
    await command('browser', { id: a.id, command: 'reload' });
    await waitFor(() => views.get(a.id).loaded && !wc.isLoading(), 'media reload');
    assert.equal(views.get(a.id).mediaPlaying, false);
    await command('recovery-save', board);
    assert.deepEqual((await command('recovery-load')).board, core.validateBoard(board));
    // Only capture the trusted shell here; the fixture contains no private data.
    await fs.mkdir(path.resolve(__dirname, '../.cache'), { recursive: true });
    await fs.writeFile(path.resolve(__dirname, '../.cache/desktop-smoke.png'), (await captureWhenReady(win.webContents, 'shell snapshot')).toPNG());
    await command('sync', { ...board, nodes: [] });
    assert.equal(views.size, 0);
    await waitFor(() => wc.isDestroyed(), 'browser view cleanup');
    console.log('Desktop smoke passed: live pages, unfocused and hidden video, changing media previews, input, history, reload, snapshots, isolated sessions, sandbox, URL policy, recovery, and view cleanup.');
  } finally { server.close(); }
  app.exit(0);
};
