const { app, BrowserWindow, ipcMain, dialog, Menu, shell, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const config = require('./config.json');
const ORIGIN = new URL(config.portalUrl).origin;
if (!ORIGIN.startsWith('https://') && app.isPackaged) throw new Error('The production portal must use HTTPS.');
let window;
let link = null;
const settingsPath = () => path.join(app.getPath('userData'), 'institute.json');
const validLink = value => value && /^INV-[A-F0-9]{12}$/.test(value.id) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug) && value.slug.length >= 3 && value.slug.length <= 64;
function trusted(url) { try { return new URL(url).origin === ORIGIN; } catch { return false; } }
function allowed(url) {
  if (!trusted(url)) return false;
  const pathname = new URL(url).pathname;
  return !link || pathname === `/${link.slug}` || pathname.startsWith(`/${link.slug}/`) || ['/terms', '/download', '/desktop'].includes(pathname);
}
async function loadPortal() {
  try { await window.loadURL(`${ORIGIN}/${link ? link.slug : 'desktop'}`); }
  catch { await window.loadFile(path.join(__dirname, 'offline.html')); }
}
async function createWindow() {
  try { const saved = JSON.parse(await fs.readFile(settingsPath(), 'utf8')); if (validLink(saved)) link = saved; } catch { /* first run or invalid settings */ }
  window = new BrowserWindow({ width: 1320, height: 900, minWidth: 720, minHeight: 600, title: 'INVYRIX by NetSyc Technologies', icon: path.join(__dirname, 'logo.png'), backgroundColor: '#f6f9fa', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, partition: 'persist:invyrix' } });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('mailto:')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url === 'invyrix://retry') { event.preventDefault(); void loadPortal(); return; }
    if (!allowed(url)) { event.preventDefault(); if (url.startsWith('https://')) void shell.openExternal(url); }
  });
  window.webContents.on('will-redirect', (event, url) => { if (!allowed(url)) event.preventDefault(); });
  window.webContents.on('page-title-updated', (event, title) => { event.preventDefault(); window.setTitle(title.includes('INVYRIX') ? title : 'INVYRIX by NetSyc Technologies'); });
  window.webContents.on('did-navigate-in-page', (_event, url) => {
    if (trusted(url) && /\/(admin|register|superadmin)(\/|$)/.test(new URL(url).pathname)) {
      void shell.openExternal(url);
      void loadPortal();
    }
  });
  window.webContents.on('did-finish-load', () => {
    const title = window.webContents.getTitle();
    window.setTitle(title.includes('INVYRIX') ? title : 'INVYRIX by NetSyc Technologies');
  });
  const browserSession = session.fromPartition('persist:invyrix');
  browserSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(trusted(contents.getURL()) && ['media', 'geolocation', 'fullscreen'].includes(permission));
  });
  browserSession.setPermissionCheckHandler((_contents, permission, origin) => trusted(origin) && ['media', 'geolocation', 'fullscreen'].includes(permission));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'INVYRIX', submenu: [
      { label: 'Open institute portal', click: () => loadPortal() },
      { label: 'Administrator dashboard (browser)', click: () => shell.openExternal(`${ORIGIN}/${link ? `${link.slug}/admin` : 'admin'}`) },
      { label: 'Change institute…', click: async () => {
        const result = await dialog.showMessageBox(window, { type: 'question', buttons: ['Cancel', 'Change institute'], defaultId: 0, cancelId: 0, message: 'Disconnect this app from the current institute?', detail: 'Do not change institutes during an exam. This clears the app’s sign-in and local connection.' });
        if (result.response !== 1) return;
        link = null;
        await fs.rm(settingsPath(), { force: true });
        await browserSession.clearStorageData();
        await loadPortal();
      } },
      { type: 'separator' }, { role: 'quit' }
    ] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
    { label: 'Help', submenu: [{ label: 'Contact NetSyc', click: () => shell.openExternal('mailto:admin@netsyc.com') }] }
  ]));
  await loadPortal();
}
ipcMain.handle('link-institute', async (event, value) => {
  if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !trusted(event.senderFrame.url) || new URL(event.senderFrame.url).pathname !== '/desktop' || !validLink(value)) throw new Error('Invalid institute connection request.');
  // Recheck the ID-to-slug mapping in the main process before persisting it.
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents/invyrix_ids/${value.id}`);
  if (!response.ok) throw new Error('Unable to verify this INVYRIX ID. Check your connection.');
  const record = await response.json();
  if (record.fields?.tenantId?.stringValue !== value.slug) throw new Error('The institute ID does not match this portal.');
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  const temporary = settingsPath() + '.tmp';
  await fs.writeFile(temporary, JSON.stringify(value), 'utf8');
  await fs.rename(temporary, settingsPath());
  link = value;
});
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
