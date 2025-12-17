import express, { Response } from 'express';
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
import { createBox, getAllBoxes, getBoxById, updateBox, deleteBox } from '../models/box';
import { getStatusHistory, getRecentStatusChanges } from '../models/statusHistory';
import { updateAllTrackingStatuses } from '../services/scheduler';
import { checkRoyalMailStatus } from '../services/scraper';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Boxes endpoints
router.get('/boxes', async (req: AuthRequest, res: Response) => {
  try {
    const boxes = await getAllBoxes();
    res.json(boxes);
  } catch (error) {
    console.error('Error fetching boxes:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post(
  '/boxes',
  [body('name').notEmpty().trim()],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { name } = req.body;
      const box = await createBox(name);
      res.status(201).json(box);
    } catch (error) {
      console.error('Error creating box:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.patch(
  '/boxes/:id',
  [body('name').notEmpty().trim()],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const { name } = req.body;
      const box = await updateBox(Number(id), name);
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
    
    // Validate status if provided
    if (status && !['not_scanned', 'scanned', 'delivered'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status filter' });
    }
    
    // Validate customTimestamp format if provided (should be YYYY-MM-DD)
    if (customTimestamp && !/^\d{4}-\d{2}-\d{2}$/.test(customTimestamp)) {
      return res.status(400).json({ error: 'Invalid customTimestamp format. Expected YYYY-MM-DD' });
    }
    
    const result = boxId
      ? await getTrackingNumbersByBox(boxId, page, limit, status, customTimestamp)
      : await getAllTrackingNumbers(page, limit, status, customTimestamp);
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
    const logs = await getRecentStatusChanges(Math.min(limit, 200)); // Max 200 entries
    res.json(logs);
  } catch (error) {
    console.error('Error fetching status change logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

