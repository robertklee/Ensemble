import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { makeEvent, project } from '../../shared/events';
import { balances } from '../../shared/money';
import type { TripEvent, User } from '../../shared/types';
import { fixture } from '../fixtures';

const origin = 'http://127.0.0.1:8788';
test('Ensemble branding preserves existing trips and provides offline app icons', async ({
  page,
  context,
}, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Lisbon, with love', exact: true })).toBeVisible();
  await page.evaluate(
    async (workspace) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('ensemble', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('workspace');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('workspace', 'readwrite');
          tx.objectStore('workspace').put(workspace, 'local');
          tx.objectStore('workspace').put('local', 'current');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    {
      mode: 'local',
      user: { id: 'u0', username: 'alice', displayName: 'Alice', defaultCurrency: 'USD' },
      events: fixture(2).events,
      pending: [],
      friends: [],
      notices: [],
      lastSynced: null,
    },
  );
  await page.reload();
  await expect(page).toHaveTitle('Ensemble — trips, not tabs');
  await expect(page.locator('.brand')).toHaveText('ensemble.');
  await expect(page.locator('.brand img')).toHaveAttribute('src', '/ensemble-icon.svg');
  await page.getByRole('button', { name: 'Weekend Cabin', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Weekend Cabin', exact: true })).toBeVisible();
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/ensemble-icon.svg');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '/apple-touch-icon.png',
  );
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest.name).toBe('Ensemble');
  expect(manifest.short_name).toBe('Ensemble');
  expect(manifest.id).toBe('/');
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ src: '/icon-192.png', sizes: '192x192' }),
      expect.objectContaining({ src: '/icon-512.png', sizes: '512x512' }),
      expect.objectContaining({ src: '/maskable-icon-512.png', purpose: 'maskable' }),
    ]),
  );
  await page.screenshot({
    path: testInfo.outputPath('ensemble-desktop.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Your account' }).click();
  await expect(page.getByRole('dialog')).toContainText("You're trying Ensemble locally.");
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export full JSON backup' }).click();
  expect((await download).suggestedFilename()).toBe('ensemble-backup.json');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        }),
      );
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page).toHaveTitle('Ensemble — trips, not tabs');
  await expect(page.getByRole('button', { name: 'Weekend Cabin', exact: true })).toBeVisible();
  const sizes = await page.evaluate(async () =>
    Promise.all(
      ['/icon-192.png', '/icon-512.png', '/maskable-icon-512.png', '/apple-touch-icon.png'].map(
        async (src) => {
          const image = new Image();
          image.src = src;
          await image.decode();
          return [image.naturalWidth, image.naturalHeight];
        },
      ),
    ),
  );
  expect(sizes).toEqual([
    [192, 192],
    [512, 512],
    [512, 512],
    [180, 180],
  ]);
  await context.setOffline(false);
});

