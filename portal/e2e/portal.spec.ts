import { expect, type Page, test } from '@playwright/test';

const user = {
  id: '10000000-0000-4000-8000-000000000001',
  uid: 'OC-MOCHI001',
  email: 'mochi@example.test',
  username: 'MochiKeeper',
  friendCode: 'AB12CD34',
  role: 'USER',
  profile: { displayName: 'June', bio: 'Companion keeper', isPublic: false },
};

const ids = {
  account: '10000000-0000-4000-8000-000000000002',
  companion: '20000000-0000-4000-8000-000000000001',
  friend: '30000000-0000-4000-8000-000000000001',
  visit: '40000000-0000-4000-8000-000000000001',
  deviceOne: '50000000-0000-4000-8000-000000000001',
  deviceTwo: '50000000-0000-4000-8000-000000000002',
  pack: '60000000-0000-4000-8000-000000000001',
};

const now = '2026-07-19T03:00:00.000Z';

interface MockOptions {
  role?: 'USER' | 'SUPERADMIN';
  delayOncePath?: string;
  delayMs?: number;
  failCountByPath?: Record<string, number>;
  emptyPaths?: string[];
}

interface SeenRequest {
  path: string;
  method: string;
  body: unknown;
}

function envelope(items: unknown[], page = 1, totalPages = 1, limit = 20) {
  return {
    items,
    pagination: { page, limit, total: totalPages > 1 ? totalPages : items.length, totalPages },
  };
}

const companion = {
  id: ids.companion,
  name: 'Mochi',
  publicDescription: 'A curious local-first companion.',
  publicTags: ['local-first'],
  visibility: 'friends',
  published: true,
  isActive: true,
  activeAssetPackId: ids.pack,
  publishedAt: now,
  createdAt: now,
  updatedAt: now,
  activeAssetPack: {
    id: ids.pack,
    status: 'active',
    totalFiles: 15,
    totalBytes: 204800,
    failureCode: null,
  },
};

const assetPack = {
  id: ids.pack,
  companionId: ids.companion,
  manifestHash: 'a'.repeat(64),
  schemaVersion: 1,
  manifest: { schemaVersion: 1, animations: [] },
  status: 'active',
  objectPrefix: `companions/${ids.companion}/packs/${ids.pack}`,
  totalFiles: 1,
  totalBytes: 4096,
  failureCode: null,
  createdAt: now,
  updatedAt: now,
  completedAt: now,
  activatedAt: now,
  supersededAt: null,
  companion: { name: 'Mochi', owner: { id: user.id, uid: user.uid } },
  files: [{
    id: '61000000-0000-4000-8000-000000000001',
    relativePath: 'idle/front.png',
    objectKey: 'companions/mochi/idle/front.png',
    mimeType: 'image/png',
    sizeBytes: 4096,
    sha256: 'b'.repeat(64),
    category: 'animation',
    uploaded: true,
    verifiedAt: now,
    r2ObjectExists: true,
    r2Integrity: 'verified',
  }],
  _count: { visitInvitationRefs: 0, visitSessionRefs: 1 },
  storageInspection: {
    available: true,
    manifestMismatch: false,
    manifestObjectExists: true,
    missingObjects: [],
    orphanObjects: [],
    shaMismatches: [],
    metadataMismatches: [],
    fileInspectionTruncated: false,
  },
};

const friend = {
  id: ids.friend,
  uid: 'OC-FRIEND01',
  username: 'MiraKeeper',
  friendCode: 'MI34RA56',
  createdAt: now,
  profile: { displayName: 'Mira', avatarUrl: null },
  presence: { status: 'online', lastSeenAt: null },
  hasPublishedCompanion: true,
};

