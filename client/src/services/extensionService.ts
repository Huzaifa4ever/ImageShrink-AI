import api from './api';
import type { ApiResponse, DeviceRequest } from '../types';

export const extensionService = {
  pending: async (userCode: string): Promise<DeviceRequest> => {
    const { data } = await api.get<ApiResponse<DeviceRequest>>('/auth/device/pending', {
      params: { userCode },
    });
    return data.data;
  },

  approve: async (userCode: string): Promise<void> => {
    await api.post('/auth/device/approve', { userCode });
  },

  deny: async (userCode: string): Promise<void> => {
    await api.post('/auth/device/deny', { userCode });
  },
};
