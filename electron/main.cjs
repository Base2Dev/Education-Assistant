const { app, BrowserWindow, ipcMain, protocol, net, dialog, session, globalShortcut, Tray, Menu, nativeImage } = require('electron');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { createServer } = require('node:net');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createCapture } = require('./capture.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'scholo', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const root = path.resolve(__dirname, '..');
let backend, window, baseUrl;
let workspacePath = process.env.SCHOLO_DATA_DIR ? path.resolve(process.env.SCHOLO_DATA_DIR) : null;
let tray, capture, quitting = false, selectingWorkspace = false, shortcutRegistered = false;
const activationShortcut = 'CommandOrControl+Shift+Space';
const token = randomBytes(32).toString('hex');
const uuid = '[0-9a-f-]{36}';
const routes = [
  ['GET', /^\/health$/], ['GET', /^\/notes(?:\?[^#]*)?$/], ['POST', /^\/notes$/],
  ['GET', new RegExp(`^/notes/${uuid}$`)], ['PUT', new RegExp(`^/notes/${uuid}$`)],
  ['POST', /^\/timestamps$/], ['POST', new RegExp(`^/attachments/${uuid}/ocr$`)],
  ['GET', new RegExp(`^/ocr/${uuid}$`)], ['PUT', new RegExp(`^/ocr/${uuid}/correction$`)],
];
function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame ||
      !event.senderFrame.url.startsWith('scholo://app/')) throw new Error('Untrusted caller');
}
async function api(method, route, body) {
  const response = await fetch(baseUrl + route, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail || 'Request failed'));
  }
  return response.json();
}
async function freePort() {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
  });
}
async function launchBackend() {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const python = process.env.SCHOLO_PYTHON || path.join(root, '.venv', 'Scripts', 'python.exe');
  const dataDir = workspacePath || path.join(app.getPath('userData'), 'data');
  backend = spawn(python, ['-m', 'backend.run'], { cwd: root, windowsHide: true,
    env: { ...process.env, SCHOLO_PORT: String(port), SCHOLO_SESSION_TOKEN: token, SCHOLO_DATA_DIR: dataDir },
    stdio: ['ignore', 'ignore', 'pipe'] });
  let failure;
  backend.on('error', error => { failure = error.message; });
  backend.on('exit', code => { failure = `Backend exited (${code}).`; });
  backend.stderr.on('data', data => console.error(data.toString()));
  for (let count = 0; count < 80; count++) {
    if (failure) throw new Error(failure);
    try { await api('GET', '/health'); return; } catch { await new Promise(resolve => setTimeout(resolve, 150)); }
  }
  throw new Error('Backend did not start. Install requirements.txt into .venv first.');
}
async function upload(noteId, filename, bytes) {
  const data = new FormData();
  data.append('file', new Blob([Uint8Array.from(bytes)]), filename);
  const response = await fetch(`${baseUrl}/notes/${noteId}/attachments`, { method: 'POST', body: data,
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error((await response.json()).detail || 'Import failed');
  return response.json();
}
async function chooseWorkspace() {
  if (selectingWorkspace || capture?.isActive() && workspacePath) throw new Error('Finish the capture before changing folders.');
  selectingWorkspace = true;
  try {
    const selected = await dialog.showOpenDialog(window, { title: 'Choose your study workspace folder', properties: ['openDirectory', 'createDirectory'] });
    if (selected.canceled) return null;
    const chosen = path.resolve(selected.filePaths[0]);
    const previous = workspacePath;
    if (chosen === previous) return { path: chosen };
    if (backend && !backend.killed) {
      const owned = backend;
      await new Promise(resolve => { owned.once('exit', resolve); owned.kill(); setTimeout(resolve, 5000); });
    }
    workspacePath = chosen;
    try {
      await launchBackend();
      if (!process.env.SCHOLO_DATA_DIR) {
        const settings = path.join(app.getPath('userData'), 'workspace.json');
        await fs.mkdir(path.dirname(settings), { recursive: true });
        await fs.writeFile(settings + '.tmp', JSON.stringify({ path: chosen }));
        await fs.rename(settings + '.tmp', settings);
      }
    } catch (error) {
      workspacePath = previous;
      if (backend && !backend.killed) backend.kill();
      await launchBackend();
      throw error;
    }
    window?.webContents.send('scholo:workspace-changed');
    return { path: chosen };
  } finally { selectingWorkspace = false; }
}
app.whenReady().then(async () => {
  try {
    if (!workspacePath) {
      try { workspacePath = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'workspace.json'), 'utf8')).path; } catch {}
    }
    await launchBackend();
    const dist = path.join(root, 'dist');
    protocol.handle('scholo', async request => {
      const url = new URL(request.url);
      if (url.host !== 'app') return new Response('Not found', { status: 404 });
      const file = path.resolve(dist, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!file.startsWith(dist + path.sep)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(file).toString());
    });
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    ipcMain.handle('scholo:request', async (event, input) => {
      trusted(event);
      if (!input || typeof input.path !== 'string' || !routes.some(([method, pattern]) => method === input.method && pattern.test(input.path))) throw new Error('Unsupported operation');
      if (selectingWorkspace) throw new Error('Workspace is changing. Try again shortly.');
      if (input.method !== 'GET' && !workspacePath) throw new Error('Choose your study workspace folder before saving.');
      return api(input.method, input.path, input.body);
    });
    ipcMain.handle('scholo:import-image', async (event, input) => {
      trusted(event);
      if (!new RegExp(`^${uuid}$`).test(input.noteId) || typeof input.filename !== 'string' ||
          !Array.isArray(input.bytes) || input.bytes.length > 10 * 1024 * 1024) throw new Error('Invalid image import');
      return upload(input.noteId, input.filename, input.bytes);
    });
    ipcMain.handle('scholo:desktop-info', event => { trusted(event); return { workspace: workspacePath, shortcut: 'Ctrl+Shift+Space', shortcutRegistered, captureActive: capture?.isActive() || false }; });
    ipcMain.handle('scholo:choose-workspace', event => { trusted(event); return chooseWorkspace(); });
    ipcMain.handle('scholo:start-capture', event => { trusted(event); return capture.start(); });
    ipcMain.handle('scholo:export-note', async (event, noteId) => {
      trusted(event);
      if (!new RegExp(`^${uuid}$`).test(noteId)) throw new Error('Invalid note');
      const { canceled, filePath } = await dialog.showSaveDialog(window, { title: 'Export note and evidence', defaultPath: 'scholo-note.zip', filters: [{ name: 'ZIP archive', extensions: ['zip'] }] });
      if (canceled) return false;
      const response = await fetch(`${baseUrl}/notes/${noteId}/export`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Export failed');
      await fs.writeFile(filePath, Buffer.from(await response.arrayBuffer()));
      return true;
    });
    window = new BrowserWindow({ width: 1280, height: 860, minWidth: 900, minHeight: 650,
      title: 'Scholo', backgroundColor: '#f4f5ef',
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('scholo://app/')) event.preventDefault(); });
    await window.loadURL('scholo://app/index.html');
    capture = createCapture({ root, getWorkspace: () => workspacePath, chooseWorkspace,
      getPython: () => process.env.SCHOLO_PYTHON || path.join(root, '.venv', 'Scripts', 'python.exe'), api, upload,
      onSaved: note => { if (!window.isDestroyed()) window.webContents.send('scholo:capture-saved', note); },
      onError: error => dialog.showErrorBox('Capture unavailable', error.message) });
    tray = new Tray(nativeImage.createFromPath(path.join(root, 'dist', 'tray.png')));
    tray.setToolTip('Scholo - Ctrl+Shift+Space to capture');
    const show = () => { window.show(); if (window.isMinimized()) window.restore(); window.focus(); };
    tray.on('double-click', show);
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Scholo', click: show }, { label: 'Capture · Ctrl+Shift+Space', click: () => capture.start() },
      { type: 'separator' }, { label: 'Quit Scholo', click: () => app.quit() }]));
    window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
    shortcutRegistered = globalShortcut.register(activationShortcut, () => capture.start());
    if (!shortcutRegistered) console.error('Ctrl+Shift+Space is unavailable; use Capture in the app or tray.');
  } catch (error) {
    dialog.showErrorBox('Scholo could not start', error.message);
    app.quit();
  }
});
app.on('before-quit', () => { quitting = true; capture?.cancel(); globalShortcut.unregisterAll(); if (backend && !backend.killed) backend.kill(); tray?.destroy(); });