const visit = {
  id: ids.visit,
  invitationId: '41000000-0000-4000-8000-000000000001',
  visitorOwnerUserId: user.id,
  hostUserId: ids.account,
  networkCompanionId: ids.companion,
  assetPackSnapshotId: ids.pack,
  assetPackRefId: '62000000-0000-4000-8000-000000000001',
  companionName: 'Mochi',
  networkCompanion: { name: 'Mochi' },
  state: 'active',
  status: 'active',
  visitorOwnerReadyAt: now,
  hostReadyAt: now,
  visitorOwnerSeenAt: now,
  hostSeenAt: now,
  readyAt: now,
  startedAt: now,
  endingAt: null,
  endedAt: null,
  endReason: null,
  failureCode: null,
  createdAt: now,
  updatedAt: now,
};

const account = {
  id: ids.account,
  uid: 'OC-CARE001',
  email: 'mira@example.test',
  username: 'MiraKeeper',
  friendCode: 'MI34RA56',
  role: 'USER',
  accountStatus: 'ACTIVE',
  suspendedAt: null,
  createdAt: now,
  updatedAt: now,
  profile: { displayName: 'Mira' },
  presence: { status: 'online', lastSeenAt: now },
  deviceSessions: [{
    id: ids.deviceOne,
    deviceId: 'mira-mac',
    lastUsedAt: now,
    expiresAt: '2026-08-19T03:00:00.000Z',
    revokedAt: null,
  }],
  networkCompanions: [{ id: ids.companion, name: 'Mochi', published: true }],
  _count: { friends: 4, networkCompanions: 1, deviceSessions: 1 },
};

const systemHealth = {
  api: 'ok',
  database: 'ok',
  r2: { uploadsEnabled: true },
  websocket: { connectionCount: 12, reconnectCount: 2 },
  migrationVersion: '20260719020000_portal_browser_sessions',
  protocolVersion: '0.4',
  serverVersion: '0.4.0',
  compatibleClientVersion: '0.4.0',
};

