import api from './api';
import type {
  AnalysisResult, ApiResponse, HistoryPage, HistoryQuery, ModelCatalog,
} from '../types';

export const dockerService = {
  getModels: async (probe = false): Promise<ApiResponse<ModelCatalog>> => {
    const { data } = await api.get<ApiResponse<ModelCatalog>>('/models', { params: { probe } });
    return data;
  },

  analyzeDockerfile: async (file: File, model: string): Promise<ApiResponse<AnalysisResult>> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('model', model);
    const { data } = await api.post<ApiResponse<AnalysisResult>>(
      '/analyze',
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    return data;
  },

  getAnalysis: async (id: string): Promise<ApiResponse<AnalysisResult>> => {
    const { data } = await api.get<ApiResponse<AnalysisResult>>(`/analyze/${id}`);
    return data;
  },

  getHistory: async (query: HistoryQuery = {}): Promise<ApiResponse<HistoryPage>> => {
    const { data } = await api.get<ApiResponse<HistoryPage>>('/analyze/history', {
      params: {
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 12,
        sort: query.sort ?? 'newest',
        source: query.source ?? 'all',
        ...(query.q ? { q: query.q } : {}),
        ...(query.favorite !== undefined ? { favorite: query.favorite } : {}),
      },
    });
    return data;
  },

  setFavorite: async (id: string, favorite: boolean): Promise<ApiResponse<{ favorite: boolean }>> => {
    const { data } = await api.patch<ApiResponse<{ favorite: boolean }>>(
      `/analyze/${id}/favorite`,
      { favorite }
    );
    return data;
  },

  deleteAnalysis: async (id: string): Promise<ApiResponse<null>> => {
    const { data } = await api.delete<ApiResponse<null>>(`/analyze/${id}`);
    return data;
  },
};
