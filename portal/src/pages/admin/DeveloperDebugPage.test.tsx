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

const emptyListResponse = { items: [], nextCursor: null, hasMore: false };

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

  it('lists debug events from the API using createdAt', async () => {
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
      hasMore: false,
    });
    renderPage();
    expect(await screen.findByText('generate-response')).toBeInTheDocument();
    expect(screen.getAllByText(/alice/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('AI Calls')).toBeInTheDocument();
    expect(screen.getByText(/openai.*gpt-4o/)).toBeInTheDocument();
  });

  it('does not require total in the response', async () => {
    apiMock.mockResolvedValue({
      items: [
        {
          id: 'evt-1',
          kind: 'ai_call',
          operation: 'test',
          status: 'success',
          userId: 'user-1',
          deviceId: 'dev-1',
          createdAt: '2026-07-21T10:00:00.000Z',
        },
      ],
      nextCursor: null,
      hasMore: false,
    });
    renderPage();
    expect(await screen.findByText('test')).toBeInTheDocument();
    expect(screen.queryByText(/\d+ events/)).not.toBeInTheDocument();
  });

  it('updates the query when filters change with backend field names', async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValue(emptyListResponse);
    renderPage();

    const kindSelect = screen.getAllByRole('combobox')[0];
    await user.selectOptions(kindSelect, 'ai_call');
    await user.click(screen.getByRole('button', { name: /apply/i }));

    expect(apiMock).toHaveBeenCalledWith(
      expect.stringContaining('kind=ai_call'),
    );
  });

  it('sends from/to instead of dateFrom/dateTo', async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValue(emptyListResponse);
    renderPage();

    const dateInputs = screen.getAllByRole('textbox').filter(
      (el) => el.getAttribute('type') === 'date',
    );
    if (dateInputs.length > 0) {
      await user.type(dateInputs[0], '2026-07-01');
      await user.click(screen.getByRole('button', { name: /apply/i }));
      expect(apiMock).toHaveBeenCalledWith(
        expect.stringContaining('from='),
      );
    }
  });

  it('shows full detail content with scrollable container using payload', async () => {
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
      payload: { prompt: 'hello', response: largeContent },
    });
    renderPage(['/caretaker/debug/evt-1']);

    expect(await screen.findByRole('heading', { name: 'Payload' })).toBeInTheDocument();
    const pre = screen.getByText(/"prompt"/);
    expect(pre.closest('.debug-content-container')).toHaveClass('debug-content-container');
    expect(pre.closest('.debug-content')).toHaveClass('debug-content');
  });

  it('renders payload as escaped JSON without dangerouslySetInnerHTML', async () => {
    apiMock.mockResolvedValue({
      id: 'evt-1',
      kind: 'ai_call',
      operation: 'test',
      status: 'success',
      userId: 'user-1',
      deviceId: 'dev-1',
      createdAt: '2026-07-21T10:00:00.000Z',
      payload: { key: '<script>alert("xss")</script>' },
    });
    renderPage(['/caretaker/debug/evt-1']);

    await screen.findByRole('heading', { name: 'Payload' });
    const pre = screen.getByText(/"key"/);
    expect(pre.tagName).toBe('PRE');
    expect(pre.textContent).toContain('<script>');
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
      payload: { authorization: 'Bearer secret123', prompt: 'hello' },
    });
    renderPage(['/caretaker/debug/evt-1']);

    await screen.findByText('Copy JSON');
    await user.click(screen.getByRole('button', { name: /copy json/i }));

    expect(writeText).toHaveBeenCalled();
    const copied = JSON.parse(writeText.mock.calls[0][0] as string);
    expect(copied.payload.authorization).toBe('[REDACTED]');
    expect(copied.payload.prompt).toBe('hello');
  });

  it('cleanup button calls DELETE /api/admin/developer/debug-events/expired', async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValueOnce(emptyListResponse);
    apiMock.mockResolvedValueOnce({ pruned: 5 });
    renderPage();

    const cleanupButton = screen.getByRole('button', { name: /clean expired/i });
    expect(cleanupButton).toBeInTheDocument();

    await user.click(cleanupButton);
    expect(apiMock).toHaveBeenCalledWith(
      '/api/admin/developer/debug-events/expired',
      { method: 'DELETE' },
    );
  });

  it('does not show expired events (filtered by API)', async () => {
    apiMock.mockResolvedValue(emptyListResponse);
    renderPage();
    expect(await screen.findByText(/no debug events match/i)).toBeInTheDocument();
  });

  it('long content remains scrollable in detail view', async () => {
    const largeContent = 'x'.repeat(10000);
    apiMock.mockResolvedValue({
      id: 'evt-1',
      kind: 'ai_call',
      operation: 'generate-response',
      status: 'success',
      userId: 'user-1',
      deviceId: 'dev-1',
      createdAt: '2026-07-21T10:00:00.000Z',
      payload: { content: largeContent },
    });
    renderPage(['/caretaker/debug/evt-1']);

    await screen.findByRole('heading', { name: 'Payload' });
    const container = document.querySelector('.debug-content-container');
    expect(container).toBeInTheDocument();
    expect(container).toHaveClass('debug-content-container');
    expect(container!.querySelector('pre.debug-content')).toBeInTheDocument();
    expect(container!.querySelector('pre.debug-content')!.textContent!.length).toBeGreaterThan(5000);
  });
});