async function mockPortal(page: Page, options: MockOptions = {}) {
  let signedIn = false;
  let delayed = false;
  const role = options.role ?? 'USER';
  const counts = new Map<string, number>();
  const requests: SeenRequest[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    let body: unknown;
    try {
      body = request.postDataJSON();
    } catch {
      body = request.postData();
    }
    requests.push({ path, method, body });

    const count = (counts.get(path) ?? 0) + 1;
    counts.set(path, count);
    if (options.delayOncePath === path && !delayed) {
      delayed = true;
      await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 500));
    }
    if (count <= (options.failCountByPath?.[path] ?? 0)) {
      return route.fulfill({
        status: 503,
        json: { error: { code: 'SERVICE_UNAVAILABLE', message: 'A deterministic test outage.' } },
      });
    }

    if (path === '/api/portal/auth/session') {
      if (!signedIn) return route.fulfill({ status: 401, json: { error: { message: 'Sign in' } } });
      return route.fulfill({ json: { data: { ...user, role } } });
    }
    if (path === '/api/portal/auth/login') {
      signedIn = true;
      return route.fulfill({ json: { data: { user: { ...user, role } } } });
    }
    if (path === '/api/portal/summary') {
      return route.fulfill({
        json: {
          data: {
            presence: { status: 'online', lastSeenAt: '2026-07-19T03:00:00Z' },
            friends: 4,
            pendingRequests: 1,
            publishedCompanion: {
              id: ids.companion,
              name: 'Mochi',
              published: true,
              activeAssetPack: { id: ids.pack, status: 'active' },
            },
            recentVisits: [],
            unreadNotifications: 2,
            activeDevices: 2,
          },
        },
      });
    }
    if (options.emptyPaths?.includes(path)) {
      return route.fulfill({ json: { data: envelope([], 1, 0, 12) } });
    }
    if (path === '/api/portal/companions') {
      return route.fulfill({ json: { data: envelope([companion], 1, 1, 12) } });
    }
    if (path === `/api/portal/companions/${ids.companion}/asset-packs`) {
      return route.fulfill({ json: { data: envelope([assetPack], 1, 1, 8) } });
    }
    if (path === '/api/portal/friends') {
      return route.fulfill({ json: { data: envelope([friend], 1, 1, 12) } });
    }
    if (path === '/api/portal/visits') {
      return route.fulfill({ json: { data: envelope([visit], 1, 1, 12) } });
    }
    if (path === `/api/portal/visits/${ids.visit}`) {
      return route.fulfill({ json: { data: visit } });
    }
    if (path === '/api/portal/devices') {
      const pageNumber = Number(url.searchParams.get('page') ?? '1');
      const device = {
        id: pageNumber === 1 ? ids.deviceOne : ids.deviceTwo,
        deviceId: pageNumber === 1 ? 'june-mac' : 'june-tablet',
        deviceName: pageNumber === 1 ? 'June’s Mac' : 'June’s Tablet',
        platform: pageNumber === 1 ? 'macOS' : 'iPadOS',
        lastUsedAt: now,
        expiresAt: '2026-08-19T03:00:00.000Z',
        createdAt: now,
        revokedAt: null,
        current: pageNumber === 1,
      };
      return route.fulfill({
        json: {
          data: {
            items: [device],
            pagination: { page: pageNumber, limit: 12, total: 2, totalPages: 2 },
          },
        },
      });
    }
    if (path === '/api/admin/overview') {
      return route.fulfill({
        json: {
          data: {
            totalAccounts: 24,
            newAccounts: { today: 2, sevenDays: 8 },
            presence: { online: 9, idle: 3 },
            publishedCompanions: 14,
            totalAssetPacks: 32,
            totalAssetFiles: 410,
            r2StoredBytes: 2048000,
            activeVisitSessions: 2,
            pendingInvitations: 3,
            failedAssetPacks: 1,
            stuckSessions: 0,
          },
        },
      });
    }
    if (path === '/api/admin/system-health') {
      return route.fulfill({ json: { data: systemHealth } });
    }
    if (path === '/api/admin/users') {
      return route.fulfill({ json: { data: envelope([account]) } });
    }
    if (path === `/api/admin/users/${ids.account}`) {
      return route.fulfill({ json: { data: account } });
    }
    if (path === '/api/admin/companions') {
      return route.fulfill({
        json: { data: envelope([{ ...companion, owner: account, activeAssetPack: assetPack }]) },
      });
    }
    if (path === `/api/admin/companions/${ids.companion}`) {
      return route.fulfill({
        json: { data: { ...companion, owner: account, activeAssetPack: assetPack } },
      });
    }
    if (path === '/api/admin/asset-packs') {
      return route.fulfill({ json: { data: envelope([assetPack]) } });
    }
    if (path === `/api/admin/asset-packs/${ids.pack}`) {
      return route.fulfill({ json: { data: assetPack } });
    }
    if (path === '/api/admin/visit-sessions') {
      return route.fulfill({ json: { data: envelope([visit]) } });
    }
    if (path === `/api/admin/visit-sessions/${ids.visit}`) {
      return route.fulfill({ json: { data: visit } });
    }
    if (path === '/api/admin/audit-logs') {
      return route.fulfill({
        json: {
          data: envelope([{
            id: '70000000-0000-4000-8000-000000000001',
            adminUserId: user.id,
            action: 'account_view',
            targetType: 'user',
            targetId: ids.account,
            reason: 'Portal acceptance verification',
            createdAt: now,
            adminUser: { uid: user.uid, username: user.username },
          }]),
        },
      });
    }
    if (method !== 'GET') {
      return route.fulfill({ json: { data: { ok: true } } });
    }
    return route.fulfill({
      json: {
        data: {
          items: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        },
      },
    });
  });
  return { requests, counts };
}

async function signIn(page: Page, options: MockOptions | 'USER' | 'SUPERADMIN' = {}) {
  const normalized = typeof options === 'string' ? { role: options } : options;
  const controller = await mockPortal(page, normalized);
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  return controller;
}