test('trip deletion requires confirmation, supports export and stays deleted offline', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Members' }).click();
  await page.getByRole('button', { name: 'Delete trip', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const confirm = dialog.getByRole('button', { name: 'Delete trip', exact: true });
  await expect(dialog.getByText(/still has outstanding balances/)).toBeVisible();
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Type the trip name to confirm').fill('Another trip');
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lisbon, with love', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete trip', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV before deleting' }).click();
  expect((await download).suggestedFilename()).toBe('Lisbon-with-love.csv');
  await page.getByLabel('Type the trip name to confirm').fill('Lisbon, with love');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        }),
      );
  });
  await context.setOffline(true);
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Your first adventure starts here' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lisbon, with love', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Your first adventure starts here' }),
  ).toBeVisible();
  await context.setOffline(false);
});
test('expense repayment hints show amounts and people on desktop and mobile', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const cabin = page.getByRole('button', { name: /Our little home in Alfama/ });
  const dinner = page.getByRole('button', { name: /Dinner by the waterfront/ });
  await expect(cabin.locator('.your-share.receivable small')).toHaveText('you lent');
  await expect(cabin.locator('.your-share .share-amount')).toHaveText('€315.00');
  await expect(dinner.locator('.your-share.payable small')).toHaveText('Sam lent you');
  await expect(dinner.locator('.your-share .share-amount')).toHaveText('€21.60');
  await expect(cabin.locator('.expense-description')).not.toContainText('you lent');
  await expect(
    page.getByText('Who owes what for each expense, before recorded payments.'),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('repayment-desktop.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(cabin.locator('.your-share.receivable')).toBeVisible();
  await expect(dinner.locator('.your-share.payable')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('repayment-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await cabin.click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByLabel('Show deleted').check();
  await expect(cabin).toBeVisible();
  await expect(cabin.locator('.your-share small')).toHaveText('deleted');
  await expect(cabin.locator('.your-share .share-amount')).toHaveText('—');
});

test('multiple lenders use a generic label above the amount in Your share', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add expense', exact: true }).first().click();
  await page.getByLabel('What was it for?').fill('Two lenders');
  await page.getByLabel('Amount', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'You', exact: true }).click();
  await page.getByRole('button', { name: 'Sam', exact: true }).click();
  await page.getByRole('button', { name: 'Jamie', exact: true }).click();
  await page.getByRole('textbox', { name: 'Sam paid', exact: true }).fill('6');
  await page.getByRole('textbox', { name: 'Jamie paid', exact: true }).fill('4');
  await page.getByRole('dialog').getByRole('button', { name: 'Add expense', exact: true }).click();
  const row = page.getByRole('button', { name: /Two lenders/ });
  await expect(row.locator('.your-share.payable small')).toHaveText('you borrowed');
  await expect(row.locator('.share-amount')).toHaveText('€2.50');
  await expect(row.locator('.your-share')).not.toContainText(/Sam|Jamie/);
});

async function createLocalTrip(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a trip', exact: true }).first().click();
  await page.getByLabel('Trip name').fill('Weekend Cabin');
  await page.getByRole('button', { name: 'Create trip', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Weekend Cabin' })).toBeVisible();
  await page.getByRole('button', { name: 'Invite a friend', exact: true }).first().click();
  await page.getByRole('textbox', { name: "Friend's name" }).fill('Bob');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
}
test('local trip, exact validation, expense edits, payments, export and persistence', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await createLocalTrip(page);
  await page.getByRole('button', { name: 'Add expense', exact: true }).first().click();
  await page.getByLabel('What was it for?').fill('Cabin rental');
  await page.getByLabel('Amount', { exact: true }).fill('100.01');
  await page.getByRole('button', { name: 'Exact amounts' }).click();
  await page.getByLabel('Alex exact amount').fill('50');
  await page.getByLabel('Bob exact amount').fill('50');
  await page.getByRole('dialog').getByRole('button', { name: 'Add expense', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('$0.01');
  await page.getByLabel('Bob exact amount').fill('50.01');
  await page.getByRole('dialog').getByRole('button', { name: 'Add expense', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Cabin rental/ })).toBeVisible();
  await page.reload();
  // Selected trip is UI state; persisted trips remain available from navigation.
  await page.getByRole('button', { name: 'Weekend Cabin', exact: true }).first().click();
  await page.getByRole('button', { name: /Cabin rental/ }).click();
  await page.getByLabel('Comment').fill('Booked for the whole weekend');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Booked for the whole weekend', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit expense', exact: true }).click();
  await page.getByLabel('What was it for?').fill('Lakeside cabin');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('tab', { name: 'Settle up' }).click();
  await expect(page.getByText('$50.01', { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: 'Mark paid' }).click();
  await page.getByLabel('This payment has already been made.').check();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Record payment', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Nothing left to settle' })).toBeVisible();
  await page.getByRole('tab', { name: 'Members' }).click();
  await page.getByRole('button', { name: 'Start settling up' }).click();
  await page.getByRole('button', { name: 'Close settled trip' }).click();
  await expect(
    page.getByRole('button', { name: 'Add expense', exact: true }).first(),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download CSV/ }).click();
  expect((await download).suggestedFilename()).toBe('Weekend-Cabin.csv');
  await page.getByRole('button', { name: 'Delete trip', exact: true }).click();
  await page.getByLabel('Type the trip name to confirm').fill('Weekend Cabin');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete trip', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Weekend Cabin', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('mobile layout fits the viewport and offline reload preserves edits', async ({
  page,
  context,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Lisbon, with love' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        }),
      );
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Lisbon, with love' })).toBeVisible();
  await page.getByRole('button', { name: 'Add expense', exact: true }).first().click();
  await page.getByLabel('What was it for?').fill('Offline pastries');
  await page.getByLabel('Amount', { exact: true }).fill('12.01');
  await page.getByRole('dialog').getByRole('button', { name: 'Add expense', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: /Offline pastries/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.setOffline(false);
});
test('desktop multi-payer shares, foreign currency and receipt upload', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Lisbon, with love' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Add expense', exact: true }).first().click();
  await page.getByLabel('What was it for?').fill('Shared excursion');
  await page.getByLabel('Amount', { exact: true }).fill('10');
  await page.getByRole('combobox', { name: 'Currency', exact: true }).selectOption('USD');
  await page.getByLabel(/Exchange rate/).fill('0.9');
  await page.getByRole('button', { name: 'Sam', exact: true }).click();
  await page.getByRole('textbox', { name: 'Alex paid', exact: true }).fill('7');
  await page.getByRole('textbox', { name: 'Sam paid', exact: true }).fill('3');
  await page.getByRole('button', { name: 'By shares', exact: true }).click();
  await page.getByLabel('Alex shares', { exact: true }).fill('2');
  await page.getByLabel('Taylor shares', { exact: true }).fill('0');
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 20;
    canvas.height = 20;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 20, 20);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type="file"]').setInputFiles({
    name: 'receipt.png',
    mimeType: 'image/png',
    buffer: Buffer.from(image, 'base64'),
  });
  await expect(page.getByRole('button', { name: 'Remove receipt 1' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Add expense', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: /Shared excursion/ }).click();
  await expect(page.getByRole('dialog').getByText(/€9.00 in trip currency/)).toBeVisible();
  await expect(page.getByRole('dialog').getByText('$5.00', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Receipt 1', exact: true })).toBeVisible();
});
test('offline cloud expenses and trip deletion synchronize after reconnecting', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Your account' }).click();
  await page.getByRole('button', { name: 'Sign in or create an account' }).click();
  await page.getByLabel('Your name').fill('Alex');
  await page.getByLabel('Username', { exact: true }).fill(`offline_${Date.now().toString(36)}`);
  await page.getByLabel('Password', { exact: true }).fill('a-correct-horse-battery-2026');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Create account', exact: true })
    .last()
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await createLocalTrip(page);
  await expect(page.getByRole('button', { name: 'All changes saved' })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Add expense', exact: true }).first().click();
  await page.getByLabel('What was it for?').fill('Offline dinner');
  await page.getByLabel('Amount', { exact: true }).fill('41.00');
  await page.getByRole('dialog').getByRole('button', { name: 'Add expense', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: /Offline dinner/ }).click();
  await page.getByRole('button', { name: 'Edit expense', exact: true }).click();
  await page.getByLabel('What was it for?').fill('Offline dinner, edited');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: 'All changes saved' })).toBeVisible();
  const response = await page.request.get('/api/bootstrap');
  const result = (await response.json()) as { events: TripEvent[] };
  expect(project(result.events).expenses[0].description).toBe('Offline dinner, edited');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        }),
      );
  });
  await page.getByRole('tab', { name: 'Members', exact: true }).click();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Delete trip', exact: true }).click();
  await page.getByLabel('Type the trip name to confirm').fill('Weekend Cabin');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete trip', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Weekend Cabin', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Your first adventure starts here' }),
  ).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: 'All changes saved' })).toBeVisible();
  const archived = (await (await page.request.get('/api/bootstrap')).json()) as {
    events: TripEvent[];
  };
  expect(project(archived.events).trip.deletedAt).toBeTruthy();
  expect(project(archived.events).expenses[0].description).toBe('Offline dinner, edited');
  await page.goto(`/?join=${'0'.repeat(64)}`);
  await page.getByRole('button', { name: 'Join the trip', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'This invite link is invalid or has expired.',
  );
  expect(errors).toEqual([]);
});
test('delete and restore are visible in history', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /One more round of pastries/ }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('button', { name: /One more round of pastries/ })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Activity' }).click();
  await page.getByRole('button', { name: 'View', exact: true }).first().click();
  await page.getByRole('button', { name: 'Restore expense' }).click();
  await page.getByRole('tab', { name: 'Expenses' }).click();
  await expect(page.getByRole('button', { name: /One more round of pastries/ })).toBeVisible();
});
test('two offline tabs preserve both concurrently saved expenses', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Lisbon, with love' })).toBeVisible();
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByRole('heading', { name: 'Lisbon, with love' })).toBeVisible();
  await context.setOffline(true);
  for (const [tab, description] of [
    [page, 'First tab expense'],
    [second, 'Second tab expense'],
  ] as const) {
    await tab.getByRole('button', { name: 'Add expense', exact: true }).first().click();
    await tab.getByLabel('What was it for?').fill(description);
    await tab.getByLabel('Amount', { exact: true }).fill('20');
  }
  await Promise.all(
    [page, second].map((tab) =>
      tab.getByRole('dialog').getByRole('button', { name: 'Add expense', exact: true }).click(),
    ),
  );
  await Promise.all([page, second].map((tab) => expect(tab.getByRole('dialog')).toHaveCount(0)));
  await page.reload();
  await expect(page.getByRole('button', { name: /First tab expense/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Second tab expense/ })).toBeVisible();
  await context.setOffline(false);
});
async function signup(request: APIRequestContext, username: string): Promise<User> {
  const response = await request.post('/api/auth/signup', {
    headers: { Origin: origin },
    data: {
      username,
      password: 'a-correct-horse-battery-2026',
      displayName: username,
      currency: 'USD',
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { user: User }).user;
}
test('Cloudflare accounts, privacy, friendship, invites, concurrent edits and trip deletion', async ({
  playwright,
  page,
  context,
}) => {
  const a = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  const b = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  const outsider = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  const prefix = `t${Date.now().toString(36)}`;
  try {
    const alice = await signup(a, `${prefix}_alice`);
    expect(
      (await a.storageState()).cookies.some((cookie) => cookie.name === 'ensemble_session'),
    ).toBe(true);
    const bob = await signup(b, `${prefix}_bob`);
    await signup(outsider, `${prefix}_outsider`);
    const tripId = crypto.randomUUID();
    const creation = makeEvent(tripId, alice.id, {
      kind: 'trip.create',
      trip: {
        id: tripId,
        name: 'Shared cabin',
        description: '',
        baseCurrency: 'USD',
        startDate: '',
        endDate: '',
        status: 'active',
        createdBy: alice.id,
        createdAt: new Date().toISOString(),
        members: [{ id: alice.id, name: alice.displayName, role: 'organizer', isGhost: false }],
      },
    });
    expect((await a.post('/api/events', { data: { event: creation } })).ok()).toBe(true);
    const outsideBootstrap = (await (await outsider.get('/api/bootstrap')).json()) as {
      events: TripEvent[];
    };
    expect(outsideBootstrap.events).toHaveLength(0);
    expect((await outsider.post(`/api/trips/${tripId}/invite`, { data: {} })).status()).toBe(404);
    expect((await a.post('/api/friends', { data: { username: bob.username } })).ok()).toBe(true);
    const bBootstrap = (await (await b.get('/api/bootstrap')).json()) as {
      friends: { id: string }[];
    };
    expect(
      (
        await b.patch(`/api/friends/${bBootstrap.friends[0].id}`, { data: { action: 'accept' } })
      ).ok(),
    ).toBe(true);
    const invite = (await (
      await a.post(`/api/trips/${tripId}/invite`, { data: { makeFriends: true } })
    ).json()) as { url: string };
    const join = await b.post('/api/join', {
      data: { token: new URL(invite.url).searchParams.get('join') },
    });
    expect(join.ok(), await join.text()).toBe(true);
    const expenseId = crypto.randomUUID();
    const added = makeEvent(tripId, alice.id, {
      kind: 'expense.add',
      expense: {
        id: expenseId,
        description: 'Cabin',
        category: 'lodging',
        amount: 10000,
        currency: 'USD',
        fxRate: '1',
        date: '2026-09-12',
        payers: [{ userId: alice.id, amountPaid: 10000 }],
        splitMethod: 'exact',
        splits: [
          { userId: alice.id, owedAmount: 5000, rawInput: 5000 },
          { userId: bob.id, owedAmount: 5000, rawInput: 5000 },
        ],
        notes: '',
        attachments: [],
        createdBy: alice.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    const saved = await a.post('/api/events', { data: { event: added } });
    expect(saved.ok(), await saved.text()).toBe(true);
    expect((await a.post('/api/events', { data: { event: added } })).ok()).toBe(true);
    const comment = makeEvent(tripId, alice.id, {
      kind: 'expense.comment',
      expenseId,
      text: 'An idempotent comment',
    });
    const repeated = await Promise.all([
      a.post('/api/events', { data: { event: comment } }),
      a.post('/api/events', { data: { event: comment } }),
    ]);
    for (const response of repeated) expect(response.ok(), await response.text()).toBe(true);
    const simultaneous = await Promise.all([
      a.post('/api/events', {
        data: {
          event: makeEvent(tripId, alice.id, {
            kind: 'expense.edit',
            expenseId,
            patch: { description: 'Lake cabin' },
          }),
        },
      }),
      b.post('/api/events', {
        data: {
          event: makeEvent(tripId, bob.id, {
            kind: 'expense.edit',
            expenseId,
            patch: { notes: 'Booked together' },
          }),
        },
      }),
    ]);
    for (const response of simultaneous) expect(response.ok(), await response.text()).toBe(true);
    const synced = (await (await b.get('/api/bootstrap')).json()) as { events: TripEvent[] };
    const state = project(synced.events);
    expect(state.expenses).toHaveLength(1);
    expect(state.expenses[0].description).toBe('Lake cabin');
    expect(state.expenses[0].notes).toBe('Booked together');
    expect(state.comments).toHaveLength(1);
    expect(balances(state).find((r) => r.userId === alice.id)?.net).toBe(5000);
    const invalid = makeEvent(tripId, bob.id, {
      kind: 'expense.edit',
      expenseId,
      patch: {
        ledger: {
          amount: 5000,
          currency: 'USD',
          fxRate: '1',
          payers: [{ userId: bob.id, amountPaid: 4000 }],
          splitMethod: 'exact',
          splits: [{ userId: bob.id, owedAmount: 5000 }],
        },
      },
    });
    expect((await b.post('/api/events', { data: { event: invalid } })).status()).toBe(400);
    expect(
      (
        await b.post('/api/events', {
          data: { event: makeEvent(tripId, bob.id, { kind: 'member.leave', userId: bob.id }) },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await a.post('/api/events', {
          headers: { Origin: 'https://other-site.example' },
          data: { event: added },
        })
      ).status(),
    ).toBe(403);
    const rejectedDeletion = await b.post('/api/events', {
      data: { event: makeEvent(tripId, bob.id, { kind: 'trip.delete' }) },
    });
    expect(rejectedDeletion.status()).toBe(400);
    expect((await rejectedDeletion.json()).error).toContain('Only the organizer');

    await page.goto('/');
    await page.getByRole('button', { name: 'Your account' }).click();
    await page.getByRole('button', { name: 'Sign in or create an account' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByLabel('Username', { exact: true }).fill(bob.username);
    await page.getByLabel('Password', { exact: true }).fill('a-correct-horse-battery-2026');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Sign in', exact: true })
      .last()
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Shared cabin', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Members', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Delete trip', exact: true })).toHaveCount(0);
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Add expense', exact: true }).first().click();
    await page.getByLabel('What was it for?').fill('Offline after trip deletion');
    await page.getByLabel('Amount', { exact: true }).fill('15');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Add expense', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const deletion = makeEvent(tripId, alice.id, { kind: 'trip.delete' });
    const deleted = await a.post('/api/events', { data: { event: deletion } });
    expect(deleted.ok(), await deleted.text()).toBe(true);
    expect((await a.post('/api/events', { data: { event: deletion } })).ok()).toBe(true);
    expect((await a.post(`/api/trips/${tripId}/invite`, { data: {} })).status()).toBe(410);
    expect(
      (
        await b.post('/api/join', { data: { token: new URL(invite.url).searchParams.get('join') } })
      ).status(),
    ).toBe(410);
    expect(
      (
        await outsider.post('/api/join', {
          data: { token: new URL(invite.url).searchParams.get('join') },
        })
      ).status(),
    ).toBe(410);
    expect(
      (
        await a.post('/api/events', {
          data: { event: makeEvent(tripId, alice.id, { kind: 'trip.status', status: 'active' }) },
        })
      ).status(),
    ).toBe(410);
    expect(
      (
        await b.post('/api/events', {
          data: {
            event: makeEvent(tripId, bob.id, {
              kind: 'expense.edit',
              expenseId,
              patch: { notes: 'Stale edit' },
            }),
          },
        })
      ).status(),
    ).toBe(410);
    for (const request of [a, b]) {
      const result = (await (await request.get('/api/bootstrap')).json()) as {
        events: TripEvent[];
      };
      const archived = project(result.events);
      expect(archived.trip.deletedAt).toBeTruthy();
      expect(archived.expenses).toHaveLength(1);
      expect(archived.events.filter((e) => e.kind === 'trip.delete')).toHaveLength(1);
      expect(balances(archived)).toEqual(balances(state));
    }
    await context.setOffline(false);
    await expect(page.getByRole('alert')).toContainText('This trip has been deleted');
    await expect(page.getByRole('button', { name: 'Shared cabin', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Review pending changes' }).click();
    await expect(page.getByRole('heading', { name: '1 pending changes' })).toBeVisible();
    const backupDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export full JSON backup' }).click();
    const backup = JSON.parse(await readFile((await (await backupDownload).path())!, 'utf8')) as {
      events: TripEvent[];
      pending: string[];
    };
    expect(backup.pending).toHaveLength(1);
    expect(backup.events.some((e) => e.kind === 'trip.delete')).toBe(true);
    expect(
      backup.events.some(
        (e) => e.kind === 'expense.add' && e.expense.description === 'Offline after trip deletion',
      ),
    ).toBe(true);
  } finally {
    await a.dispose();
    await b.dispose();
    await outsider.dispose();
  }
});
