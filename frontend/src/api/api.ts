import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export interface Box {
  id: number;
  name: string;
  created_at: string;
  updated_at?: string;
}

export interface TrackingNumber {
  id: number;
  tracking_number: string;
  box_id: number | null;
  current_status: 'not_scanned' | 'scanned' | 'delivered';
  status_details?: string | null;
  custom_timestamp?: string | null;
  is_manual_status: boolean;
  trackingmore_status: string | null;
  created_at: string;
  updated_at: string;
  box_name?: string | null;
}

export interface StatusChangeLog {
  id: number;
  tracking_number: string;
  old_status: string | null;
  new_status: string;
  status_details: string | null;
  box_name: string | null;
  changed_at: string;
  change_type: 'status_change' | 'details_update';
}

export const api = {
  // Boxes
  getBoxes: () => axios.get<Box[]>(`${API_URL}/tracking/boxes`),
  createBox: (name: string) => axios.post<Box>(`${API_URL}/tracking/boxes`, { name }),
  updateBox: (id: number, name: string) => axios.patch<Box>(`${API_URL}/tracking/boxes/${id}`, { name }),
  deleteBox: (id: number) => axios.delete(`${API_URL}/tracking/boxes/${id}`),

  // Tracking Numbers
  getTrackingNumbers: (boxId?: number, page?: number, limit?: number, status?: 'not_scanned' | 'scanned' | 'delivered', customTimestamp?: string, search?: string) => {
    const params: any = {};
    if (boxId) params.boxId = boxId;
    if (page) params.page = page;
    if (limit) params.limit = limit;
    if (status) params.status = status;
    if (customTimestamp) params.customTimestamp = customTimestamp;
    if (search) params.search = search;
    return axios.get<{ 
      data: TrackingNumber[]; 
      total: number; 
      page: number; 
      limit: number;
      stats: {
        not_scanned: number;
        scanned: number;
        delivered: number;
        total: number;
      };
    }>(`${API_URL}/tracking/numbers`, { params });
  },
  createTrackingNumber: (trackingNumber: string, boxId?: number) =>
    axios.post<TrackingNumber>(`${API_URL}/tracking/numbers`, {
      tracking_number: trackingNumber,
      box_id: boxId,
    }),
  bulkCreateTrackingNumbers: (trackingNumbers: string[], boxId?: number, customTimestamp?: string | null) =>
    axios.post(`${API_URL}/tracking/numbers/bulk`, {
      tracking_numbers: trackingNumbers,
      box_id: boxId,
      custom_timestamp: customTimestamp,
    }),
  deleteTrackingNumber: (id: number) =>
    axios.delete(`${API_URL}/tracking/numbers/${id}`),
  deleteAllTrackingNumbers: () =>
    axios.delete(`${API_URL}/tracking/numbers`),
  updateTrackingStatus: (
    id: number, 
    status: 'not_scanned' | 'scanned' | 'delivered',
    customTimestamp?: string | null
  ) =>
    axios.patch<TrackingNumber>(`${API_URL}/tracking/numbers/${id}/status`, { 
      status,
      custom_timestamp: customTimestamp
    }),
  updateTrackingNumberBox: (id: number, boxId?: number | null) =>
    axios.patch<TrackingNumber>(`${API_URL}/tracking/numbers/${id}/box`, {
      box_id: boxId,
    }),

  // Analytics
  getBoxAnalytics: () => axios.get(`${API_URL}/analytics/boxes`),
  getBoxAnalyticsDetail: (boxId: number) =>
    axios.get(`${API_URL}/analytics/boxes/${boxId}`),
  getOverviewAnalytics: () => axios.get(`${API_URL}/analytics/overview`),

  // Refresh tracking statuses
  refreshTrackingStatuses: () => axios.post(`${API_URL}/tracking/refresh`),
  refreshTrackingNumber: (id: number) =>
    axios.post<{ message: string; tracking: TrackingNumber }>(`${API_URL}/tracking/numbers/${id}/refresh`),

  // Logs
  getStatusChangeLogs: (
    limit?: number,
    changeType?: 'status_change' | 'details_update',
    status?: 'not_scanned' | 'scanned' | 'delivered',
    boxId?: number,
    trackingNumber?: string
  ) => {
    const params: any = {};
    if (limit) params.limit = limit;
    if (changeType) params.changeType = changeType;
    if (status) params.status = status;
    if (boxId) params.boxId = boxId;
    if (trackingNumber) params.trackingNumber = trackingNumber;
    return axios.get<StatusChangeLog[]>(`${API_URL}/tracking/logs/status-changes`, { params });
  },
};

