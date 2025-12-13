import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { pool } from './db/connection';
import authRoutes from './routes/auth';
import trackingRoutes from './routes/tracking';
import analyticsRoutes from './routes/analytics';
import { startScheduler } from './services/scheduler';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/analytics', analyticsRoutes);

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startScheduler();
});

