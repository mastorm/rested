import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { datetimeLocal } from '../src/lib/sessionForm';

const key = 'rested.preview.v1';

test('starts empty, earns playtime, switches exclusively, and pauses', async ({ page }) => {
  await page.goto('http://127.0.0.1:1420');
  await expect(page.getByRole('button', { name: /Start studying/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Start playing/ })).toBeDisabled();
  await page.getByRole('button', { name: /Start studying/ }).click();
  await expect(page.getByRole('button', { name: /Pause studying/ })).toBeVisible();
  await expect.poll(() => page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!).studyMs, key)).toBeGreaterThan(1000);
  const ledger = await page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!), key);
  expect(ledger.playMs).toBe(0);
  await page.getByRole('button', { name: /Start playing/ }).click();
  await expect(page.getByRole('button', { name: /Start studying/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Pause playing/ })).toBeVisible();
  await page.getByRole('button', { name: /Pause playing/ }).click();
  await expect(page.getByRole('button', { name: /Start playing/ })).toBeVisible();
});

test('reserve survives a reload and timers reopen paused', async ({ page }) => {
  await page.goto('http://127.0.0.1:1420');
  await page.getByRole('button', { name: /Start studying/ }).click();
  await expect.poll(() => page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!).studyMs, key)).toBeGreaterThan(500);
  await page.reload();
  await expect(page.getByRole('button', { name: /Start studying/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Start playing/ })).toBeEnabled();
  const saved = await page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!).studyMs, key);
  await page.waitForTimeout(500);
  expect(await page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!).studyMs, key)).toBe(saved);
});

test('a depleted reserve stops the timer, warns, and never goes negative', async ({ page }) => {
  await page.addInitScript(storageKey => {
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    localStorage.setItem(storageKey, JSON.stringify({ version: 1, studyMs: 500, playMs: 999, days: { [date]: { date, studyMs: 500, playMs: 999 } }, sessions: [], nextId: 1, notificationsEnabled: false }));
  }, key);
  await page.goto('http://127.0.0.1:1420');
  await page.getByRole('button', { name: /Start playing/ }).click();
  await expect(page.getByText(/Time for a study break/)).toBeVisible();
  await expect(page.getByTestId('reserve-clock')).toHaveText('00:00:00');
  await expect(page.getByRole('button', { name: /Start playing/ })).toBeDisabled();
  expect(await page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!).playMs, key)).toBe(1000);
});

test('keyboard shortcuts work and preferences restore focus', async ({ page }) => {
  await page.goto('http://127.0.0.1:1420');
  await expect(page.getByRole('button', { name: /Start studying/ })).toBeEnabled();
  await page.keyboard.press('s');
  await expect(page.getByRole('button', { name: /Pause studying/ })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: /Start studying/ })).toBeVisible();
  await page.getByRole('button', { name: 'Open preferences' }).click();
  await expect(page.getByRole('dialog', { name: 'Preferences' })).toBeVisible();
  await page.keyboard.press('s');
  await expect(page.getByRole('button', { name: /Start studying/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Open preferences' })).toBeFocused();
});

test('small screens do not overflow horizontally', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('http://127.0.0.1:1420');
  await expect(page.getByRole('button', { name: /Start studying/ })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.screenshot({ path: testInfo.outputPath('rested-mobile.png'), fullPage: true });
});

test('renders the unseeded first-run desktop interface without console errors', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:1420');
  await expect(page.getByRole('button', { name: /Start studying/ })).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: testInfo.outputPath('rested-desktop.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('damaged preview data is not reset or overwritten', async ({ page }) => {
  await page.addInitScript(storageKey => localStorage.setItem(storageKey, 'broken saved data'), key);
  await page.goto('http://127.0.0.1:1420');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: /Start studying/ })).toBeDisabled();
  expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), key)).toBe('broken saved data');
});

test('main interface and preferences pass automated accessibility checks', async ({ page }) => {
  await page.goto('http://127.0.0.1:1420');
  await expect(page.getByRole('button', { name: /Start studying/ })).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
  expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Open preferences' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
});

