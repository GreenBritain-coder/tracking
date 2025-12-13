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
  current_status: 'not_scanned' | 'scanned' | 'delivered';
  created_at: string;
  updated_at: string;
  box_name?: string | null;
}

export const api = {
  // Boxes
  getBoxes: () => axios.get<Box[]>(`${API_URL}/tracking/boxes`),
  createBox: (name: string) => axios.post<Box>(`${API_URL}/tracking/boxes`, { name }),
  deleteBox: (id: number) => axios.delete(`${API_URL}/tracking/boxes/${id}`),

  // Tracking Numbers
  getTrackingNumbers: (boxId?: number) => {
    const params = boxId ? { boxId } : {};
    return axios.get<TrackingNumber[]>(`${API_URL}/tracking/numbers`, { params });
  },
  createTrackingNumber: (trackingNumber: string, boxId?: number) =>
    axios.post<TrackingNumber>(`${API_URL}/tracking/numbers`, {
      tracking_number: trackingNumber,
      box_id: boxId,
    }),
  bulkCreateTrackingNumbers: (trackingNumbers: string[], boxId?: number) =>
    axios.post(`${API_URL}/tracking/numbers/bulk`, {
      tracking_numbers: trackingNumbers,
      box_id: boxId,
    }),
  deleteTrackingNumber: (id: number) =>
    axios.delete(`${API_URL}/tracking/numbers/${id}`),

  // Analytics
  getBoxAnalytics: () => axios.get(`${API_URL}/analytics/boxes`),
  getBoxAnalyticsDetail: (boxId: number) =>
    axios.get(`${API_URL}/analytics/boxes/${boxId}`),
  getOverviewAnalytics: () => axios.get(`${API_URL}/analytics/overview`),

  // Refresh tracking statuses
  refreshTrackingStatuses: () => axios.post(`${API_URL}/tracking/refresh`),
};

