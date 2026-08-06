import api from './api';
import type { ApiResponse, Session, User } from '../types';

export const authService = {
  signup: async (username: string, email: string, password: string): Promise<Session> => {
    const { data } = await api.post<ApiResponse<Session>>('/auth/signup', { username, email, password });
    return data.data;
  },

  login: async (identifier: string, password: string): Promise<Session> => {
    const { data } = await api.post<ApiResponse<Session>>('/auth/login', { identifier, password });
    return data.data;
  },

  logout: async (): Promise<void> => {
    await api.post('/auth/logout');
  },

  me: async (): Promise<User> => {
    const { data } = await api.get<ApiResponse<User>>('/auth/me');
    return data.data;
  },

  updateProfile: async (updates: { username?: string; email?: string }): Promise<User> => {
    const { data } = await api.patch<ApiResponse<User>>('/auth/me', updates);
    return data.data;
  },

  changePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
    await api.post('/auth/change-password', { currentPassword, newPassword });
  },
};
