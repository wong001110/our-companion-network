import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../lib/api';
import { DeveloperDebugPage } from './DeveloperDebugPage';

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, api: vi.fn() };
});

const apiMock = vi.mocked(api);

function renderPage(initialEntries = ['/caretaker/debug']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/caretaker/debug" element={<DeveloperDebugPage />} />
          <Route path="/caretaker/debug/:id" element={<DeveloperDebugPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DeveloperDebugPage', () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it('denies access for non-superadmin users via the AdminRoute guard', () => {
    apiMock.mockRejectedValue(new ApiError('Forbidden', 403, 'FORBIDDEN'));
    renderPage();
    expect(screen.getByRole('heading', { name: /debug events/i })).toBeInTheDocument();
  });

  it('lists debug events from the API', async () => {
    apiMock.mockResolvedValue({
      items: [
        {
          id: 'evt-1',
          kind: 'ai_call',
          operation: 'generate-response',
          status: 'success',
          userId: 'user-1',
          username: 'alice',
          deviceId: 'dev-1',
          provider: 'openai',
          model: 'gpt-4o',
          correlationId: 'corr-abc',
          cycleId: 'cycle-1',
          createdAt: '2026-07-21T10:00:00.000Z',
        },
      ],
      nextCursor: null,
      total: 1,
    });
    renderPage();
    expect(await screen.findByText('generate-response')).toBeInTheDocument();
    expect(screen.getAllByText(/alice/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('AI Calls')).toBeInTheDocument();
    expect(screen.getByText(/openai.*gpt-4o/)).toBeInTheDocument();
  });

  it('updates the query when filters change', async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
    renderPage();

    const kindSelect = screen.getAllByRole('combobox')[0];
    await user.selectOptions(kindSelect, 'ai_call');
    await user.click(screen.getByRole('button', { name: /apply/i }));

    expect(apiMock).toHaveBeenCalledWith(
      expect.stringContaining('kind=ai_call'),
    );
  });

  it('shows full detail content with scrollable container', async () => {
    const largeContent = 'x'.repeat(5000);
    apiMock.mockResolvedValue({
      id: 'evt-1',
      kind: 'ai_call',
      operation: 'generate-response',
      status: 'success',
      userId: 'user-1',
      username: 'alice',
      deviceId: 'dev-1',
      createdAt: '2026-07-21T10:00:00.000Z',
      request: { prompt: 'hello' },
      rawResponse: largeContent,
    });
    renderPage(['/caretaker/debug/evt-1']);

    expect(await screen.findByText('Request')).toBeInTheDocument();
    expect(screen.getByText('Raw response')).toBeInTheDocument();
    const pre = screen.getByText(largeContent);
    expect(pre.closest('.debug-content-container')).toHaveClass('debug-content-container');
    expect(pre.closest('.debug-content')).toHaveClass('debug-content');
  });

  it('groups related events by correlationId', async () => {
    apiMock.mockResolvedValue({
      id: 'evt-1',
      kind: 'ai_call',
      operation: 'generate-response',
      status: 'success',
      userId: 'user-1',
      deviceId: 'dev-1',
      correlationId: 'corr-abc',
      createdAt: '2026-07-21T10:00:00.000Z',
      relatedEvents: [
        {
          id: 'evt-1',
          kind: 'ai_call',
          operation: 'generate-response',
          status: 'success',
          userId: 'user-1',
          deviceId: 'dev-1',
          createdAt: '2026-07-21T10:00:00.000Z',
        },
        {
          id: 'evt-2',
          kind: 'research_search',
          operation: 'web-search',
          status: 'success',
          userId: 'user-1',
          deviceId: 'dev-1',
          createdAt: '2026-07-21T10:00:01.000Z',
        },
      ],
    });
    renderPage(['/caretaker/debug/evt-1']);

    expect(await screen.findByText('Related event timeline')).toBeInTheDocument();
    expect(screen.getAllByText('generate-response').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('web-search')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
  });

  it('copy and download use redacted payload', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    apiMock.mockResolvedValue({
      id: 'evt-1',
      kind: 'ai_call',
      operation: 'test',
      status: 'success',
      userId: 'user-1',
      deviceId: 'dev-1',
      createdAt: '2026-07-21T10:00:00.000Z',
      request: { authorization: 'Bearer secret123', prompt: 'hello' },
    });
    renderPage(['/caretaker/debug/evt-1']);

    await screen.findByText('Copy JSON');
    await user.click(screen.getByRole('button', { name: /copy json/i }));

    expect(writeText).toHaveBeenCalled();
    const copied = JSON.parse(writeText.mock.calls[0][0] as string);
    expect(copied.request.authorization).toBe('[REDACTED]');
    expect(copied.request.prompt).toBe('hello');
  });

  it('does not show expired events (filtered by API)', async () => {
    apiMock.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
    renderPage();
    expect(await screen.findByText(/no debug events match/i)).toBeInTheDocument();
  });
});
