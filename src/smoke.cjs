// Opt-in integration check against real Electron APIs and a local-only fixture.
exports.run = async ({ win, views, command, receiveLayout, core, app }) => {
  const assert = require('node:assert/strict');
  const http = require('node:http');
  const fs = require('node:fs/promises');
  const path = require('node:path');
  assert.equal(app.getName(), 'WebCanvas');
  if (process.platform === 'win32') assert.equal(path.basename(process.execPath), 'WebCanvas.exe');
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
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    if (req.url === '/attachment') {
      res.writeHead(200, { 'Content-Disposition': 'attachment; filename=test.txt' });
      res.end('Download fixture');
      return;
    }
    if (req.url === '/no-content') { res.writeHead(204); res.end(); return; }
    if (req.url === '/pending') return; // No response until the test cancels navigation.
    if (req.url === '/failure') { req.socket.destroy(); return; }
    const links = '<a id="attachment" href="/attachment">Download</a><a id="no-content" href="/no-content">No content</a><a id="pending" href="/pending">Pending navigation</a>';
    res.writeHead(200, { 'Content-Type': 'text/html', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" });
    if (req.url.startsWith('/media')) {
      res.end(`<!doctype html><title>Video fixture</title><style>body{margin:0}video{width:45%;height:80vh;object-fit:fill}</style>${links}<video muted playsinline></video><video muted playsinline></video><script>
        const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 120;
        const context = canvas.getContext('2d');
        window.paintVideo = () => { context.fillStyle = 'hsl(' + (Date.now() / 10 % 360) + ',100%,50%)'; context.fillRect(0, 0, 160, 120); };
        paintVideo(); setInterval(paintVideo, 100);
        const videos = [...document.querySelectorAll('video')];
        for (const video of videos) video.srcObject = canvas.captureStream(10);
        const video = videos[0];
        window.videoFrames = 0;
        function frame() { window.videoFrames++; video.requestVideoFrameCallback(frame); }
        video.requestVideoFrameCallback(frame);
        if (location.search) Promise.all(videos.map(video => video.play()));
      </script>`);
      return;
    }
    res.end(`<!doctype html><title>${req.url === '/two' ? 'Second page' : 'First page'}</title><h1>Live browser fixture</h1><a href="/two">Next page</a>${links}<input aria-label="Test input"><button onclick="this.textContent='Clicked'">Click me</button>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let focusWindow;
  try {
    await waitFor(() => views.size >= 1, 'renderer initialization');
    const url = `http://127.0.0.1:${server.address().port}/one`;
    const a = core.createNode('browser', 0, 0, { url, w: 400, h: 400 });
    const b = core.createNode('browser', 450, 0, { url, w: 400, h: 400 });
    const board = { version: 1, name: 'Smoke', nodes: [a, b], camera: { x: 100, y: 100, z: 1 } };
    await command('sync', board);
    await waitFor(() => [...views.values()].every(e => e.loaded), 'live fixture loading');
    const wc = views.get(a.id).view.webContents;
    const entry = views.get(a.id);
    await win.webContents.executeJavaScript(`window.smokeSnapshots = []; window.webCanvas.onEvent(event => {
      if (event.type === 'snapshot' && event.id === ${JSON.stringify(a.id)}) window.smokeSnapshots.push(event.src);
    }); void 0;`);
    const snapshotCount = () => win.webContents.executeJavaScript('window.smokeSnapshots.length');
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
    const checkUncommittedLink = async (id, playing = false) => {
      const previousRequests = requests.filter(request => request === `/${id}`).length;
      const previousUrl = wc.getURL();
      const previousTitle = wc.getTitle();
      await wc.executeJavaScript(`document.getElementById(${JSON.stringify(id)}).click()`);
      if (id === 'pending') {
        await waitFor(() => requests.filter(request => request === '/pending').length > previousRequests, 'pending navigation starts');
        assert.equal(entry.loaded, true, 'pending navigation preserves current document readiness');
        wc.stop();
      }
      await waitFor(() => requests.filter(request => request === `/${id}`).length > previousRequests && !wc.isLoading(), `${id} navigation stops`);
      receiveLayout({ ...board, viewport: frame, blocked: false });
      assert.equal(wc.getURL(), previousUrl);
      assert.equal(wc.getTitle(), previousTitle);
      assert.equal(entry.loaded, true, `${id} retains document readiness`);
      assert.equal(entry.view.getVisible(), true, `${id} retains live browsing after layout`);
      assert.equal(entry.mediaPlaying, playing, `${id} retains playback state`);
      if (!playing) {
        await wc.executeJavaScript("document.querySelector('input').value = 'Still interactive'");
        assert.equal(await wc.executeJavaScript("document.querySelector('input').value"), 'Still interactive');
      }
      // Force a preview transition, and require the app's guarded capture path.
      const count = await snapshotCount();
      receiveLayout({ ...board, viewport: frame, blocked: true });
      await waitFor(async () => await snapshotCount() > count, `${id} existing document is capturable`);
      receiveLayout({ ...board, viewport: frame, blocked: false });
    };
    await checkUncommittedLink('attachment');
    await checkUncommittedLink('no-content');
    await checkUncommittedLink('pending');
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
    await wc.executeJavaScript("Promise.all([...document.querySelectorAll('video')].map(video => video.play()))", true);
    await waitFor(async () => await wc.executeJavaScript('window.videoFrames') > 2, 'video playback');
    views.get(b.id).view.webContents.focus();
    const framesBeforeBlur = await wc.executeJavaScript('window.videoFrames');
    await waitFor(async () => await wc.executeJavaScript('window.videoFrames') > framesBeforeBlur + 2, 'unfocused live video');
    await waitFor(() => views.get(a.id).mediaPlaying, 'media playback detection');
    await checkUncommittedLink('attachment', true);
    await checkUncommittedLink('no-content', true);
    await checkUncommittedLink('pending', true);
    await win.webContents.executeJavaScript('window.smokeSnapshots = []');
    receiveLayout({ ...board, viewport: frame, blocked: true });
    assert.equal(views.get(a.id).view.getVisible(), false);
    // Give Windows a concrete foreground target; blur() alone can leave the
    // only app window focused when there is no other activatable window.
    focusWindow = new (require('electron').BrowserWindow)({ width: 320, height: 200, title: 'WebCanvas smoke focus fixture', webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
    focusWindow.show();
    focusWindow.focus();
    await waitFor(() => !win.isFocused(), 'app focus loss');
    const hiddenFrames = await wc.executeJavaScript('window.videoFrames');
    await waitFor(async () => await wc.executeJavaScript('window.videoFrames') > hiddenFrames + 2, 'hidden video keeps rendering', 5000);
    await waitFor(async () => await win.webContents.executeJavaScript('new Set(window.smokeSnapshots).size >= 3'), 'changing video previews within five seconds', 5000);
    await wc.executeJavaScript("document.querySelector('video').pause()");
    assert.equal(await wc.executeJavaScript("document.querySelectorAll('video')[1].paused"), false);
    // Discard any pause-triggered capture; more changing previews must arrive on schedule.
    await waitFor(() => !entry.capturing, 'pause capture completion');
    await win.webContents.executeJavaScript('window.smokeSnapshots = []');
    await waitFor(async () => await win.webContents.executeJavaScript('new Set(window.smokeSnapshots).size >= 3'), 'remaining player keeps fast previews', 5000);
    await wc.executeJavaScript("document.querySelectorAll('video')[1].pause()");
    await waitFor(() => !views.get(a.id).mediaPlaying, 'paused media returns to slow previews');
    await waitFor(() => !entry.capturing, 'final pause capture completion');
    const pausedCaptures = await snapshotCount();
    // A capture age of two seconds is eligible only at the fast cadence.
    entry.lastCaptureAt = Date.now() - 2000;
    await new Promise(resolve => setTimeout(resolve, 2200));
    assert.equal(await snapshotCount(), pausedCaptures, 'final pause stops fast previews');
    await waitFor(async () => await snapshotCount() > pausedCaptures, 'paused page still receives slow previews', 6500);
    await wc.executeJavaScript("document.querySelector('video').play()", true);
    await waitFor(() => views.get(a.id).mediaPlaying, 'resumed media detection');
    await command('browser', { id: a.id, command: 'reload' });
    await waitFor(() => views.get(a.id).loaded && !wc.isLoading(), 'media reload');
    await waitFor(() => !entry.mediaPlaying, 'reload clears old players');
    // New players may start while old-document teardown is still being delivered.
    await wc.executeJavaScript("Promise.all([...document.querySelectorAll('video')].map(video => video.play()))", true);
    await command('navigate', { id: a.id, url: url.replace('/one', '/media?autoplay') });
    await waitFor(async () => entry.loaded && !wc.isLoading() && await wc.executeJavaScript("[...document.querySelectorAll('video')].every(video => !video.paused)"), 'replacement players start');
    await wc.executeJavaScript("document.querySelector('video').pause()");
    await win.webContents.executeJavaScript('window.smokeSnapshots = []');
    await waitFor(async () => await win.webContents.executeJavaScript('new Set(window.smokeSnapshots).size >= 3'), 'replacement retains remaining player previews', 5000);
    await command('navigate', { id: a.id, url: url.replace('/one', '/two') });
    await waitFor(() => entry.loaded && !wc.isLoading() && !entry.mediaPlaying, 'non-media replacement clears old players');
    receiveLayout({ ...board, viewport: frame, blocked: false });
    const failed = new Promise(resolve => wc.once('did-fail-load', resolve));
    await command('navigate', { id: a.id, url: url.replace('/one', '/failure') });
    await failed;
    await waitFor(() => !wc.isLoading(), 'failed navigation settles');
    assert.equal(entry.loaded, false, 'real load errors invalidate readiness');
    receiveLayout({ ...board, viewport: frame, blocked: false });
    assert.equal(entry.view.getVisible(), false);
    await command('navigate', { id: a.id, url: url.replace('/one', '/media?autoplay') });
    await waitFor(() => entry.loaded && !wc.isLoading() && entry.mediaPlaying, 'recovery after load error');
    const crashed = new Promise(resolve => wc.once('render-process-gone', resolve));
    wc.forcefullyCrashRenderer();
    await crashed;
    assert.equal(entry.loaded, false);
    assert.equal(entry.mediaPlaying, false);
    assert.equal(entry.view.getVisible(), false);
    await command('browser', { id: a.id, command: 'reload' });
    await waitFor(async () => entry.loaded && !wc.isLoading() && await wc.executeJavaScript("document.querySelectorAll('video').length === 2 && [...document.querySelectorAll('video')].every(video => !video.paused)"), 'recovery after renderer crash');
    await wc.executeJavaScript("document.querySelector('video').pause()");
    await waitFor(() => entry.mediaPlaying, 'recovered second player remains active');
    await wc.executeJavaScript("document.querySelectorAll('video')[1].pause()");
    await waitFor(() => !entry.mediaPlaying, 'crashed players leave no stale playback count');
    await command('recovery-save', board);
    assert.deepEqual((await command('recovery-load')).board, core.validateBoard(board));
    // Only capture the trusted shell here; the fixture contains no private data.
    await fs.mkdir(path.resolve(__dirname, '../.cache'), { recursive: true });
    await fs.writeFile(path.resolve(__dirname, '../.cache/desktop-smoke.png'), (await captureWhenReady(win.webContents, 'shell snapshot')).toPNG());
    await command('sync', { ...board, nodes: [] });
    assert.equal(views.size, 0);
    await waitFor(() => wc.isDestroyed(), 'browser view cleanup');
    console.log('Desktop smoke passed: live pages, attachment/204 document preservation, multiple-player preview cadence, unfocused and hidden video, navigation/reload media cleanup, error/crash recovery, input, history, snapshots, isolated sessions, sandbox, URL policy, recovery, and view cleanup.');
  } finally { if (focusWindow && !focusWindow.isDestroyed()) focusWindow.close(); server.close(); }
  app.exit(0);
};
