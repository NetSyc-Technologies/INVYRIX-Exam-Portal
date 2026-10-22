import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadEnv } from 'vite';
const env = loadEnv('production', process.cwd(), '');
const url = new URL(env.INVYRIX_PORTAL_URL || 'https://invyrix.netsyc.com');
if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/') throw new Error('INVYRIX_PORTAL_URL must be a public HTTPS origin without credentials or a path.');
if (!env.VITE_FIREBASE_PROJECT_ID) throw new Error('Set VITE_FIREBASE_PROJECT_ID in .env.');
fs.writeFileSync('desktop/config.json', JSON.stringify({ portalUrl: url.origin, projectId: env.VITE_FIREBASE_PROJECT_ID }, null, 2));
fs.copyFileSync('logo.png', 'desktop/logo.png');
// Electron 45+ installs its binary through an explicit command, not postinstall.
if (!fs.existsSync('node_modules/electron/dist/electron.exe')) execFileSync(process.execPath, ['node_modules/electron/install.js'], { stdio: 'inherit' });
console.log('Desktop configuration and branding prepared.');
