// Run with PLAYWRIGHT_MODULE pointing to a locally installed Playwright package.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('http://127.0.0.1:5173');
    await page.getByLabel('Development session token').fill(process.env.SCHOLO_SESSION_TOKEN);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByLabel('Note title').waitFor();
    const title = 'Binary search - browser verification ' + Date.now();
    await page.getByLabel('Note title').fill(title);
    await page.getByLabel('Course', { exact: true }).fill('Algorithms');
    await page.getByLabel('Topic', { exact: true }).fill('Search invariants');
    await page.getByLabel('Your notes', { exact: true }).fill('Each comparison halves the remaining search interval.');
    await page.getByLabel('Video title').fill('Binary search lecture');
    await page.getByLabel('Video URL').fill('https://www.youtube.com/watch?v=example');
    await page.getByLabel('Start time', { exact: true }).fill('01:23.250');
    await page.getByLabel('End time · optional').fill('02:10');
    await page.getByRole('button', { name: '+ Add video reference', exact: true }).click();
    await page.getByText('▶ 01:23.250 – 02:10', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    await page.getByText('Saved on this device.', { exact: true }).waitFor();
    await page.reload();
    await page.getByLabel('Development session token').fill(process.env.SCHOLO_SESSION_TOKEN);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByRole('button').filter({ hasText: title }).click();
    assert.equal(await page.getByLabel('Note title').inputValue(), title);
    assert.equal(await page.getByLabel('Your notes', { exact: true }).inputValue(), 'Each comparison halves the remaining search interval.');
    await page.getByText('▶ 01:23.250 – 02:10', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Style profiles', exact: false }).click();
    await page.getByText('This module is planned and has not been implemented yet.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Back to Notes', exact: true }).click();
    await fs.mkdir('artifacts', { recursive: true });
    await page.screenshot({ path: 'artifacts/notes-workspace.png', fullPage: true });
    assert.deepEqual(errors, [], 'Browser errors');
    console.log('PASS: UI → API → SQLite → reload; exact citation, module status, and no browser errors.');
  } catch (error) {
    await fs.mkdir('artifacts', { recursive: true });
    await page.screenshot({ path: 'artifacts/browser-failure.png', fullPage: true });
    console.error(await page.locator('label').allTextContents());
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
