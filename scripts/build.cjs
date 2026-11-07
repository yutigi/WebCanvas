const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const metadata = require('../package.json');

async function build() {
  if (process.platform !== 'win32') throw new Error('Portable packaging currently targets Windows. Development also supports macOS/Linux.');
  let binary;
  try { binary = require('electron'); } catch { throw new Error('Run npm install before packaging.'); }
  const { rcedit } = await import('rcedit');
  const output = path.join(root, 'release', `Web Canvas-win32-${process.arch}`);
  if (fs.existsSync(output)) throw new Error(`Output already exists: ${output}. Rename it before rebuilding.`);
  fs.cpSync(path.dirname(binary), output, { recursive: true });
  fs.renameSync(path.join(output, 'electron.exe'), path.join(output, 'Web Canvas.exe'));
  await rcedit(path.join(output, 'Web Canvas.exe'), {
    icon: path.join(root, 'src/assets/logo.ico'),
    'file-version': metadata.version,
    'product-version': metadata.version,
    'version-string': {
      ProductName: 'Web Canvas',
      FileDescription: metadata.description,
      InternalName: 'Web Canvas',
      OriginalFilename: 'Web Canvas.exe',
      CompanyName: '',
      LegalCopyright: ''
    }
  });
  const app = path.join(output, 'resources', 'app');
  fs.mkdirSync(app, { recursive: true });
  for (const file of ['package.json', 'README.md', 'src', 'docs']) fs.cpSync(path.join(root, file), path.join(app, file), { recursive: true });
  console.log(`Portable build: ${output}\\Web Canvas.exe\nUnsigned prototype; no installer or automatic updates.`);
}

build().catch(error => { console.error(error.message); process.exitCode = 1; });
