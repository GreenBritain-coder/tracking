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

export interface StatusChangeLog {
  id: number;
  tracking_number: string;
  old_status: string | null;
  new_status: string;
  status_details: string | null;
  box_name: string | null;
  changed_at: Date;
  change_type: 'status_change' | 'details_update';
}

export async function getRecentStatusChanges(limit: number = 50): Promise<StatusChangeLog[]> {
  const result = await pool.query(`
    SELECT
      sh.id,
      t.tracking_number,
      lag(sh.status) OVER (PARTITION BY sh.tracking_number_id ORDER BY sh.timestamp) as old_status,
      sh.status as new_status,
      t.status_details,
      b.name as box_name,
      sh.timestamp as changed_at,
      CASE
        WHEN lag(sh.status) OVER (PARTITION BY sh.tracking_number_id ORDER BY sh.timestamp) != sh.status THEN 'status_change'
        ELSE 'details_update'
      END as change_type
    FROM status_history sh
    JOIN tracking_numbers t ON sh.tracking_number_id = t.id
    LEFT JOIN boxes b ON t.box_id = b.id
    ORDER BY sh.timestamp DESC
    LIMIT $1
  `, [limit]);
  return result.rows;
}

