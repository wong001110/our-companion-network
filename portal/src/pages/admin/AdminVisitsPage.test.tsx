import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import {
  AdminVisitsPage,
  type AdminVisit,
  VISIT_DIAGNOSTIC_LABELS,
  visitDiagnostics,
  visitTimeline,
} from './AdminVisitsPage';

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, api: vi.fn() };
});

const apiMock = vi.mocked(api);
const old = '2026-07-19T02:00:00.000Z';
const session: AdminVisit = {
  id: '40000000-0000-4000-8000-000000000001',
  invitationId: '41000000-0000-4000-8000-000000000001',
  visitorOwnerUserId: '10000000-0000-4000-8000-000000000001',
  hostUserId: '10000000-0000-4000-8000-000000000002',
  networkCompanionId: '20000000-0000-4000-8000-000000000001',
  assetPackSnapshotId: '60000000-0000-4000-8000-000000000001',
  assetPackRefId: '60000000-0000-4000-8000-000000000001',
  state: 'ending',
  createdAt: old,
  updatedAt: old,
  invitationAcceptedAt: '2026-07-19T02:01:00.000Z',
  endingAt: '2026-07-19T02:10:00.000Z',
  diagnostics: [{
    code: 'STUCK_ENDING',
    label: 'Session stuck in ending',
    active: true,
  }],
  reconciliation: {
    eligible: true,
    code: 'STALE_LIVE_SESSION',
    staleAfterMinutes: 15,
    lastActivityAt: old,
  },
};

describe('Admin Visit Debugger', () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation((path) => Promise.resolve(
      path.endsWith('/reconcile')
        ? { ...session, state: 'ended', assetPackRefId: null }
        : session,
    ) as never);
  });

  it('exposes the complete named diagnostic set and Invitation accepted milestone', () => {
    expect(visitTimeline(session)).toContainEqual([
      'Invitation accepted',
      session.invitationAcceptedAt,
    ]);
    expect(visitDiagnostics(session).map((diagnostic) => diagnostic.label))
      .toEqual(VISIT_DIAGNOSTIC_LABELS.map(([, label]) => label));
    expect(visitDiagnostics(session).find(
      (diagnostic) => diagnostic.code === 'STUCK_ENDING',
    )?.active).toBe(true);
  });

  it('requires a reason and posts the safe reconciliation action', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/caretaker/visits/${session.id}`]}>
          <Routes>
            <Route path="/caretaker/visits/:id" element={<AdminVisitsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', {
      name: 'Trigger safe reconciliation',
    }));
    const dialog = screen.getByRole('dialog', {
      name: 'Trigger safe reconciliation?',
    });
    const confirm = within(dialog).getByRole('button', {
      name: 'Trigger safe reconciliation',
    });
    expect(confirm).toBeDisabled();

    await user.type(
      within(dialog).getByLabelText('Reason (required)'),
      'Session has exceeded the conservative stale window',
    );
    await waitFor(() => expect(within(dialog).getByRole('button', {
      name: 'Trigger safe reconciliation',
    })).toBeEnabled());
    await user.click(within(dialog).getByRole('button', {
      name: 'Trigger safe reconciliation',
    }));

    expect(apiMock).toHaveBeenCalledWith(
      `/api/admin/visit-sessions/${session.id}/reconcile`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          reason: 'Session has exceeded the conservative stale window',
        }),
      }),
    );
  });
});
