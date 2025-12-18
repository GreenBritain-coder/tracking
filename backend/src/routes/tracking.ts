import express, { Response, Request } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticate, AuthRequest } from '../middleware/auth';
import {
  createTrackingNumber,
  getAllTrackingNumbers,
  getTrackingNumbersByBox,
  getTrackingNumberById,
  updateTrackingStatus,
  deleteTrackingNumber,
  bulkCreateTrackingNumbers,
  deleteAllTrackingNumbers,
  updateTrackingNumberBox,
} from '../models/tracking';
import { createBox, getAllBoxes, getBoxById, updateBox, deleteBox, getKingBoxes } from '../models/box';
import { getStatusHistory, getRecentStatusChanges } from '../models/statusHistory';
import { updateAllTrackingStatuses } from '../services/scheduler';
import { checkRoyalMailStatus } from '../services/scraper';
import { pool } from '../db/connection';
import { verifyToken } from '../services/auth';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Boxes endpoints
router.get('/boxes', async (req: AuthRequest, res: Response) => {
  try {
    const kingBoxId = req.query.kingBoxId ? parseInt(req.query.kingBoxId as string) : undefined;
    const boxes = await getAllBoxes(kingBoxId || null);
    res.json(boxes);
  } catch (error) {
    console.error('Error fetching boxes:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get king boxes only
router.get('/boxes/king', async (req: AuthRequest, res: Response) => {
  try {
    const kingBoxes = await getKingBoxes();
    res.json(kingBoxes);
  } catch (error) {
    console.error('Error fetching king boxes:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post(
  '/boxes',
  [
    body('name').notEmpty().trim(),
    body('parent_box_id').optional({ nullable: true, checkFalsy: true }).custom((value) => {
      if (value === undefined || value === null) return true;
      const num = Number(value);
      if (isNaN(num) || !Number.isInteger(num)) {
        throw new Error('parent_box_id must be an integer');
      }
      return true;
    }),
    body('is_king_box').optional().custom((value) => {
      if (value === undefined || value === null) return true;
      if (typeof value === 'boolean') return true;
      if (typeof value === 'string' && (value === 'true' || value === 'false')) return true;
      throw new Error('is_king_box must be a boolean');
    }),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('Validation errors:', JSON.stringify(errors.array(), null, 2));
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    try {
      const { name, parent_box_id, is_king_box } = req.body;
      
      // Convert is_king_box to boolean if it's a string
      let isKingBox = false;
      if (is_king_box !== undefined && is_king_box !== null) {
        if (typeof is_king_box === 'string') {
          isKingBox = is_king_box === 'true';
        } else {
          isKingBox = Boolean(is_king_box);
        }
      }
      
      // Validate parent box exists if provided
      if (parent_box_id !== undefined && parent_box_id !== null) {
        const parentBox = await getBoxById(parent_box_id);
        if (!parentBox) {
          return res.status(404).json({ error: 'Parent box not found' });
        }
        if (!parentBox.is_king_box) {
          return res.status(400).json({ error: 'Parent box must be a king box' });
        }
      }
      
      const box = await createBox(name, parent_box_id || null, isKingBox);
      res.status(201).json(box);
    } catch (error: any) {
      console.error('Error creating box:', error);
      console.error('Error details:', error.message, error.stack);
      res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  }
);

router.patch(
  '/boxes/:id',
  [
    body('name').notEmpty().trim(),
    body('parent_box_id').optional({ nullable: true }).isInt(),
    body('is_king_box').optional().isBoolean(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const { name, parent_box_id, is_king_box } = req.body;
      
      // Validate parent box exists if provided
      if (parent_box_id !== undefined && parent_box_id !== null) {
        const parentBox = await getBoxById(parent_box_id);
        if (!parentBox) {
          return res.status(404).json({ error: 'Parent box not found' });
        }
        if (!parentBox.is_king_box) {
          return res.status(400).json({ error: 'Parent box must be a king box' });
        }
      }
      
      const box = await updateBox(
        Number(id),
        name,
        parent_box_id !== undefined ? parent_box_id : undefined,
        is_king_box !== undefined ? is_king_box : undefined
      );
      if (!box) {
        return res.status(404).json({ error: 'Box not found' });
      }
      res.json(box);
    } catch (error) {
      console.error('Error updating box:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.delete('/boxes/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const deleted = await deleteBox(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Box not found' });
    }
    res.json({ message: 'Box deleted successfully' });
  } catch (error) {
    console.error('Error deleting box:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Tracking numbers endpoints
router.get('/numbers', async (req: AuthRequest, res: Response) => {
  try {
    const boxId = req.query.boxId ? parseInt(req.query.boxId as string) : undefined;
    const page = req.query.page ? parseInt(req.query.page as string) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const status = req.query.status as 'not_scanned' | 'scanned' | 'delivered' | undefined;
    const customTimestamp = req.query.customTimestamp as string | undefined;
    const search = req.query.search as string | undefined;
    const trackingNumberSearch = req.query.trackingNumber as string | undefined;
    const unassignedOnly = req.query.unassignedOnly === 'true';
    const kingBoxId = req.query.kingBoxId ? parseInt(req.query.kingBoxId as string) : undefined;
    
    // Validate status if provided
    if (status && !['not_scanned', 'scanned', 'delivered'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status filter' });
    }
    
    // Validate customTimestamp format if provided (should be YYYY-MM-DD)
    if (customTimestamp && !/^\d{4}-\d{2}-\d{2}$/.test(customTimestamp)) {
      return res.status(400).json({ error: 'Invalid customTimestamp format. Expected YYYY-MM-DD' });
    }
    
    // If boxId is specified, use getTrackingNumbersByBox (takes precedence)
    // Otherwise, use getAllTrackingNumbers with optional kingBoxId filter
    const result = boxId
      ? await getTrackingNumbersByBox(boxId, page, limit, status, customTimestamp, search || trackingNumberSearch)
      : await getAllTrackingNumbers(page, limit, status, customTimestamp, search || trackingNumberSearch, unassignedOnly, kingBoxId || null);
    res.json(result);
  } catch (error) {
    console.error('Error fetching tracking numbers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/numbers/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const trackingNumber = await getTrackingNumberById(id);
    if (!trackingNumber) {
      return res.status(404).json({ error: 'Tracking number not found' });
    }
    
    const history = await getStatusHistory(id);
    res.json({ ...trackingNumber, history });
  } catch (error) {
    console.error('Error fetching tracking number:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post(
  '/numbers',
  [
    body('tracking_number').notEmpty().trim(),
    body('box_id').optional().isInt(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { tracking_number, box_id } = req.body;
      
      // Validate box exists if provided
      if (box_id) {
        const box = await getBoxById(box_id);
        if (!box) {
          return res.status(404).json({ error: 'Box not found' });
        }
      }
      
      const tracking = await createTrackingNumber(tracking_number, box_id || null);
      res.status(201).json(tracking);
    } catch (error) {
      console.error('Error creating tracking number:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.post(
  '/numbers/bulk',
  [
    body('tracking_numbers').isArray().notEmpty(),
    body('tracking_numbers.*').isString().trim().notEmpty(),
    body('box_id').optional().isInt(),
    body('custom_timestamp')
      .optional({ nullable: true, checkFalsy: true })
      .custom((value) => {
        // If value is null, undefined, or empty string, it's valid
        if (value === null || value === undefined || value === '') {
          return true;
        }
        // Otherwise, it must be a valid ISO8601 date
        const date = new Date(value);
        if (isNaN(date.getTime())) {
          throw new Error('custom_timestamp must be a valid ISO8601 date string');
        }
        return true;
      })
      .toDate(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { tracking_numbers, box_id, custom_timestamp } = req.body;
      
      console.log('Bulk import request:', {
        tracking_numbers_count: tracking_numbers?.length,
        box_id,
        custom_timestamp,
        custom_timestamp_type: typeof custom_timestamp
      });
      
      // Validate box exists if provided
      if (box_id) {
        const box = await getBoxById(box_id);
        if (!box) {
          return res.status(404).json({ error: 'Box not found' });
        }
      }
      
      const created = await bulkCreateTrackingNumbers(
        tracking_numbers, 
        box_id || null,
        custom_timestamp || null
      );
      
      console.log('Bulk import result:', {
        created_count: created.length,
        first_item_custom_timestamp: created[0]?.custom_timestamp
      });
      res.status(201).json({ 
        message: `Created ${created.length} tracking numbers`,
        tracking_numbers: created 
      });
    } catch (error) {
      console.error('Error bulk creating tracking numbers:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.delete('/numbers/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const deleted = await deleteTrackingNumber(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Tracking number not found' });
    }
    res.json({ message: 'Tracking number deleted successfully' });
  } catch (error) {
    console.error('Error deleting tracking number:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete all tracking numbers
router.delete('/numbers', async (req: AuthRequest, res: Response) => {
  try {
    const deletedCount = await deleteAllTrackingNumbers();
    res.json({ 
      message: `Successfully deleted ${deletedCount} tracking number(s)`,
      deletedCount 
    });
  } catch (error) {
    console.error('Error deleting all tracking numbers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update box for existing tracking number
router.patch(
  '/numbers/:id/box',
  [body('box_id').optional({ nullable: true }).isInt()],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const { box_id } = req.body;
      
      // Validate box exists if provided
      if (box_id) {
        const box = await getBoxById(box_id);
        if (!box) {
          return res.status(404).json({ error: 'Box not found' });
        }
      }
      
      const tracking = await getTrackingNumberById(Number(id));
      if (!tracking) {
        return res.status(404).json({ error: 'Tracking number not found' });
      }

      const updated = await updateTrackingNumberBox(Number(id), box_id || null);
      res.json(updated);
    } catch (error) {
      console.error('Error updating tracking number box:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// Manual refresh endpoint for a single tracking number
router.post('/numbers/:id/refresh', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const tracking = await getTrackingNumberById(id);
    
    if (!tracking) {
      return res.status(404).json({ error: 'Tracking number not found' });
    }

    // Skip if manually set
    if (tracking.is_manual_status) {
      return res.status(400).json({ 
        error: 'Cannot refresh: Status is manually set. Clear manual flag first or update status manually.' 
      });
    }

    console.log(`Manual refresh requested for ${tracking.tracking_number}`);
    
    const result = await checkRoyalMailStatus(tracking.tracking_number);
    
    // Update status if changed (isManual=false for refresh)
    if (result.status !== tracking.current_status || result.statusHeader !== tracking.status_details) {
      await updateTrackingStatus(tracking.id, result.status, result.statusHeader, undefined, false, result.trackingmoreStatus);
      console.log(`Manual refresh updated ${tracking.tracking_number}: ${tracking.current_status} -> ${result.status}`);
    }
    
    // Get updated tracking
    const updated = await getTrackingNumberById(id);
    res.json({ 
      message: 'Tracking status refreshed',
      tracking: updated,
      status: result.status,
      statusHeader: result.statusHeader
    });
  } catch (error) {
    console.error('Error in manual refresh:', error);
    res.status(500).json({ error: 'Failed to refresh tracking status' });
  }
});

// Manual refresh endpoint - trigger status update for all tracking numbers
router.post('/refresh', async (req: AuthRequest, res: Response) => {
  try {
    // Start the update process (non-blocking)
    updateAllTrackingStatuses().catch((error) => {
      console.error('Error in manual refresh:', error);
    });
    
    res.json({ 
      message: 'Tracking status refresh started. Check logs for progress.',
      note: 'This may take a few minutes depending on the number of tracking numbers.'
    });
  } catch (error) {
    console.error('Error starting manual refresh:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Manual status update endpoint - update a single tracking number's status
router.patch(
  '/numbers/:id/status',
  [
    body('status').isIn(['not_scanned', 'scanned', 'delivered']),
    body('custom_timestamp').optional({ nullable: true, checkFalsy: true }).isISO8601().toDate(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('Validation errors:', JSON.stringify(errors.array(), null, 2));
      console.error('Request body:', JSON.stringify(req.body, null, 2));
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const { status, custom_timestamp } = req.body;
      
      console.log(`Updating tracking ${id}: status=${status}, custom_timestamp=${custom_timestamp}`);
      
      const tracking = await getTrackingNumberById(Number(id));
      if (!tracking) {
        return res.status(404).json({ error: 'Tracking number not found' });
      }

      // Set isManual=true when manually updating status
      await updateTrackingStatus(
        Number(id), 
        status, 
        undefined, 
        custom_timestamp || null,
        true  // isManual = true
      );
      
      // Get updated tracking with joins (use large limit to get all, then find the one we need)
      const allTracking = await getAllTrackingNumbers(1, 10000);
      const updated = allTracking.data.find(t => t.id === Number(id));
      
      res.json(updated);
    } catch (error) {
      console.error('Error updating tracking status:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// Logs endpoints
router.get('/logs/status-changes', async (req: AuthRequest, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const changeType = req.query.changeType as 'status_change' | 'details_update' | undefined;
    const status = req.query.status as 'not_scanned' | 'scanned' | 'delivered' | undefined;
    const boxId = req.query.boxId ? parseInt(req.query.boxId as string) : undefined;
    const trackingNumber = req.query.trackingNumber as string | undefined;
    
    const logs = await getRecentStatusChanges(
      Math.min(limit, 200), // Max 200 entries
      changeType,
      status,
      boxId,
      trackingNumber
    );
    res.json(logs);
  } catch (error) {
    console.error('Error fetching status change logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Test endpoint to verify SSE route is accessible
router.get('/logs/stream/test', authenticate, (req: AuthRequest, res: Response) => {
  res.json({ 
    message: 'SSE endpoint is accessible',
    timestamp: new Date().toISOString(),
    user: req.userEmail
  });
});

// Handle OPTIONS for SSE endpoint (CORS preflight)
router.options('/logs/stream', (req: Request, res: Response) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
  res.status(204).end();
});

// SSE endpoint for real-time log updates
// Note: EventSource doesn't support custom headers, so we accept token as query param
router.get('/logs/stream', async (req: Request, res: Response) => {
  console.log('=== SSE CONNECTION ATTEMPT ===');
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Path:', req.path);
  console.log('Origin:', req.headers.origin);
  console.log('User-Agent:', req.headers['user-agent']);
  console.log('Query params:', Object.keys(req.query));
  console.log('Has token in query:', !!req.query.token);
  
  // Get token from query parameter (EventSource limitation)
  const token = req.query.token as string;
  
  if (!token) {
    console.error('SSE connection rejected: No token provided');
    return res.status(401).json({ error: 'Token required' });
  }
  
  // Verify token manually
  const payload = verifyToken(token);
  
  if (!payload) {
    console.error('SSE connection rejected: Invalid token');
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  console.log('SSE connection accepted for user:', payload.email);
  
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  
  // CORS headers for SSE (must be set before any writes)
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
  
  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Stream connected', timestamp: new Date().toISOString() })}\n\n`);
  
  let lastCheck = new Date(Date.now() - 60000); // Start from 1 minute ago
  let heartbeatCount = 0;
  
  const checkInterval = setInterval(async () => {
    try {
      // Get new logs since last check
      const newLogs = await pool.query(
        `WITH status_changes AS (
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
          WHERE sh.timestamp > $1
        )
        SELECT * FROM status_changes
        ORDER BY changed_at DESC
        LIMIT 50`,
        [lastCheck]
      );
      
      if (newLogs.rows.length > 0) {
        // Send new logs to client
        res.write(`data: ${JSON.stringify({ 
          type: 'logs', 
          logs: newLogs.rows,
          timestamp: new Date().toISOString()
        })}\n\n`);
        
        // Update last check time to the most recent log
        lastCheck = newLogs.rows[0].changed_at;
      }
      
      // Send heartbeat every 30 seconds (every 15 intervals at 2s each)
      heartbeatCount++;
      if (heartbeatCount >= 15) {
        res.write(`data: ${JSON.stringify({ 
          type: 'heartbeat', 
          timestamp: new Date().toISOString() 
        })}\n\n`);
        heartbeatCount = 0;
      }
    } catch (error) {
      console.error('Error in SSE stream:', error);
      res.write(`data: ${JSON.stringify({ 
        type: 'error', 
        message: 'Stream error',
        error: error instanceof Error ? error.message : 'Unknown error'
      })}\n\n`);
    }
  }, 2000); // Check every 2 seconds
  
  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(checkInterval);
    console.log('SSE client disconnected for user:', payload.email);
    res.end();
  });
  
  // Also handle errors
  req.on('error', (error) => {
    console.error('SSE request error:', error);
    clearInterval(checkInterval);
    res.end();
  });
  
  // Handle response errors
  res.on('error', (error) => {
    console.error('SSE response error:', error);
    clearInterval(checkInterval);
  });
});

export default router;

