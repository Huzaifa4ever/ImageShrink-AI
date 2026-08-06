import api from './api';
import type { ApiKey, ApiResponse, ConnectedSession, User } from '../types';

export const accountService = {
  sessions: async (): Promise<ConnectedSession[]> => {
    const { data } = await api.get<ApiResponse<ConnectedSession[]>>('/account/sessions');
    return data.data;
  },

  revokeSession: async (id: string): Promise<{ signedOutSelf: boolean }> => {
    const { data } = await api.delete<ApiResponse<{ signedOutSelf: boolean }>>(
      `/account/sessions/${id}`
    );
    return data.data;
  },

  revokeOtherSessions: async (): Promise<number> => {
    const { data } = await api.post<ApiResponse<{ revoked: number }>>(
      '/account/sessions/revoke-others'
    );
    return data.data.revoked;
  },

  apiKeys: async (): Promise<ApiKey[]> => {
    const { data } = await api.get<ApiResponse<ApiKey[]>>('/account/api-keys');
    return data.data;
  },

  createApiKey: async (name: string): Promise<ApiKey & { key: string }> => {
    const { data } = await api.post<ApiResponse<ApiKey & { key: string }>>('/account/api-keys', {
      name,
    });
    return data.data;
  },

  revokeApiKey: async (id: string): Promise<void> => {
    await api.delete(`/account/api-keys/${id}`);
  },

  setAvatar: async (avatar: string | null): Promise<User> => {
    const { data } = await api.put<ApiResponse<User>>('/account/avatar', { avatar });
    return data.data;
  },

  deleteAccount: async (password: string, confirmUsername: string): Promise<number> => {
    const { data } = await api.post<ApiResponse<{ deletedAnalyses: number }>>('/account/delete', {
      password,
      confirmUsername,
    });
    return data.data.deletedAnalyses;
  },
};

export async function downscaleImage(file: File, size = 256, quality = 0.85): Promise<string> {
  const bitmap = await createImageBitmap(file);

  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not process that image.');
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  bitmap.close();

  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  if (dataUrl.length > 256 * 1024 * 1.4) {
    return canvas.toDataURL('image/jpeg', 0.6);
  }
  return dataUrl;
}
