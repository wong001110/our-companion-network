import { api } from './api';

describe('portal API client', () => {
  beforeEach(() => {
    document.cookie = 'oc_csrf=test-csrf; path=/';
    vi.restoreAllMocks();
  });

  it('sends credentials and the CSRF double-submit token on mutations', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { changed: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await api('/api/portal/profile', {
      method: 'PATCH',
      body: JSON.stringify({ displayName: 'June' }),
    });
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).get('x-csrf-token')).toBe('test-csrf');
  });

  it('keeps secure session credentials out of local and session storage', () => {
    expect(localStorage.getItem('oc_access')).toBeNull();
    expect(localStorage.getItem('oc_refresh')).toBeNull();
    expect(sessionStorage.getItem('oc_access')).toBeNull();
    expect(sessionStorage.getItem('oc_refresh')).toBeNull();
  });
});
