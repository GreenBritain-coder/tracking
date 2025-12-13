import { pool } from '../db/connection';
import { TrackingStatus } from './tracking';

export interface StatusHistory {
  id: number;
  tracking_number_id: number;
  status: TrackingStatus;
  timestamp: Date;
  notes: string | null;
}

export async function getStatusHistory(trackingNumberId: number): Promise<StatusHistory[]> {
  const result = await pool.query(
    'SELECT * FROM status_history WHERE tracking_number_id = $1 ORDER BY timestamp ASC',
    [trackingNumberId]
  );
  return result.rows;
}

export async function getStatusHistoryByBox(boxId: number): Promise<StatusHistory[]> {
  const result = await pool.query(`
    SELECT sh.*
    FROM status_history sh
    JOIN tracking_numbers t ON sh.tracking_number_id = t.id
    WHERE t.box_id = $1
    ORDER BY sh.timestamp ASC
  `, [boxId]);
  return result.rows;
}

