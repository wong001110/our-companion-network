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

async function mockPortal(page: Page, role: 'USER' | 'SUPERADMIN' = 'USER') {
  let signedIn = false;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
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
              id: '20000000-0000-4000-8000-000000000001',
              name: 'Mochi',
              published: true,
              activeAssetPack: { id: 'pack-1', status: 'active' },
            },
            recentVisits: [],
            unreadNotifications: 2,
            activeDevices: 2,
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
      return route.fulfill({
        json: {
          data: {
            api: 'ok',
            database: 'ok',
            r2: { uploadsEnabled: true },
            websocket: { connectionCount: 12, reconnectCount: 2 },
            migrationVersion: '20260719020000_portal_browser_sessions',
            protocolVersion: '0.4',
            serverVersion: '0.4.0',
            compatibleClientVersion: '0.4.0',
          },
        },
      });
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
}

async function signIn(page: Page, role: 'USER' | 'SUPERADMIN' = 'USER') {
  await mockPortal(page, role);
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in securely' }).click();
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
