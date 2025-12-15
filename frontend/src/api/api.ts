import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export interface Box {
  id: number;
  name: string;
  created_at: string;
}

export interface TrackingNumber {
  id: number;
  tracking_number: string;
  box_id: number | null;
  postbox_id: number | null;
  current_status: 'not_scanned' | 'scanned' | 'delivered';
  status_details?: string | null;
  custom_timestamp?: string | null;
  created_at: string;
  updated_at: string;
  box_name?: string | null;
  postbox_name?: string | null;
}

export interface Postbox {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

export const api = {
  // Boxes
  getBoxes: () => axios.get<Box[]>(`${API_URL}/tracking/boxes`),
  createBox: (name: string) => axios.post<Box>(`${API_URL}/tracking/boxes`, { name }),
  deleteBox: (id: number) => axios.delete(`${API_URL}/tracking/boxes/${id}`),

  // Tracking Numbers
  getTrackingNumbers: (boxId?: number, page?: number, limit?: number) => {
    const params: any = {};
    if (boxId) params.boxId = boxId;
    if (page) params.page = page;
    if (limit) params.limit = limit;
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
    postboxId?: number | null,
    customTimestamp?: string | null
  ) =>
    axios.patch<TrackingNumber>(`${API_URL}/tracking/numbers/${id}/status`, { 
      status,
      postbox_id: postboxId,
      custom_timestamp: customTimestamp
    }),

  // Postboxes
  getPostboxes: () => axios.get<Postbox[]>(`${API_URL}/tracking/postboxes`),
  createPostbox: (name: string) => axios.post<Postbox>(`${API_URL}/tracking/postboxes`, { name }),
  updatePostbox: (id: number, name: string) => axios.patch<Postbox>(`${API_URL}/tracking/postboxes/${id}`, { name }),
  deletePostbox: (id: number) => axios.delete(`${API_URL}/tracking/postboxes/${id}`),

  // Analytics
  getBoxAnalytics: () => axios.get(`${API_URL}/analytics/boxes`),
  getBoxAnalyticsDetail: (boxId: number) =>
    axios.get(`${API_URL}/analytics/boxes/${boxId}`),
  getOverviewAnalytics: () => axios.get(`${API_URL}/analytics/overview`),

  // Refresh tracking statuses
  refreshTrackingStatuses: () => axios.post(`${API_URL}/tracking/refresh`),
  refreshTrackingNumber: (id: number) =>
    axios.post<{ message: string; tracking: TrackingNumber }>(`${API_URL}/tracking/numbers/${id}/refresh`),
};

