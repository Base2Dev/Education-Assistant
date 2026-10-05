const { BrowserWindow, desktopCapturer, screen, ipcMain } = require('electron');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const run = promisify(execFile);

function cropRectangle(input, display, imageSize) {
  const ratioX = imageSize.width / display.width;
  const ratioY = imageSize.height / display.height;
  const x = Math.max(0, Math.min(imageSize.width - 1, Math.floor(input.x * ratioX)));
  const y = Math.max(0, Math.min(imageSize.height - 1, Math.floor(input.y * ratioY)));
  return { x, y, width: Math.min(imageSize.width - x, Math.max(1, Math.round(input.width * ratioX))),
    height: Math.min(imageSize.height - y, Math.max(1, Math.round(input.height * ratioY))) };
}

function createCapture({ root, getWorkspace, chooseWorkspace, getPython, api, upload, onSaved, onError }) {
  let overlay, popup, pending, capturing = false;
  const options = { preload: path.join(__dirname, 'capture-preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true };
  function restrict(win) {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
  }
  function trusted(event, owner) {
    if (!owner || owner.isDestroyed() || event.sender !== owner.webContents || event.senderFrame !== owner.webContents.mainFrame) throw new Error('Untrusted capture caller');
  }
  function cancel() {
    pending = null;
    if (overlay && !overlay.isDestroyed()) overlay.destroy();
    if (popup && !popup.isDestroyed()) popup.destroy();
    overlay = popup = null; capturing = false;
  }
  async function sourceContext(point) {
    try {
      const pixel = screen.dipToScreenPoint(point);
      const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
        path.join(__dirname, 'screen-context.ps1'), '-PointX', String(pixel.x), '-PointY', String(pixel.y)],
        { windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024 });
      return JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
    } catch { return {}; }
  }
  async function readText(image) {
    const directory = path.join(getWorkspace(), '.scholo', 'tmp');
    await fs.mkdir(directory, { recursive: true });
    const filename = path.join(directory, randomUUID() + '.png');
    try {
      await fs.writeFile(filename, image.toPNG());
      const result = await run(getPython(), ['-c', 'import sys,json; from pathlib import Path; from backend.ocr import recognize; text,provider=recognize(Path(sys.argv[1])); print(json.dumps({"text":text,"provider":provider}))', filename],
        { cwd: root, windowsHide: true, timeout: 65000, maxBuffer: 1024 * 1024 });
      return JSON.parse(result.stdout);
    } catch { return { text: '', ocr_error: 'Text extraction was unavailable. Keep the image, enter text, or retry with an OCR engine configured.' }; }
    finally { await fs.unlink(filename).catch(() => {}); }
  }
  async function start() {
    if (capturing) return;
    capturing = true;
    try {
      if (!getWorkspace() && !(await chooseWorkspace())) { capturing = false; return; }
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const displays = screen.getAllDisplays();
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: {
        width: Math.max(...displays.map(d => Math.ceil(d.size.width * d.scaleFactor))),
        height: Math.max(...displays.map(d => Math.ceil(d.size.height * d.scaleFactor))),
      } });
      const source = sources.find(s => s.display_id === String(display.id)) || (sources.length === 1 ? sources[0] : null);
      if (!source || source.thumbnail.isEmpty()) throw new Error('The selected display could not be captured.');
      pending = { screen: source.thumbnail, display, source_timestamp: new Date().toISOString(), workspace: getWorkspace() };
      overlay = new BrowserWindow({ ...display.bounds, frame: false, movable: false, resizable: false,
        skipTaskbar: true, alwaysOnTop: true, show: false, webPreferences: options });
      restrict(overlay);
      overlay.on('closed', () => { overlay = null; });
      await overlay.loadURL('scholo://app/capture-overlay.html');
      overlay.show(); overlay.focus();
    } catch (error) { console.error('Screen capture failed:', error); cancel(); onError(error); }
  }
  ipcMain.handle('capture:data', event => {
    if (overlay && event.sender === overlay.webContents) {
      trusted(event, overlay); return { image: pending.screen.toDataURL() };
    }
    trusted(event, popup);
    const { screen: ignored, display, image, ...data } = pending;
    return { ...data, image: image.toDataURL() };
  });
  ipcMain.handle('capture:cancel', event => {
    trusted(event, event.sender === overlay?.webContents ? overlay : popup);
    cancel();
  });
  ipcMain.handle('capture:select', async (event, input) => {
    trusted(event, overlay);
    if (!input || !['x', 'y', 'width', 'height', 'pointX', 'pointY'].every(key => Number.isFinite(input[key]))) throw new Error('Invalid selection');
    const state = pending;
    overlay.destroy(); overlay = null;
    const display = state.display;
    const metadata = await sourceContext({ x: display.bounds.x + input.pointX, y: display.bounds.y + input.pointY });
    if (pending !== state) return;
    let selection = input;
    if (input.width < 5 && input.height < 5) {
      if (metadata.bounds && metadata.bounds.width > 5 && metadata.bounds.height > 5) {
        const dip = screen.screenToDipRect(null, { x: Math.round(metadata.bounds.x), y: Math.round(metadata.bounds.y), width: Math.round(metadata.bounds.width), height: Math.round(metadata.bounds.height) });
        selection = { x: dip.x - display.bounds.x, y: dip.y - display.bounds.y, width: dip.width, height: dip.height };
      } else {
        selection = { x: Math.max(0, input.pointX - 250), y: Math.max(0, input.pointY - 125), width: 500, height: 250 };
      }
    }
    const image = state.screen.crop(cropRectangle(selection, display.size, state.screen.getSize()));
    // Release the full screen immediately; retain only the student's selected area.
    delete state.screen;
    Object.assign(state, metadata, { image });
    const ocr = await readText(image);
    if (pending !== state) return;
    Object.assign(state, ocr);
    popup = new BrowserWindow({ width: 520, height: 820, minWidth: 440, minHeight: 600,
      title: 'File your capture', alwaysOnTop: true, autoHideMenuBar: true, webPreferences: options });
    restrict(popup);
    popup.on('closed', () => { popup = null; pending = null; capturing = false; });
    await popup.loadURL('scholo://app/capture-comment.html');
  });
  ipcMain.handle('capture:save', async (event, input) => {
    trusted(event, popup);
    if (!pending || !['text', 'image', 'video'].includes(input?.action)) throw new Error('Invalid capture action');
    if (input.action === 'text' && !input.text?.trim()) throw new Error('Review or enter the text before saving.');
    const state = pending;
    const citations = [];
    if (input.action === 'video') {
      const start = await api('POST', '/timestamps', { value: input.start });
      const end = input.end ? await api('POST', '/timestamps', { value: input.end }) : null;
      citations.push({ title: input.title, url: input.url, start_ms: start.milliseconds, end_ms: end?.milliseconds ?? null, comment: input.comment });
    }
    // Reuse a saved draft on retry, so an image-import failure cannot duplicate a note.
    const payload = { title: input.title, body: input.action === 'text' ? input.text : '', course: input.course,
      topic: input.topic, comment: input.comment, source_app: state.source_app || '',
      source_reference: input.action === 'video' ? input.url : '', source_timestamp: state.source_timestamp, citations };
    const note = await api(state.noteId ? 'PUT' : 'POST', state.noteId ? `/notes/${state.noteId}` : '/notes', payload);
    state.noteId = note.id;
    // Video keeps the confirmed citation only. Text/image retain the selected evidence.
    if (input.action !== 'video' && !state.attachmentSaved) {
      await upload(note.id, 'capture.png', state.image.toPNG());
      state.attachmentSaved = true;
    }
    onSaved(note);
    cancel();
    return { id: note.id };
  });
  return { start, cancel, isActive: () => capturing };
}
module.exports = { createCapture, cropRectangle };
