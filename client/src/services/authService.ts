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

  /** Exchange a Google ID token for one of our sessions. */
  googleSignIn: async (credential: string): Promise<Session> => {
    const { data } = await api.post<ApiResponse<Session>>('/auth/google', { credential });
    return data.data;
  },

  /**
   * Always resolves, even for an address with no account — the API deliberately does not say
   * which addresses are registered, and the UI must not imply otherwise.
   */
  forgotPassword: async (email: string): Promise<string> => {
    const { data } = await api.post<ApiResponse<null>>('/auth/forgot-password', { email });
    return data.message ?? 'If that email has an account, a reset link is on its way.';
  },

  resetPassword: async (token: string, newPassword: string): Promise<void> => {
    await api.post('/auth/reset-password', { token, newPassword });
  },

  confirmEmail: async (token: string): Promise<User> => {
    const { data } = await api.post<ApiResponse<User>>('/auth/verify-email/confirm', { token });
    return data.data;
  },

  resendVerification: async (): Promise<string> => {
    const { data } = await api.post<ApiResponse<null>>('/auth/verify-email/send');
    return data.message ?? 'Confirmation link sent.';
  },
};
