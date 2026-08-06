import axios, { AxiosError } from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1',
  timeout: 90000,
  headers: {
    'Content-Type': 'application/json',
    'X-ImageShrink-Client': 'web',
  },
});

const TOKEN_KEY = 'imageshrink.token';
const REFRESH_KEY = 'imageshrink.refresh';

export const tokenStore = {
  get: (): string | null => {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  getRefresh: (): string | null => {
    try { return localStorage.getItem(REFRESH_KEY); } catch { return null; }
  },
  set: (token: string, refreshToken?: string): void => {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
    } catch {}
  },
  clear: (): void => {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_KEY);
    } catch {}
  },
};

export const SESSION_EXPIRED_EVENT = 'imageshrink:session-expired';

const CREDENTIAL_ROUTES = ['/auth/login', '/auth/signup', '/auth/refresh'];

api.interceptors.request.use(
  (config) => {
    const token = tokenStore.get();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

let refreshInFlight: Promise<string> | null = null;

function endSession(): void {
  tokenStore.clear();
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

async function refreshAccessToken(): Promise<string> {
  const refreshToken = tokenStore.getRefresh();
  if (!refreshToken) throw new Error('No refresh token');

  const { data } = await axios.post(
    `${api.defaults.baseURL}/auth/refresh`,
    { refreshToken },
    { headers: { 'Content-Type': 'application/json' }, timeout: 20000 }
  );

  const session = data?.data;
  if (!session?.token) throw new Error('Malformed refresh response');
  tokenStore.set(session.token, session.refreshToken);
  return session.token;
}

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetriableConfig | undefined;
    const url = config?.url ?? '';
    const isCredentialAttempt = CREDENTIAL_ROUTES.some((r) => url.includes(r));

    if (error.response?.status !== 401 || isCredentialAttempt || !config || config._retried) {
      if (error.response?.status === 401 && url.includes('/auth/refresh')) endSession();
      return Promise.reject(error);
    }

    if (!tokenStore.getRefresh()) {
      endSession();
      return Promise.reject(error);
    }

    try {
      refreshInFlight = refreshInFlight ?? refreshAccessToken().finally(() => {
        refreshInFlight = null;
      });
      const token = await refreshInFlight;

      config._retried = true;
      config.headers.Authorization = `Bearer ${token}`;
      return api.request(config);
    } catch {
      endSession();
      return Promise.reject(error);
    }
  }
);

export function apiErrorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (axios.isAxiosError(error)) {
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === 'string' && detail) return detail;
    if (Array.isArray(detail) && detail.length) {
      const msg = (detail[0] as { msg?: unknown })?.msg;
      if (typeof msg === 'string') return msg;
    }
    if (error.code === 'ECONNABORTED') return 'The server took too long to respond.';
    if (!error.response) return 'Could not reach the server. Is the backend running?';
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export default api;
