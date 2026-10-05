const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const desktop = await _electron.launch({
    executablePath: require('electron'), args: ['.'], cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, SCHOLO_DATA_DIR: path.resolve('.test-data/desktop') }, timeout: 30000,
  });
  try {
    const page = await desktop.firstWindow();
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.hide()));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.getByLabel('Note title').waitFor();
    const title = 'Electron IPC verification ' + Date.now();
    await page.getByLabel('Note title').fill(title);
    await page.getByLabel('Your notes', { exact: true }).fill('Saved through the restricted preload API.');
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    await page.getByText('Saved on this device.', { exact: true }).waitFor();
    await page.reload();
    await page.getByRole('button').filter({ hasText: title }).click();
    assert.equal(await page.getByLabel('Your notes', { exact: true }).inputValue(), 'Saved through the restricted preload API.');
    const prefs = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
    assert.equal(prefs.nodeIntegration, false);
    assert.equal(prefs.contextIsolation, true);
    assert.equal(prefs.sandbox, true);
    assert.deepEqual(errors, []);
    console.log('PASS: Electron startup, preload IPC, owned backend, persistence, and renderer isolation.');
  } finally { await desktop.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