async function assertViewportSafe(page: Page) {
  await expect.poll(
    () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  const offscreenControls = await page
    .locator('a:visible, button:visible, input:visible, select:visible, textarea:visible, [tabindex="0"]:visible')
    .evaluateAll((elements) => elements.flatMap((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const intentionallyClosedSidebar = Boolean(element.closest('.sidebar:not(.sidebar--open)'));
      let ancestor = element.parentElement;
      let intentionallyScrollable = false;
      while (ancestor) {
        const ancestorStyle = getComputedStyle(ancestor);
        if (
          ['auto', 'scroll'].includes(ancestorStyle.overflowX)
          && ancestor.scrollWidth > ancestor.clientWidth
        ) {
          intentionallyScrollable = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (
        !intentionallyClosedSidebar
        &&
        !intentionallyScrollable
        &&
        style.position !== 'fixed'
        && rect.width > 0
        && (rect.left < -1 || rect.right > window.innerWidth + 1)
      ) {
        return [`${element.tagName.toLowerCase()} "${element.textContent?.trim().slice(0, 60) ?? ''}"`];
      }
      return [];
    }));
  expect(offscreenControls).toEqual([]);
}

test('user signs in and sees the social notebook home', async ({ page }, testInfo) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/my-network$/);
  await expect(page.getByRole('heading', { name: 'Welcome back, June.' })).toBeVisible();
  await expect(page.getByText('Companion passport')).toBeVisible();
  await expect(page.getByText('Caretaker Desk')).toHaveCount(0);
  await expect(page.locator('body')).toHaveCSS('overflow-x', 'visible');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (testInfo.project.name === 'desktop') {
    await page.screenshot({ path: 'qa/my-network-desktop.png', fullPage: true });
  }
});

test('Superadmin can switch to the themed Caretaker Desk', async ({ page }, testInfo) => {
  await signIn(page, 'SUPERADMIN');
  await expect(page).toHaveURL(/\/caretaker$/);
  await expect(page.getByRole('heading', { name: 'Good morning, Caretaker.' })).toBeVisible();
  await expect(page.getByText('Total accounts')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to My Network' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (testInfo.project.name === 'desktop') {
    await page.screenshot({ path: 'qa/caretaker-desk-desktop.png', fullPage: true });
  }
});

test('theme choice, keyboard focus, and mobile navigation remain usable', async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/my-network$/);
  const before = await page.locator('html').getAttribute('data-theme');
  if ((page.viewportSize()?.width ?? 1000) <= 820) {
    await page.getByRole('button', { name: /Use (dark|light) theme/ }).click();
  } else {
    await page.locator('.theme-button').click();
  }
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', before ?? '');
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement?.tagName);
  expect(focused).not.toBe('BODY');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('user routes remain complete, visible, and within every configured viewport', async ({ page }) => {
  await signIn(page);
  const routes = [
    ['/my-network/companion', 'My Companion'],
    ['/my-network/friends', 'Friends'],
    ['/my-network/visits', 'Visits'],
    [`/my-network/visits/${ids.visit}`, 'Visit details'],
    ['/my-network/security', 'Devices & Security'],
    ['/my-network/data', 'My Data'],
  ] as const;

  for (const [path, heading] of routes) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await assertViewportSafe(page);
  }
});

test('caretaker routes remain complete, visible, and within every configured viewport', async ({ page }) => {
  await signIn(page, 'SUPERADMIN');
  const routes = [
    ['/caretaker/accounts', 'Accounts'],
    [`/caretaker/accounts/${ids.account}`, 'MiraKeeper'],
    ['/caretaker/companions', 'Network Companions'],
    [`/caretaker/companions/${ids.companion}`, 'Mochi'],
    ['/caretaker/assets', 'Asset Storage'],
    [`/caretaker/assets/${ids.pack}`, 'Asset Pack details'],
    ['/caretaker/visits', 'Visit Debugger'],
    [`/caretaker/visits/${ids.visit}`, 'Session timeline'],
    ['/caretaker/realtime', 'Realtime Observatory'],
    ['/caretaker/audit', 'Admin Audit Log'],
    ['/caretaker/system', 'System Health'],
  ] as const;

  for (const [path, heading] of routes) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await assertViewportSafe(page);
  }
});

