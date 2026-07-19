import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, jsonBody, type PortalUser } from '../../lib/api';

interface AuthContextValue {
  user: PortalUser | null;
  isLoading: boolean;
  login(email: string, password: string): Promise<PortalUser>;
  logout(): Promise<void>;
  refreshUser(): Promise<PortalUser | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<PortalUser | null>(null);
  const [isLoading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  const refreshUser = async () => {
    try {
      const session = await api<PortalUser>('/api/portal/auth/session');
      setUser(session);
      return session;
    } catch {
      setUser(null);
      return null;
    }
  };

  useEffect(() => {
    void refreshUser().finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    isLoading,
    async login(email, password) {
      const result = await api<{ user: PortalUser }>(
        '/api/portal/auth/login',
        { method: 'POST', ...jsonBody({ email, password }) },
      );
      const session = await refreshUser();
      if (!session) throw new Error('The session could not be started.');
      return result.user.role ? result.user : session;
    },
    async logout() {
      try {
        await api('/api/portal/auth/logout', { method: 'POST' });
      } finally {
        setUser(null);
        queryClient.clear();
      }
    },
    refreshUser,
  }), [isLoading, queryClient, user]);

  return <AuthContext.Provider value={{ ...value, isLoading }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
