import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { pool } from './db/connection';
import authRoutes from './routes/auth';
import trackingRoutes from './routes/tracking';
import analyticsRoutes from './routes/analytics';
import webhookRoutes from './routes/webhook';
import { startScheduler } from './services/scheduler';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());

// Webhook routes need raw body for signature verification
// Register webhook route middleware BEFORE general JSON middleware
app.use('/api/webhook', express.text({ 
  type: 'application/json',
  verify: (req: any, res, buf) => {
    // Store raw body as string for signature verification
    req.rawBody = buf.toString('utf8');
  }
}));

// Parse JSON for webhook routes after capturing raw body
app.use('/api/webhook', (req: any, res, next) => {
  if (req.rawBody) {
    try {
      req.body = JSON.parse(req.rawBody);
    } catch (e) {
      console.warn('Failed to parse webhook body as JSON:', e);
    }
  }
  next();
});

// JSON middleware for other routes
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
// Webhook routes (no authentication required - uses signature verification)
app.use('/api/webhook', webhookRoutes);

// Debug middleware - log all requests to help diagnose routing issues
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${req.url}`);
  next();
});

// 404 handler - return JSON instead of blank page
app.use((req, res) => {
  console.log(`[404] ${req.method} ${req.path} ${req.url} - Route not found`);
  res.status(404).json({ 
    error: 'Route not found',
    method: req.method,
    path: req.path,
    url: req.url,
    availableRoutes: [
      '/health',
      '/api/auth/*',
      '/api/tracking/*',
      '/api/analytics/*',
      '/api/webhook/',
      '/api/webhook/trackingmore/test',
      '/api/webhook/trackingmore'
    ]
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Registered routes:');
  console.log('  - GET /health');
  console.log('  - /api/auth/*');
  console.log('  - /api/tracking/*');
  console.log('  - /api/analytics/*');
  console.log('  - GET /api/webhook/');
  console.log('  - GET /api/webhook/trackingmore/test');
  console.log('  - POST /api/webhook/trackingmore');
  startScheduler();
});

