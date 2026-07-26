import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PropsWithChildren } from 'react';
import { vi } from 'vitest';
import { api } from '../../lib/api';
import { AuthProvider, useAuth } from './AuthProvider';

vi.mock('../../lib/api', () => ({
  api: vi.fn(),
  jsonBody: (value: unknown) => ({ body: JSON.stringify(value) }),
}));

const mockedApi = vi.mocked(api);

function Providers({ children }: PropsWithChildren) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

function AuthProbe() {
  const { user, isLoading, login } = useAuth();
  if (isLoading) return <span>Loading</span>;
  return (
    <button type="button" onClick={() => void login('admin@example.test', 'valid-password-123')}>
      {user?.email ?? 'Sign in'}
    </button>
  );
}

describe('AuthProvider login handshake', () => {
  beforeEach(() => {
    mockedApi.mockReset();
    mockedApi.mockImplementation(async (path) => {
      if (path === '/api/portal/auth/session') {
        throw new Error('No existing browser session');
      }
      if (path === '/api/portal/auth/login') {
        return {
          user: {
            id: 'admin-1',
            uid: 'OC-ADMIN01',
            email: 'admin@example.test',
            username: 'admin',
            friendCode: 'A1B2C3D4',
            role: 'SUPERADMIN',
          },
        } as never;
      }
      throw new Error(`Unexpected API path: ${path}`);
    });
  });

  it('accepts the authenticated login response without a redundant session request', async () => {
    const user = userEvent.setup();
    render(<AuthProbe />, { wrapper: Providers });

    const button = await screen.findByRole('button', { name: 'Sign in' });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'admin@example.test' })).toBeInTheDocument();
    });

    const sessionRequests = mockedApi.mock.calls.filter(
      ([path]) => path === '/api/portal/auth/session',
    );
    expect(sessionRequests).toHaveLength(1);
    expect(mockedApi).toHaveBeenCalledWith(
      '/api/portal/auth/login',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
