import api from './api';
import type { AnalysisResult, ApiResponse } from '../types';

export const dockerService = {
  /** Upload a Dockerfile for AI analysis */
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

  /** Get a single analysis by ID */
  getAnalysis: async (id: string): Promise<ApiResponse<AnalysisResult>> => {
    const { data } = await api.get<ApiResponse<AnalysisResult>>(`/analyze/${id}`);
    return data;
  },

  /** Get all past analyses (history) */
  getHistory: async (): Promise<ApiResponse<AnalysisResult[]>> => {
    const { data } = await api.get<ApiResponse<AnalysisResult[]>>('/analyze/history');
    return data;
  },

  /** Delete an analysis by ID */
  deleteAnalysis: async (id: string): Promise<ApiResponse<null>> => {
    const { data } = await api.delete<ApiResponse<null>>(`/analyze/${id}`);
    return data;
  },
};
