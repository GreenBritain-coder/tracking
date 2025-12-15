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
} from '../models/tracking';
import { createBox, getAllBoxes, getBoxById, deleteBox } from '../models/box';
import { 
  getAllPostboxes, 
  createPostbox, 
  updatePostbox, 
  deletePostbox,
  getPostboxById 
} from '../models/postbox';
import { getStatusHistory } from '../models/statusHistory';
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
    
    const result = boxId
      ? await getTrackingNumbersByBox(boxId, page, limit)
      : await getAllTrackingNumbers(page, limit);
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
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { tracking_numbers, box_id } = req.body;
      
      // Validate box exists if provided
      if (box_id) {
        const box = await getBoxById(box_id);
        if (!box) {
          return res.status(404).json({ error: 'Box not found' });
        }
      }
      
      const created = await bulkCreateTrackingNumbers(tracking_numbers, box_id || null);
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

// Manual refresh endpoint for a single tracking number
router.post('/numbers/:id/refresh', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const tracking = await getTrackingNumberById(id);
    
    if (!tracking) {
      return res.status(404).json({ error: 'Tracking number not found' });
    }

    console.log(`Manual refresh requested for ${tracking.tracking_number}`);
    
    const result = await checkRoyalMailStatus(tracking.tracking_number);
    
    // Update status if changed
    if (result.status !== tracking.current_status || result.statusHeader !== tracking.status_details) {
      await updateTrackingStatus(tracking.id, result.status, result.statusHeader);
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
    body('postbox_id')
      .optional({ nullable: true, checkFalsy: true })
      .custom((value) => {
        // If value is null, undefined, or empty string, it's valid
        if (value === null || value === undefined || value === '') {
          return true;
        }
        // Otherwise, it must be a valid integer
        const num = typeof value === 'string' ? parseInt(value, 10) : Number(value);
        if (isNaN(num) || !Number.isInteger(num)) {
          throw new Error('postbox_id must be a valid integer or null');
        }
        return true;
      }),
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
      const { status, postbox_id, custom_timestamp } = req.body;
      
      console.log(`Updating tracking ${id}: status=${status}, postbox_id=${postbox_id} (type: ${typeof postbox_id}), custom_timestamp=${custom_timestamp}`);
      
      const tracking = await getTrackingNumberById(Number(id));
      if (!tracking) {
        return res.status(404).json({ error: 'Tracking number not found' });
      }

      // Validate postbox_id if provided (and not null/empty)
      if (postbox_id !== undefined && postbox_id !== null && postbox_id !== '') {
        const postboxIdNum = typeof postbox_id === 'string' ? parseInt(postbox_id) : postbox_id;
        if (!isNaN(postboxIdNum)) {
          const postbox = await getPostboxById(postboxIdNum);
          if (!postbox) {
            return res.status(400).json({ error: 'Postbox not found' });
          }
        }
      }

      // Normalize postbox_id: convert empty string to null, ensure it's a number or null
      let normalizedPostboxId: number | null = null;
      if (postbox_id !== undefined && postbox_id !== null && postbox_id !== '') {
        const postboxIdNum = typeof postbox_id === 'string' ? parseInt(postbox_id) : postbox_id;
        if (!isNaN(postboxIdNum)) {
          normalizedPostboxId = postboxIdNum;
        }
      }

      await updateTrackingStatus(
        Number(id), 
        status, 
        undefined, 
        normalizedPostboxId,
        custom_timestamp || null
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

// Postboxes endpoints
router.get('/postboxes', async (req: AuthRequest, res: Response) => {
  try {
    const postboxes = await getAllPostboxes();
    res.json(postboxes);
  } catch (error) {
    console.error('Error fetching postboxes:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post(
  '/postboxes',
  [body('name').notEmpty().trim()],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { name } = req.body;
      const postbox = await createPostbox(name);
      res.status(201).json(postbox);
    } catch (error) {
      console.error('Error creating postbox:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.patch(
  '/postboxes/:id',
  [body('name').notEmpty().trim()],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const { name } = req.body;
      const postbox = await updatePostbox(Number(id), name);
      if (!postbox) {
        return res.status(404).json({ error: 'Postbox not found' });
      }
      res.json(postbox);
    } catch (error) {
      console.error('Error updating postbox:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.delete('/postboxes/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = await deletePostbox(Number(id));
    if (!deleted) {
      return res.status(404).json({ error: 'Postbox not found' });
    }
    res.json({ message: 'Postbox deleted successfully' });
  } catch (error) {
    console.error('Error deleting postbox:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