test('loading, empty, recoverable error, and pagination states stay usable', async ({ page }) => {
  const controller = await signIn(page, {
    delayOncePath: '/api/portal/companions',
    delayMs: 650,
    failCountByPath: { '/api/portal/friends': 3 },
    emptyPaths: ['/api/portal/visits'],
  });

  await page.goto('/my-network/companion');
  await expect(page.getByLabel('Loading')).toBeVisible();
  await expect(page.getByText('A curious local-first companion.')).toBeVisible();

  await page.goto('/my-network/visits');
  await expect(page.getByRole('heading', { name: 'No travel stories yet' })).toBeVisible();

  await page.goto('/my-network/friends');
  await expect(page.getByRole('alert').getByRole('heading', { name: 'We lost the thread' }))
    .toBeVisible({ timeout: 10_000 });
  expect(controller.counts.get('/api/portal/friends')).toBe(3);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('Mira', { exact: true })).toBeVisible();

  await page.goto('/my-network/security');
  await expect(page.getByRole('navigation', { name: 'Pagination' })).toContainText('Page 1 of 2');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('navigation', { name: 'Pagination' })).toContainText('Page 2 of 2');
  await expect.poll(() => controller.counts.get('/api/portal/devices')).toBe(2);
  await assertViewportSafe(page);
});

test('friend remove and block controls send the bounded intended requests', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One browser project is sufficient for mutation wiring.');
  const controller = await signIn(page);
  await page.goto('/my-network/friends');
  await expect(page.getByText('Mira', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Remove' }).click();
  await expect.poll(() => controller.requests.some(
    (request) => request.path === `/api/friends/${ids.friend}` && request.method === 'DELETE',
  )).toBe(true);

  await page.getByRole('button', { name: 'Block' }).click();
  await expect.poll(() => controller.requests.find(
    (request) => request.path === '/api/blocks' && request.method === 'POST',
  )?.body).toEqual({ userId: ids.friend });
});

test.describe('system display preferences', () => {
  test.use({ colorScheme: 'dark', reducedMotion: 'reduce' });

  test('dark mode, reduced motion, keyboard focus, and modal focus trap are honored', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await signIn(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);

    await page.goto('/my-network/data');
    const durations = await page.locator('.button').first().evaluate((element) => {
      const styles = getComputedStyle(element);
      return {
        animation: Number.parseFloat(styles.animationDuration),
        transition: Number.parseFloat(styles.transitionDuration),
      };
    });
    expect(durations.animation).toBeLessThanOrEqual(0.00001);
    expect(durations.transition).toBeLessThanOrEqual(0.00001);

    await page.locator('body').press('Tab');
    const focusStyle = await page.evaluate(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return null;
      const styles = getComputedStyle(active);
      return {
        tag: active.tagName,
        outlineStyle: styles.outlineStyle,
        outlineWidth: Number.parseFloat(styles.outlineWidth),
      };
    });
    expect(focusStyle?.tag).not.toBe('BODY');
    expect(focusStyle?.outlineStyle).not.toBe('none');
    expect(focusStyle?.outlineWidth).toBeGreaterThan(0);

    const deleteButton = page.getByRole('button', { name: 'Delete account' });
    await deleteButton.click();
    const dialog = page.getByRole('dialog', { name: 'Delete your Network Account?' });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close dialog' })).toBeFocused();

    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'Keep things as they are' })).toBeFocused();
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Close dialog' })).toBeFocused();
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(deleteButton).toBeFocused();
    await assertViewportSafe(page);
  });
});
