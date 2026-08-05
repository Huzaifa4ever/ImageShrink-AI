

import { log } from '../logger';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter?: number
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isThrottled(): boolean {
    return this.status === 429;
  }

  get isAuthFailure(): boolean {
    return this.status === 401;
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 120_000;

function messageFrom(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && 'detail' in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === 'string' && detail) return detail;
    if (Array.isArray(detail) && detail.length) {
      const first = detail[0] as { msg?: unknown } | undefined;
      if (typeof first?.msg === 'string') return first.msg;
    }
  }
  return fallback;
}

export async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = (): void => controller.abort();
  signal?.addEventListener('abort', abortFromCaller);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-ImageShrink-Client': 'vscode',
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { detail: text.slice(0, 400) };
      }
    }

    if (!response.ok) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : undefined;
      throw new ApiError(
        messageFrom(parsed, `${response.status} ${response.statusText}`),
        response.status,
        Number.isFinite(retryAfter) ? retryAfter : undefined
      );
    }

    return parsed as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;

    if (error instanceof Error && error.name === 'AbortError') {
      if (signal?.aborted) throw new NetworkError('Cancelled.');
      throw new NetworkError(`The request took longer than ${Math.round(timeoutMs / 1000)}s.`);
    }

    log.error('request failed', error);
    throw new NetworkError(
      'Could not reach the ImageShrink server. Check that it is running and that ' +
        '"imageshrink.apiUrl" points at it.'
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}
