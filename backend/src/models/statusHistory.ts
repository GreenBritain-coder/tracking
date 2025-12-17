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

export async function getRecentStatusChanges(
  limit: number = 50,
  changeType?: 'status_change' | 'details_update',
  status?: 'not_scanned' | 'scanned' | 'delivered',
  boxId?: number,
  trackingNumberSearch?: string
): Promise<StatusChangeLog[]> {
  let query = `
    WITH status_changes AS (
      SELECT
        sh.id,
        t.tracking_number,
        lag(sh.status) OVER (PARTITION BY sh.tracking_number_id ORDER BY sh.timestamp) as old_status,
        sh.status as new_status,
        t.status_details,
        b.name as box_name,
        b.id as box_id,
        sh.timestamp as changed_at,
        CASE
          WHEN lag(sh.status) OVER (PARTITION BY sh.tracking_number_id ORDER BY sh.timestamp) != sh.status THEN 'status_change'
          ELSE 'details_update'
        END as change_type
      FROM status_history sh
      JOIN tracking_numbers t ON sh.tracking_number_id = t.id
      LEFT JOIN boxes b ON t.box_id = b.id
    )
    SELECT * FROM status_changes
    WHERE 1=1
  `;
  
  const params: any[] = [];
  let paramCount = 0;

  if (changeType) {
    paramCount++;
    query += ` AND change_type = $${paramCount}`;
    params.push(changeType);
  }

  if (status) {
    paramCount++;
    query += ` AND new_status = $${paramCount}`;
    params.push(status);
  }

  if (boxId) {
    paramCount++;
    query += ` AND box_id = $${paramCount}`;
    params.push(boxId);
  }

  if (trackingNumberSearch) {
    paramCount++;
    query += ` AND tracking_number ILIKE $${paramCount}`;
    params.push(`%${trackingNumberSearch}%`);
  }

  query += ` ORDER BY changed_at DESC LIMIT $${paramCount + 1}`;
  params.push(limit);

  const result = await pool.query(query, params);
  return result.rows;
}

