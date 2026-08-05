

import { config } from '../config';
import { log } from '../logger';
import type { SessionStore } from '../auth/session';
import { ApiError, request } from './http';
import type {
  AnalysisResult,
  ApiEnvelope,
  ExtensionAnalyzeRequest,
  HistoryPage,
  Stats,
} from './types';

export class NotSignedIn extends Error {
  constructor() {
    super('Sign in to ImageShrink to use AI analysis and sync your history.');
    this.name = 'NotSignedIn';
  }
}

export class NetworkDisabled extends Error {
  constructor() {
    super(
      'ImageShrink is set to use local rules only. Turn off "imageshrink.useLocalRulesOnly" to use AI analysis.'
    );
    this.name = 'NetworkDisabled';
  }
}

export class ApiClient {
  constructor(private readonly session: SessionStore) {}

  private get base(): string {
    return config.apiUrl();
  }

  private async authorized<T>(
    path: string,
    options: { method?: string; body?: unknown; timeoutMs?: number; signal?: AbortSignal } = {}
  ): Promise<T> {
    if (!config.networkAllowed()) throw new NetworkDisabled();

    let token = await this.session.accessToken();
    if (!token) throw new NotSignedIn();

    const send = (bearer: string): Promise<T> =>
      request<T>(`${this.base}${path}`, {
        ...options,
        headers: { Authorization: `Bearer ${bearer}` },
      });

    try {
      return await send(token);
    } catch (error) {
      if (!(error instanceof ApiError) || !error.isAuthFailure) throw error;

      log.debug(`401 on ${path}, refreshing`);
      token = await this.session.refresh();
      return send(token);
    }
  }

  async analyze(
    body: ExtensionAnalyzeRequest,
    signal?: AbortSignal
  ): Promise<AnalysisResult> {
    const response = await this.authorized<ApiEnvelope<AnalysisResult>>('/analyze/extension', {
      method: 'POST',
      body,
      timeoutMs: 180_000,
      signal,
    });
    return response.data;
  }

  async history(params: { page?: number; pageSize?: number; q?: string } = {}): Promise<HistoryPage> {
    const query = new URLSearchParams();
    query.set('page', String(params.page ?? 1));
    query.set('pageSize', String(params.pageSize ?? 12));
    if (params.q) query.set('q', params.q);

    const response = await this.authorized<ApiEnvelope<HistoryPage>>(
      `/analyze/history?${query.toString()}`,
      { timeoutMs: 20_000 }
    );
    return response.data;
  }

  async analysis(id: string): Promise<AnalysisResult> {
    const response = await this.authorized<ApiEnvelope<AnalysisResult>>(`/analyze/${id}`, {
      timeoutMs: 20_000,
    });
    return response.data;
  }

  async stats(): Promise<Stats> {
    const response = await this.authorized<ApiEnvelope<Stats>>('/analyze/stats', {
      timeoutMs: 20_000,
    });
    return response.data;
  }

  async setFavorite(id: string, favorite: boolean): Promise<void> {
    await this.authorized(`/analyze/${id}/favorite`, {
      method: 'PATCH',
      body: { favorite },
      timeoutMs: 20_000,
    });
  }
}