test('adds, edits, and deletes a manual session and persists the corrections', async ({ page }) => {
  await page.goto('http://127.0.0.1:1420');
  await page.getByRole('button', { name: 'Add session', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAccessibleName('Add session');
  await dialog.getByLabel('Start date and time').fill(datetimeLocal(Date.now() - 3_600_000));
  await dialog.getByLabel('Duration', { exact: true }).fill('00:30:00');
  await dialog.getByRole('button', { name: 'Add session', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId('reserve-clock')).toHaveText('01:00:00');
  await page.getByRole('button', { name: 'Edit session 1', exact: true }).click();
  await dialog.getByLabel('Duration', { exact: true }).fill('00:15:00');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId('reserve-clock')).toHaveText('00:30:00');
  await page.reload();
  await expect(page.getByTestId('reserve-clock')).toHaveText('00:30:00');
  await page.getByRole('button', { name: 'Delete session 1', exact: true }).click();
  await expect(dialog).toHaveAccessibleName('Delete session');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('reserve-clock')).toHaveText('00:30:00');
  await page.getByRole('button', { name: 'Delete session 1', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete session', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId('reserve-clock')).toHaveText('00:00:00');
  await expect(page.getByText('No sessions yet', { exact: true })).toBeVisible();
});

test('session forms prevent debt, suppress timer shortcuts, and restore focus', async ({ page }) => {
  await page.goto('http://127.0.0.1:1420');
  const trigger = page.getByRole('button', { name: 'Add session', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Activity', { exact: true }).selectOption('play');
  await expect(dialog.getByRole('button', { name: 'Add session', exact: true })).toBeDisabled();
  await expect(dialog.getByText(/more playtime recorded than earned/)).toBeVisible();
  await page.keyboard.press('s');
  await expect(page.getByRole('button', { name: /Start studying/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test('all saved sessions are reachable, including entries beyond the recent log', async ({ page }) => {
  await page.addInitScript(storageKey => {
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const sessions = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, mode: 'study', startedAt: now.getTime() - (i + 1) * 120_000, endedAt: now.getTime() - (i + 1) * 120_000 + 60_000, durationMs: 60_000 }));
    localStorage.setItem(storageKey, JSON.stringify({ version: 1, studyMs: 1_200_000, playMs: 0, days: { [date]: { date, studyMs: 1_200_000, playMs: 0 } }, sessions, nextId: 21, notificationsEnabled: false }));
  }, key);
  await page.goto('http://127.0.0.1:1420');
  await page.getByRole('button', { name: 'View all 20 sessions' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Edit session 1', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Older' }).click();
  await expect(dialog.getByRole('button', { name: 'Edit session 9', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Older' }).click();
  await dialog.getByRole('button', { name: 'Edit session 20', exact: true }).click();
  await expect(dialog).toHaveAccessibleName('Edit session');
  await dialog.getByLabel('Duration', { exact: true }).fill('00:02:00');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toHaveAccessibleName('Session log');
  await expect(page.getByTestId('reserve-clock')).toHaveText('00:42:00');
});

test('a running entry cannot be edited or deleted until it is paused', async ({ page }) => {
  await page.goto('http://127.0.0.1:1420');
  await page.getByRole('button', { name: /Start studying/ }).click();
  await expect(page.getByRole('button', { name: 'Edit session 1', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Delete session 1', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /View all 1 sessions/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Pause timer' }).click();
  await expect(dialog.getByRole('button', { name: 'Edit session 1', exact: true })).toBeEnabled();
});

test('session editor and history pass automated accessibility checks', async ({ page }, testInfo) => {
  await page.goto('http://127.0.0.1:1420');
  await page.getByRole('button', { name: 'Add session', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
  expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('session-editor.png') });
  await page.getByRole('dialog').getByRole('button', { name: 'Add session', exact: true }).click();
  await page.getByRole('button', { name: 'View all 1 sessions' }).click();
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Session log');
  expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
});

test('the titlebar requests native dragging but its preferences button does not', async ({ page }) => {
  await page.addInitScript(() => {
    const host = window as unknown as {
      isTauri: boolean;
      nativeCommands: string[];
      __TAURI_INTERNALS__: unknown;
      __TAURI_EVENT_PLUGIN_INTERNALS__: unknown;
    };
    host.isTauri = true;
    host.nativeCommands = [];
    host.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    host.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' } },
      transformCallback: () => 1,
      invoke: async (command: string) => {
        host.nativeCommands.push(command);
        if (command === 'get_state') return { revision: 0, mode: null, balanceMs: 0, today: { date: '2026-10-13', studyMs: 0, playMs: 0 }, studyMs: 0, playMs: 0, currentSessionMs: 0, activeSessionId: null, sessionCount: 0, sessions: [], week: [], notice: null, notificationsEnabled: true, storageError: null };
        return 1;
      },
    };
  });
  await page.goto('http://127.0.0.1:1420');
  await expect(page.getByRole('button', { name: /Start studying/ })).toBeEnabled();
  await page.locator('.titlebar-wordmark').click({ force: true });
  const dragCount = () => page.evaluate(() => (window as unknown as { nativeCommands: string[] }).nativeCommands.filter(command => command === 'plugin:window|start_dragging').length);
  await expect.poll(dragCount).toBe(1);
  await page.getByRole('button', { name: 'Open preferences' }).click();
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Preferences');
  expect(await dragCount()).toBe(1);
});
