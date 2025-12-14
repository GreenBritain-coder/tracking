import { pool } from '../db/connection';

export type TrackingStatus = 'not_scanned' | 'scanned' | 'delivered';

export interface TrackingNumber {
  id: number;
  tracking_number: string;
  box_id: number | null;
  postbox_id: number | null;
  current_status: TrackingStatus;
  status_details: string | null;
  custom_timestamp: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface TrackingNumberWithBox extends TrackingNumber {
  box_name: string | null;
  postbox_name: string | null;
}

export async function createTrackingNumber(
  trackingNumber: string,
  boxId: number | null = null
): Promise<TrackingNumber> {
  const result = await pool.query(
    `INSERT INTO tracking_numbers (tracking_number, box_id, current_status)
     VALUES ($1, $2, 'not_scanned')
     ON CONFLICT (tracking_number) DO NOTHING
     RETURNING *`,
    [trackingNumber, boxId]
  );
  
  if (result.rows.length === 0) {
    // Already exists, return existing
    const existing = await pool.query(
      'SELECT * FROM tracking_numbers WHERE tracking_number = $1',
      [trackingNumber]
    );
    return existing.rows[0];
  }
  
  // Create initial status history entry
  await pool.query(
    'INSERT INTO status_history (tracking_number_id, status) VALUES ($1, $2)',
    [result.rows[0].id, 'not_scanned']
  );
  
  return result.rows[0];
}

export async function getAllTrackingNumbers(): Promise<TrackingNumberWithBox[]> {
  const result = await pool.query(`
    SELECT 
      t.*,
      b.name as box_name,
      p.name as postbox_name
    FROM tracking_numbers t
    LEFT JOIN boxes b ON t.box_id = b.id
    LEFT JOIN postboxes p ON t.postbox_id = p.id
    ORDER BY t.created_at DESC
  `);
  return result.rows;
}

export async function getTrackingNumbersByBox(boxId: number): Promise<TrackingNumberWithBox[]> {
  const result = await pool.query(`
    SELECT 
      t.*,
      b.name as box_name,
      p.name as postbox_name
    FROM tracking_numbers t
    LEFT JOIN boxes b ON t.box_id = b.id
    LEFT JOIN postboxes p ON t.postbox_id = p.id
    WHERE t.box_id = $1
    ORDER BY t.created_at DESC
  `, [boxId]);
  return result.rows;
}

export async function getTrackingNumberById(id: number): Promise<TrackingNumber | null> {
  const result = await pool.query('SELECT * FROM tracking_numbers WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function updateTrackingStatus(
  id: number,
  status: TrackingStatus,
  statusDetails?: string,
  postboxId?: number | null,
  customTimestamp?: Date | null
): Promise<TrackingNumber | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Update tracking number
    const updateResult = await client.query(
      `UPDATE tracking_numbers 
       SET current_status = $1, 
           status_details = $2, 
           postbox_id = $3,
           custom_timestamp = $4,
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = $5 
       RETURNING *`,
      [status, statusDetails || null, postboxId ?? null, customTimestamp || null, id]
    );
    
    if (updateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    
    // Add to status history
    await client.query(
      'INSERT INTO status_history (tracking_number_id, status) VALUES ($1, $2)',
      [id, status]
    );
    
    await client.query('COMMIT');
    return updateResult.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteTrackingNumber(id: number): Promise<boolean> {
  const result = await pool.query('DELETE FROM tracking_numbers WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function bulkCreateTrackingNumbers(
  trackingNumbers: string[],
  boxId: number | null = null
): Promise<TrackingNumber[]> {
  const results: TrackingNumber[] = [];
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    for (const tn of trackingNumbers) {
      const result = await client.query(
        `INSERT INTO tracking_numbers (tracking_number, box_id, current_status)
         VALUES ($1, $2, 'not_scanned')
         ON CONFLICT (tracking_number) DO NOTHING
         RETURNING *`,
        [tn.trim(), boxId]
      );
      
      if (result.rows.length > 0) {
        results.push(result.rows[0]);
        // Create initial status history entry
        await client.query(
          'INSERT INTO status_history (tracking_number_id, status) VALUES ($1, $2)',
          [result.rows[0].id, 'not_scanned']
        );
      }
    }
    
    await client.query('COMMIT');
    return results;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

