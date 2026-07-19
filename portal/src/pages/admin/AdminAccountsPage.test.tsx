import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { AdminAccountsPage } from './AdminAccountsPage';

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, api: vi.fn() };
});

const apiMock = vi.mocked(api);
const accountId = '10000000-0000-4000-8000-000000000001';

describe('Admin Account Inspector Asset Packs', () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockResolvedValue({
      id: accountId,
      uid: 'OC-USER0001',
      email: 'caretaker@example.test',
      username: 'caretaker',
      friendCode: 'OC-FRIEND01',
      role: 'USER',
      accountStatus: 'ACTIVE',
      suspendedAt: null,
      createdAt: '2026-07-19T00:00:00.000Z',
      updatedAt: '2026-07-19T00:00:00.000Z',
      deviceSessions: [],
      networkCompanions: [],
      friends: [],
      blockedRelationships: { outgoing: [], incoming: [] },
      visitInvitations: { asVisitorOwner: [], asHost: [] },
      visitSessions: { asVisitorOwner: [], asHost: [] },
      notifications: { summary: { total: 0, unread: 0 }, recent: [] },
      auditRelatedEvents: [],
      assetPacks: {
        total: 72,
        truncated: true,
        items: [{
          id: '60000000-0000-4000-8000-000000000001',
          companionId: '20000000-0000-4000-8000-000000000001',
          manifestHash: 'safe-manifest-hash',
          schemaVersion: 2,
          status: 'active',
          totalFiles: 29,
          totalBytes: 4096,
          failureCode: null,
          createdAt: '2026-07-19T00:00:00.000Z',
          updatedAt: '2026-07-19T00:00:00.000Z',
          companion: {
            id: '20000000-0000-4000-8000-000000000001',
            name: 'Mochi',
            published: true,
          },
        }],
      },
      detailLimit: 50,
      _count: {},
    } as never);
  });

  it('renders bounded pack metadata, total count, and truncation disclosure', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/caretaker/accounts/${accountId}`]}>
          <Routes>
            <Route
              path="/caretaker/accounts/:id"
              element={<AdminAccountsPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Asset Packs' }))
      .toBeInTheDocument();
    expect(screen.getByText(/Showing 1 of 72 packs/)).toBeInTheDocument();
    expect(screen.getByText(/Only the latest 50 are shown/))
      .toBeInTheDocument();
    expect(screen.getByText('Mochi')).toBeInTheDocument();
    expect(screen.getByText(/Schema 2 · 29 files · 4,096 bytes/))
      .toBeInTheDocument();
  });
});
