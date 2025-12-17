import { pool } from '../db/connection';

export type TrackingStatus = 'not_scanned' | 'scanned' | 'delivered';

export interface TrackingNumber {
  id: number;
  tracking_number: string;
  box_id: number | null;
  current_status: TrackingStatus;
  status_details: string | null;
  custom_timestamp: Date | null;
  is_manual_status: boolean;
  trackingmore_status: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface TrackingNumberWithBox extends TrackingNumber {
  box_name: string | null;
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

export async function getAllTrackingNumbers(
  page: number = 1,
  limit: number = 50,
  status?: TrackingStatus,
  customTimestamp?: string,
  search?: string,
  unassignedOnly?: boolean
): Promise<{ 
  data: TrackingNumberWithBox[]; 
  total: number; 
  page: number; 
  limit: number;
  stats: {
    not_scanned: number;
    scanned: number;
    delivered: number;
    total: number;
  };
}> {
  const offset = (page - 1) * limit;

  // Build all parameters in order
  const queryParams: any[] = [];
  const conditions: string[] = [];
  let paramIndex = 1;

  if (status) {
    conditions.push(`t.current_status = $${paramIndex}`);
    queryParams.push(status);
    paramIndex++;
  }

  if (customTimestamp) {
    // Use date range to match the entire day (ignoring time)
    const startOfDay = new Date(customTimestamp + 'T00:00:00Z');
    const startOfNextDay = new Date(startOfDay);
    startOfNextDay.setUTCDate(startOfNextDay.getUTCDate() + 1);

    conditions.push(`t.custom_timestamp >= $${paramIndex}::TIMESTAMPTZ AND t.custom_timestamp < $${paramIndex + 1}::TIMESTAMPTZ`);
    queryParams.push(startOfDay.toISOString(), startOfNextDay.toISOString());
    paramIndex += 2;
  }

  if (search) {
    // Search in tracking_number field (case-insensitive, partial match)
    conditions.push(`t.tracking_number ILIKE $${paramIndex}`);
    queryParams.push(`%${search}%`);
    paramIndex++;
  }

  if (unassignedOnly) {
    conditions.push(`t.box_id IS NULL`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count and stats (always get all stats, not filtered)
  const countResult = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN current_status = 'not_scanned' THEN 1 END) as not_scanned,
      COUNT(CASE WHEN current_status = 'scanned' THEN 1 END) as scanned,
      COUNT(CASE WHEN current_status = 'delivered' THEN 1 END) as delivered
    FROM tracking_numbers
  `);
  const total = parseInt(countResult.rows[0].total);
  const stats = {
    not_scanned: parseInt(countResult.rows[0].not_scanned),
    scanned: parseInt(countResult.rows[0].scanned),
    delivered: parseInt(countResult.rows[0].delivered),
    total
  };

  // Get filtered total count
  let filteredTotal = total;
  if (conditions.length > 0) {
    const filteredCountResult = await pool.query(`
      SELECT COUNT(*) as total
      FROM tracking_numbers t
      ${whereClause}
    `, queryParams);
    filteredTotal = parseInt(filteredCountResult.rows[0].total);
  }

  // Add pagination parameters
  const limitParamIndex = paramIndex;
  const offsetParamIndex = paramIndex + 1;
  queryParams.push(limit, offset);

  // Get paginated data with filters
  const result = await pool.query(`
    SELECT
      t.*,
      b.name as box_name
    FROM tracking_numbers t
    LEFT JOIN boxes b ON t.box_id = b.id
    ${whereClause}
    ORDER BY t.created_at DESC
    LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
  `, queryParams);
  
  return {
    data: result.rows,
    total: filteredTotal,
    page,
    limit,
    stats
  };
}

export async function getTrackingNumbersByBox(
  boxId: number,
  page: number = 1,
  limit: number = 50,
  status?: TrackingStatus,
  customTimestamp?: string,
  search?: string
): Promise<{ 
  data: TrackingNumberWithBox[]; 
  total: number; 
  page: number; 
  limit: number;
  stats: {
    not_scanned: number;
    scanned: number;
    delivered: number;
    total: number;
  };
}> {
  const offset = (page - 1) * limit;

  // Build all parameters in order
  const queryParams: any[] = [boxId]; // box_id is always $1
  const conditions: string[] = [`t.box_id = $1`];
  let paramIndex = 2;

  if (status) {
    conditions.push(`t.current_status = $${paramIndex}`);
    queryParams.push(status);
    paramIndex++;
  }

  if (customTimestamp) {
    // Use date range to match the entire day (ignoring time)
    const startOfDay = new Date(customTimestamp + 'T00:00:00Z');
    const startOfNextDay = new Date(startOfDay);
    startOfNextDay.setUTCDate(startOfNextDay.getUTCDate() + 1);

    conditions.push(`t.custom_timestamp >= $${paramIndex}::TIMESTAMPTZ AND t.custom_timestamp < $${paramIndex + 1}::TIMESTAMPTZ`);
    queryParams.push(startOfDay.toISOString(), startOfNextDay.toISOString());
    paramIndex += 2;
  }

  if (search) {
    // Search in tracking_number field (case-insensitive, partial match)
    conditions.push(`t.tracking_number ILIKE $${paramIndex}`);
    queryParams.push(`%${search}%`);
    paramIndex++;
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  // Get total count and stats for this box (always get all stats, not filtered)
  const countResult = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN current_status = 'not_scanned' THEN 1 END) as not_scanned,
      COUNT(CASE WHEN current_status = 'scanned' THEN 1 END) as scanned,
      COUNT(CASE WHEN current_status = 'delivered' THEN 1 END) as delivered
    FROM tracking_numbers
    WHERE box_id = $1
  `, [boxId]);
  const total = parseInt(countResult.rows[0].total);
  const stats = {
    not_scanned: parseInt(countResult.rows[0].not_scanned),
    scanned: parseInt(countResult.rows[0].scanned),
    delivered: parseInt(countResult.rows[0].delivered),
    total
  };

  // Get filtered total count
  let filteredTotal = total;
  if (conditions.length > 1) {
    const filteredCountResult = await pool.query(`
      SELECT COUNT(*) as total
      FROM tracking_numbers t
      ${whereClause}
    `, queryParams);
    filteredTotal = parseInt(filteredCountResult.rows[0].total);
  }

  // Add pagination parameters
  const limitParamIndex = paramIndex;
  const offsetParamIndex = paramIndex + 1;
  queryParams.push(limit, offset);

  // Get paginated data with filters
  const result = await pool.query(`
    SELECT
      t.*,
      b.name as box_name
    FROM tracking_numbers t
    LEFT JOIN boxes b ON t.box_id = b.id
    ${whereClause}
    ORDER BY t.created_at DESC
    LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
  `, queryParams);
  
  return {
    data: result.rows,
    total: filteredTotal,
    page,
    limit,
    stats
  };
}

export async function getTrackingNumberById(id: number): Promise<TrackingNumber | null> {
  const result = await pool.query('SELECT * FROM tracking_numbers WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function getTrackingNumberByTrackingNumber(trackingNumber: string): Promise<TrackingNumber | null> {
  const result = await pool.query('SELECT * FROM tracking_numbers WHERE tracking_number = $1', [trackingNumber]);
  return result.rows[0] || null;
}

export async function updateTrackingNumberBox(
  id: number,
  boxId: number | null
): Promise<TrackingNumber | null> {
  const result = await pool.query(
    'UPDATE tracking_numbers SET box_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
    [boxId, id]
  );
  return result.rows[0] || null;
}

export async function updateTrackingStatus(
  id: number,
  status: TrackingStatus,
  statusDetails?: string,
  customTimestamp?: Date | null,
  isManual: boolean = false,
  trackingmoreStatus?: string | null
): Promise<TrackingNumber | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get current tracking number info for logging
    const currentInfo = await client.query(
      'SELECT tracking_number, current_status, status_details FROM tracking_numbers WHERE id = $1',
      [id]
    );

    if (currentInfo.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const currentTrackingNumber = currentInfo.rows[0];
    const oldStatus = currentTrackingNumber.current_status;
    const oldStatusDetails = currentTrackingNumber.status_details;

    // If customTimestamp is undefined, preserve the existing value
    // Only update custom_timestamp if it's explicitly provided (including null to clear it)
    const shouldUpdateCustomTimestamp = customTimestamp !== undefined;

    let updateResult;
    if (shouldUpdateCustomTimestamp) {
      // Update including custom_timestamp
      updateResult = await client.query(
        `UPDATE tracking_numbers
         SET current_status = $1,
             status_details = $2,
             custom_timestamp = $3,
             is_manual_status = $4,
             trackingmore_status = $5,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $6
         RETURNING *`,
        [status, statusDetails || null, customTimestamp, isManual, trackingmoreStatus || null, id]
      );
    } else {
      // Update without changing custom_timestamp (preserve existing value)
      // Only update trackingmore_status if provided
      if (trackingmoreStatus !== undefined) {
        updateResult = await client.query(
          `UPDATE tracking_numbers
           SET current_status = $1,
               status_details = $2,
               is_manual_status = $3,
               trackingmore_status = $4,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $5
           RETURNING *`,
          [status, statusDetails || null, isManual, trackingmoreStatus || null, id]
        );
      } else {
        updateResult = await client.query(
          `UPDATE tracking_numbers
           SET current_status = $1,
               status_details = $2,
               is_manual_status = $3,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $4
           RETURNING *`,
          [status, statusDetails || null, isManual, id]
        );
      }
    }

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

    // Log the status change
    const trackingNumber = updateResult.rows[0].tracking_number;
    const timestamp = new Date().toISOString();

    if (oldStatus !== status) {
      console.log(`[${timestamp}] STATUS_CHANGE: ${trackingNumber} - ${oldStatus} → ${status}${statusDetails ? ` (${statusDetails})` : ''}${isManual ? ' [MANUAL]' : ''}`);
    } else if (oldStatusDetails !== (statusDetails || null)) {
      console.log(`[${timestamp}] DETAILS_UPDATE: ${trackingNumber} - Status details updated: "${oldStatusDetails || '(empty)'}" → "${statusDetails || '(empty)'}"`);
    }

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

export async function deleteAllTrackingNumbers(): Promise<number> {
  const result = await pool.query('DELETE FROM tracking_numbers');
  return result.rowCount ?? 0;
}

export async function bulkCreateTrackingNumbers(
  trackingNumbers: string[],
  boxId: number | null = null,
  customTimestamp: Date | null = null
): Promise<TrackingNumber[]> {
  const results: TrackingNumber[] = [];
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    for (const tn of trackingNumbers) {
      console.log(`Inserting tracking number: ${tn.trim()}, customTimestamp: ${customTimestamp}, type: ${typeof customTimestamp}`);
      const result = await client.query(
        `INSERT INTO tracking_numbers (tracking_number, box_id, current_status, custom_timestamp)
         VALUES ($1, $2, 'not_scanned', $3)
         ON CONFLICT (tracking_number) DO NOTHING
         RETURNING *`,
        [tn.trim(), boxId, customTimestamp]
      );
      
      if (result.rows.length > 0) {
        console.log(`Created tracking number ${tn.trim()} with custom_timestamp: ${result.rows[0].custom_timestamp}`);
        results.push(result.rows[0]);
        // Create initial status history entry
        await client.query(
          'INSERT INTO status_history (tracking_number_id, status) VALUES ($1, $2)',
          [result.rows[0].id, 'not_scanned']
        );
      } else {
        console.log(`Tracking number ${tn.trim()} already exists, skipped (ON CONFLICT DO NOTHING)`);
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

