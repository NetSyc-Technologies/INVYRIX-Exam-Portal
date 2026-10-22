import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createPackage } from '@electron/asar';
import './prepare-desktop.mjs';

// Explicit staging keeps the cloud app's dependencies and .env out of the desktop package.
const root = process.cwd();
const stage = path.resolve(root, 'release/windows');
if (!stage.startsWith(root + path.sep)) throw new Error('Invalid desktop output directory.');
await fs.mkdir(stage, { recursive: true });
await fs.cp(path.resolve('node_modules/electron/dist'), stage, { recursive: true });
await fs.rename(path.join(stage, 'electron.exe'), path.join(stage, 'INVYRIX.exe'));
await createPackage(path.resolve('desktop'), path.join(stage, 'resources/app.asar'));
// Keep the event loop running so asar's file streams close before Windows archives them.
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['node_modules/electron-builder/cli.js', '--prepackaged', stage, '--win', 'nsis', '--x64', '--publish', 'never'], { stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Windows packaging failed (${code}).`)));
});
const installer = path.resolve('release/INVYRIX-Setup-2.0.0.exe');
await fs.access(installer);
await fs.mkdir('dist/downloads', { recursive: true });
await fs.copyFile(installer, 'dist/downloads/INVYRIX-Setup-2.0.0.exe');
console.log(`Installer ready: ${installer}`);
