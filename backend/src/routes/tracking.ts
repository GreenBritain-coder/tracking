import express from 'express';
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
import { getStatusHistory } from '../models/statusHistory';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Boxes endpoints
router.get('/boxes', async (req, res) => {
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
  async (req, res) => {
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

router.delete('/boxes/:id', async (req, res) => {
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
router.get('/numbers', async (req, res) => {
  try {
    const boxId = req.query.boxId ? parseInt(req.query.boxId as string) : undefined;
    const trackingNumbers = boxId
      ? await getTrackingNumbersByBox(boxId)
      : await getAllTrackingNumbers();
    res.json(trackingNumbers);
  } catch (error) {
    console.error('Error fetching tracking numbers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/numbers/:id', async (req, res) => {
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
  async (req: AuthRequest, res) => {
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
  async (req: AuthRequest, res) => {
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

router.delete('/numbers/:id', async (req, res) => {
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

export default router;

