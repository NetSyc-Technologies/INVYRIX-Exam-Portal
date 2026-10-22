import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const node = process.execPath;
execFileSync(node, ['node_modules/typescript/bin/tsc'], { stdio: 'inherit' });
execFileSync(node, ['node_modules/vite/bin/vite.js', 'build'], { stdio: 'inherit' });
fs.mkdirSync('dist/downloads', { recursive: true });
const installer = 'release/INVYRIX-Setup-2.0.0.exe';
if (fs.existsSync(installer)) fs.copyFileSync(installer, 'dist/downloads/INVYRIX-Setup-2.0.0.exe');
else console.warn('Installer is not built yet. Run npm run desktop:build, then rebuild the website before publishing the download.');
