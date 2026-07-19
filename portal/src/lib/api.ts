export type UserRole = 'USER' | 'SUPERADMIN';

export interface PortalUser {
  id: string;
  uid: string;
  email: string;
  username: string;
  friendCode: string;
  role: UserRole;
  createdAt?: string;
  profile?: {
    displayName?: string | null;
    bio?: string | null;
    avatarUrl?: string | null;
    isPublic?: boolean;
  } | null;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PageEnvelope<T> {
  items: T[];
  pagination: Pagination;
}

interface ApiEnvelope<T> {
  data: T;
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
  };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = 'REQUEST_FAILED',
    readonly requestId?: string,
  ) {
    super(message);
  }
}

const unsafeMethods = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
let refreshPromise: Promise<boolean> | null = null;

export async function api<T>(
  path: string,
  init: RequestInit = {},
  allowRefresh = true,
): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (unsafeMethods.has(method)) {
    const csrf = readCookie('oc_csrf');
    if (csrf) headers.set('x-csrf-token', csrf);
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (
    response.status === 401
    && allowRefresh
    && !path.startsWith('/api/portal/auth/')
    && await refreshSession()
  ) {
    return api<T>(path, init, false);
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as ApiErrorBody;
    throw new ApiError(
      body.error?.message ?? friendlyStatus(response.status),
      response.status,
      body.error?.code,
      body.error?.requestId,
    );
  }

  if (response.status === 204) return undefined as T;
  const body = await response.json() as ApiEnvelope<T>;
  return body.data;
}

export function jsonBody(value: unknown): Pick<RequestInit, 'body'> {
  return { body: JSON.stringify(value) };
}

export function queryString(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  const result = params.toString();
  return result ? `?${result}` : '';
}

export function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const raw = document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

async function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = api<{ refreshed: boolean }>(
      '/api/portal/auth/refresh',
      { method: 'POST' },
      false,
    ).then(() => true).catch(() => false).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

function friendlyStatus(status: number): string {
  if (status === 401) return 'Your session has ended. Please sign in again.';
  if (status === 403) return 'You do not have permission to do that.';
  if (status === 404) return 'That page could not be found.';
  if (status === 429) return 'Too many requests. Please pause and try again.';
  return 'Something went wrong. Please try again.';
}
