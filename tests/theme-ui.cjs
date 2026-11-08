// Exercise the real editor and native system appearance events in an isolated profile.
const { app, BrowserWindow, nativeTheme } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
app.setPath('userData', path.resolve(__dirname, '../.cache/theme-tests-profile'));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'theme-tests-' + Date.now() } });
  const run = code => win.webContents.executeJavaScript(code);
  const waitFor = async (predicate, label) => {
    const deadline = Date.now() + 5000;
    while (!await predicate()) {
      if (Date.now() > deadline) throw new Error('Timed out: ' + label);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  };
  const open = async () => {
    await run('document.getElementById("theme-settings").click()');
    await waitFor(() => run('document.getElementById("dialog").open'), 'editor opens');
  };
  const input = (id, value) => run(`(() => { const input = document.getElementById(${JSON.stringify(id)}); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const choose = id => run(`document.querySelector('[data-theme-id="${id}"]').click()`);
  const apply = () => run('document.getElementById("dialog-submit").click()');
  const cancel = () => run('document.getElementById("dialog-cancel").click()');
  const seedCustoms = () => run(`(() => {
    const preset = window.canvasTheme.getPresets()[1];
    window.canvasTheme.commit({ selected: 'custom-a', customThemes: [{ ...preset, id: 'custom-a', name: 'A' }, { ...preset, id: 'custom-b', name: 'B' }] });
  })()`);
  const setSystem = async mode => {
    nativeTheme.themeSource = mode;
    await waitFor(() => run(`matchMedia('(prefers-color-scheme: dark)').matches === ${mode === 'dark'}`), 'system appearance changes');
  };
  await win.loadFile(path.resolve(__dirname, '../src/index.html'));
  await waitFor(() => run('!!document.querySelector(".card")'), 'renderer initializes');

  const tests = [
    ['applying another theme preserves an existing theme with an incomplete name', async () => {
      await seedCustoms(); await open();
      await input('theme-name', ''); await choose('custom-b'); await apply();
      assert.equal(await run('document.getElementById("dialog").open'), true, 'do not save while another theme has an empty name');
      assert.equal(await run('window.canvasTheme.getSettings().customThemes[0].name'), 'A');
      assert.equal(await run('document.activeElement.id'), 'theme-name');
      assert.equal(await run('document.getElementById("theme-name").value'), '', 'show the theme that needs a name');
      await input('theme-name', 'Renamed A'); await choose('custom-b'); await apply();
      await waitFor(() => run('!document.getElementById("dialog").open'), 'valid changes save');
      assert.deepEqual(await run('window.canvasTheme.getSettings().customThemes.map(t => t.name)'), ['Renamed A', 'B']);
    }],
    ['switching to a preset does not save a whitespace-only custom name', async () => {
      await seedCustoms(); await open();
      await input('theme-name', '   '); await choose('forest'); await apply();
      assert.equal(await run('document.getElementById("dialog").open'), true);
      await cancel();
      assert.equal(await run('window.canvasTheme.getSettings().customThemes[0].name'), 'A');
    }],
    ['system appearance refreshes editor fields before creating a custom theme', async () => {
      await setSystem('light');
      await run('window.canvasTheme.commit({ selected: "system", customThemes: [] })');
      await open(); await setSystem('dark');
      await waitFor(() => run('document.documentElement.dataset.theme === "dark"'), 'dark theme applies');
      assert.equal(await run('document.getElementById("theme-mode").value'), 'dark');
      assert.equal(await run('document.getElementById("theme-name").value'), 'Dark custom');
      const displayed = await run(`Object.fromEntries(['accent','canvas','surface','text'].map(key => [key, document.getElementById('theme-' + key + '-hex').value]))`);
      assert.deepEqual(displayed, await run('window.canvasTheme.resolve().colors'));
      for (const [key, value] of Object.entries(displayed)) assert.equal(await run(`document.getElementById('theme-${key}').value`), value);
      await input('theme-accent-hex', '#ff9900'); await apply();
      await waitFor(() => run('!document.getElementById("dialog").open'), 'custom theme saves');
      const saved = await run('window.canvasTheme.resolve()');
      assert.equal(saved.mode, 'dark');
      assert.deepEqual(saved.colors, { ...displayed, accent: '#ff9900' });
    }],
    ['system changes leave a custom draft intact and cancel restores system appearance', async () => {
      await setSystem('light');
      await run('window.canvasTheme.commit({ selected: "system", customThemes: [] })');
      await open(); await input('theme-canvas-hex', '#123456');
      await setSystem('dark');
      assert.equal(await run('document.getElementById("theme-mode").value'), 'light');
      assert.equal(await run('document.getElementById("theme-canvas-hex").value'), '#123456');
      await cancel();
      assert.equal(await run('window.canvasTheme.getSettings().selected'), 'system');
      assert.equal(await run('document.documentElement.dataset.theme'), 'dark');
      // A closed editor must not react to subsequent system appearance events.
      await setSystem('light');
      assert.equal(await run('document.getElementById("theme-canvas-hex").value'), '#123456');
      await open();
      assert.equal(await run('document.getElementById("theme-mode").value'), 'light');
      assert.equal(await run('document.getElementById("theme-canvas-hex").value'), '#f8f9fc');
      await cancel();
    }],
    ['closing a system preview removes its appearance listener on apply and cancel', async () => {
      for (const close of [apply, cancel]) {
        await setSystem('light');
        await run('window.canvasTheme.commit({ selected: "system", customThemes: [] })');
        await open(); await close();
        await waitFor(() => run('!document.getElementById("dialog").open'), 'editor closes');
        await setSystem('dark');
        assert.equal(await run('document.getElementById("theme-mode").value'), 'light', 'closed controls remain unchanged');
        await open(); await input('theme-canvas-hex', '#123456');
        await setSystem('light');
        assert.equal(await run('document.documentElement.style.getPropertyValue("--theme-canvas")'), '#123456', 'an old editor cannot overwrite a later custom preview');
        await cancel();
      }
    }]
  ];
  let failures = 0;
  for (const [name, test] of tests) {
    try { await test(); console.log('PASS: ' + name); }
    catch (error) { failures++; console.error('FAIL: ' + name); console.error(error); }
    finally { if (await run('document.getElementById("dialog").open')) await cancel(); }
  }
  win.destroy(); app.exit(failures ? 1 : 0);
}).catch(error => { console.error(error); app.exit(1); });
