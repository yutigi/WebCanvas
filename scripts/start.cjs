const { spawn } = require('node:child_process');
const path = require('node:path');
let electron;
try { electron = require('electron'); } catch {
  console.error('Electron is not installed. Run npm install, then npm start. Canvas-only preview: npm run dev.');
  process.exit(1);
}
async function start() {
  if (process.platform === 'win32') electron = await require('./windows-runtime.cjs').developmentRuntime(electron);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (process.argv.includes('--smoke-test')) env.WEBCANVAS_SMOKE = '1';
  const child = spawn(electron, [path.resolve(__dirname, '..')], { stdio: 'inherit', env });
  child.on('error', e => { console.error(e.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}
start().catch(error => { console.error(error.message); process.exitCode = 1; });
