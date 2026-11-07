// Opt-in integration check against real Electron APIs and a local-only fixture.
exports.run = async ({ win, views, command, receiveLayout, core, app }) => {
  const assert = require('node:assert/strict');
  const http = require('node:http');
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const waitFor = async (predicate, label) => {
    const deadline = Date.now() + 15000;
    while (!await predicate()) {
      if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" });
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
    await views.get(a.id).session.cookies.set({ url, name: 'isolation', value: 'a' });
    assert.equal((await views.get(b.id).session.cookies.get({ url })).length, 0);
    const frame = { x: 240, y: 141, width: 1150, height: 650 };
    receiveLayout({ ...board, viewport: frame, blocked: false, occluders: [] });
    assert.equal(views.get(a.id).view.getVisible(), true);
    assert.equal(views.get(b.id).view.getVisible(), true);
    assert.equal((await wc.capturePage()).isEmpty(), false);
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
    receiveLayout({ ...board, viewport: frame, blocked: true });
    assert.equal(views.get(a.id).view.getVisible(), false);
    await command('recovery-save', board);
    assert.deepEqual((await command('recovery-load')).board, core.validateBoard(board));
    // Only capture the trusted shell here; the fixture contains no private data.
    await fs.mkdir(path.resolve(__dirname, '../.cache'), { recursive: true });
    await fs.writeFile(path.resolve(__dirname, '../.cache/desktop-smoke.png'), (await win.webContents.capturePage()).toPNG());
    await command('sync', { ...board, nodes: [] });
    assert.equal(views.size, 0); assert.equal(wc.isDestroyed(), true);
    console.log('Desktop smoke passed: live pages, input, history, reload, snapshots, isolated sessions, sandbox, URL policy, recovery, and view cleanup.');
  } finally { server.close(); }
  app.exit(0);
};
