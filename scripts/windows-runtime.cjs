const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const metadata = require('../package.json');
const root = path.resolve(__dirname, '..');
const executableName = `${metadata.productName}.exe`;
const icon = path.join(root, 'src/assets/logo.ico');

async function copyBrandedRuntime(electronBinary, output) {
  const { rcedit } = await import('rcedit');
  fs.cpSync(path.dirname(electronBinary), output, { recursive: true });
  const executable = path.join(output, executableName);
  fs.renameSync(path.join(output, 'electron.exe'), executable);
  const crashLibrary = path.join(output, 'electron_wer.dll');
  if (fs.existsSync(crashLibrary)) fs.renameSync(crashLibrary, path.join(output, `${metadata.productName}_wer.dll`));
  await rcedit(executable, {
    icon,
    'file-version': metadata.version,
    'product-version': metadata.version,
    'version-string': {
      ProductName: metadata.productName,
      FileDescription: metadata.productName,
      InternalName: metadata.productName,
      OriginalFilename: executableName,
      CompanyName: '',
      LegalCopyright: ''
    }
  });
  return executable;
}

async function developmentRuntime(electronBinary) {
  // Keep installed dependencies untouched. A new cache is used whenever the
  // runtime, branding code, icon, or app metadata changes.
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ electron: require('electron/package.json').version, arch: process.arch, name: metadata.productName, version: metadata.version }))
    .update(fs.readFileSync(icon))
    .update(fs.readFileSync(__filename))
    .digest('hex').slice(0, 16);
  const output = path.join(root, '.cache', 'runtime', fingerprint);
  const executable = path.join(output, executableName);
  const ready = path.join(output, '.ready');
  if (fs.existsSync(ready) && fs.existsSync(executable)) return executable;
  console.log(`Preparing ${metadata.productName} desktop runtime…`);
  await copyBrandedRuntime(electronBinary, output);
  fs.writeFileSync(ready, fingerprint);
  return executable;
}

module.exports = { copyBrandedRuntime, developmentRuntime };
