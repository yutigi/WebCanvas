const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
if (process.platform !== 'win32') throw new Error('Portable packaging currently targets Windows. Development also supports macOS/Linux.');
let binary;
try { binary = require('electron'); } catch { throw new Error('Run npm install before packaging.'); }
const output = path.join(root, 'release', `Web Canvas-win32-${process.arch}`);
if (fs.existsSync(output)) throw new Error(`Output already exists: ${output}. Rename it before rebuilding.`);
fs.cpSync(path.dirname(binary), output, { recursive: true });
fs.renameSync(path.join(output, 'electron.exe'), path.join(output, 'Web Canvas.exe'));
const app = path.join(output, 'resources', 'app');
fs.mkdirSync(app, { recursive: true });
for (const file of ['package.json', 'README.md', 'src', 'docs']) fs.cpSync(path.join(root, file), path.join(app, file), { recursive: true });
console.log(`Portable build: ${output}\\Web Canvas.exe\nUnsigned prototype; no installer or automatic updates.`);
