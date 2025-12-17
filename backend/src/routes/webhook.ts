import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { getTrackingNumberByTrackingNumber, updateTrackingStatus } from '../models/tracking';
import { TrackingStatus } from '../models/tracking';

const router = express.Router();

// Webhook secret from environment variable
const WEBHOOK_SECRET = process.env.TRACKINGMORE_WEBHOOK_SECRET || '';

/**
 * Verify webhook signature using SHA256
 * TrackingMore sends signature in X-Signature header
 */
function verifyWebhookSignature(body: string, signature: string): boolean {
  if (!WEBHOOK_SECRET) {
    console.warn('WEBHOOK_SECRET not configured, skipping signature verification');
    return true; // Allow if secret not configured (for development)
  }

  if (!signature) {
    console.warn('No signature provided in webhook request');
    return false;
  }

  // Calculate expected signature
  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(body)
    .digest('hex');

  // Remove any prefix from signature (e.g., "sha256=" or "sha256:")
  const cleanSignature = signature.replace(/^(sha256[=:]|)/i, '').trim();
  const cleanExpected = expectedSignature.trim();

  console.log('Signature verification details:');
  console.log('  Received signature length:', cleanSignature.length);
  console.log('  Expected signature length:', cleanExpected.length);
  console.log('  Received signature (first 20 chars):', cleanSignature.substring(0, 20));
  console.log('  Expected signature (first 20 chars):', cleanExpected.substring(0, 20));

  // If lengths don't match, signatures can't be equal
  if (cleanSignature.length !== cleanExpected.length) {
    console.error('Signature length mismatch - verification failed');
    return false;
  }

  // Compare signatures (use timing-safe comparison)
  try {
    const result = crypto.timingSafeEqual(
      Buffer.from(cleanSignature, 'hex'),
      Buffer.from(cleanExpected, 'hex')
    );
    return result;
  } catch (error) {
    console.error('Error during signature comparison:', error);
    // Fallback to simple string comparison if hex parsing fails
    return cleanSignature.toLowerCase() === cleanExpected.toLowerCase();
  }
}

/**
 * Map TrackingMore delivery_status to our TrackingStatus enum
 */
function mapDeliveryStatus(deliveryStatus: string | null | undefined): TrackingStatus {
  if (!deliveryStatus) {
    return 'not_scanned';
  }

  const statusLower = deliveryStatus.toLowerCase();

  if (statusLower === 'delivered' || statusLower.includes('delivered')) {
    return 'delivered';
  } else if (
    statusLower === 'transit' ||
    statusLower === 'pickup' ||
    statusLower === 'inforeceived' ||
    statusLower.includes('transit') ||
    statusLower.includes('pickup')
  ) {
    return 'scanned';
  } else {
    return 'not_scanned';
  }
}

/**
 * Extract status header from webhook payload
 */
function extractStatusHeader(webhookData: any): string | undefined {
  // Try multiple possible fields for status description
  return (
    webhookData.latest_event ||
    webhookData.delivery_status ||
    webhookData.substatus ||
    webhookData.status_info ||
    undefined
  );
}

/**
 * Root test endpoint - verify webhook router is accessible
 */
router.get('/', (req: Request, res: Response) => {
  console.log('Webhook root endpoint accessed');
  res.json({ 
    message: 'Webhook router is accessible',
    endpoints: ['GET /trackingmore/test', 'POST /trackingmore']
  });
});

/**
 * Test endpoint to verify webhook route is accessible
 * This should return JSON, not a blank page
 * Must be defined BEFORE the catch-all route
 */
router.get('/trackingmore/test', (req: Request, res: Response) => {
  console.log('=== TEST ENDPOINT ACCESSED ===');
  console.log('Method:', req.method);
  console.log('Path:', req.path);
  console.log('URL:', req.url);
  console.log('Original URL:', req.originalUrl);
  
  try {
    res.setHeader('Content-Type', 'application/json');
    const response = { 
      message: 'Webhook endpoint is accessible', 
      timestamp: new Date().toISOString(),
      webhookSecretConfigured: !!WEBHOOK_SECRET,
      path: '/api/webhook/trackingmore/test',
      method: req.method,
      routerPath: req.path,
      originalUrl: req.originalUrl
    };
    console.log('Sending response:', response);
    res.json(response);
  } catch (error) {
    console.error('Error in test endpoint:', error);
    res.status(500).json({ error: 'Internal server error', details: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * TrackingMore webhook endpoint
 * Receives POST requests from TrackingMore when tracking status changes
 * Must be defined BEFORE the catch-all route
 */
router.post('/trackingmore', async (req: any, res: Response) => {
  // Enhanced logging - log ALL incoming requests
  console.log('=== WEBHOOK REQUEST RECEIVED ===');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Has body:', !!req.body);
  console.log('Body type:', typeof req.body);
  
  try {
    // Get raw body for signature verification
    // Use rawBody if available (from middleware), otherwise stringify the parsed body
    const rawBody = req.rawBody || (req.body ? JSON.stringify(req.body) : '');
    console.log('Raw body length:', rawBody.length);
    console.log('Raw body preview:', rawBody.substring(0, 200));
    console.log('Has rawBody from middleware:', !!req.rawBody);
    
    // Get signature from header
    // TrackingMore may send signature in different header formats
    const signature = req.headers['x-signature'] as string || 
                     req.headers['x-trackingmore-signature'] as string ||
                     req.headers['signature'] as string ||
                     req.headers['x-hub-signature-256'] as string;
    
    console.log('All signature-related headers:');
    console.log('  x-signature:', req.headers['x-signature']);
    console.log('  x-trackingmore-signature:', req.headers['x-trackingmore-signature']);
    console.log('  signature:', req.headers['signature']);
    console.log('  x-hub-signature-256:', req.headers['x-hub-signature-256']);
    console.log('Signature header present:', !!signature);
    console.log('Webhook secret configured:', !!WEBHOOK_SECRET);
    console.log('Webhook secret length:', WEBHOOK_SECRET.length);

    // Verify webhook signature (if secret is configured)
    if (WEBHOOK_SECRET) {
      if (!signature) {
        console.error('Webhook signature verification failed: No signature header found');
        return res.status(401).json({ error: 'Missing signature header' });
      }
      
      const isValid = verifyWebhookSignature(rawBody, signature);
      if (!isValid) {
        console.error('Webhook signature verification failed');
        console.error('Expected signature format: SHA256 HMAC of raw body');
        console.error('Make sure TRACKINGMORE_WEBHOOK_SECRET matches the secret configured in TrackingMore');
        return res.status(401).json({ error: 'Invalid signature' });
      } else {
        console.log('Webhook signature verified successfully');
      }
    } else {
      console.warn('Webhook secret not configured - skipping signature verification (development mode)');
    }

    // Use parsed body (from express.json middleware) or parse raw body
    const webhookData = req.body || JSON.parse(rawBody);

    // Log webhook received
    console.log('=== WEBHOOK PAYLOAD ===');
    console.log('Webhook received from TrackingMore:', JSON.stringify(webhookData, null, 2).substring(0, 1000));

    // Extract tracking information from webhook payload
    // TrackingMore webhook structure: { code, message, data: { tracking_number, delivery_status, ... } }
    const trackingData = webhookData.data || webhookData;
    
    if (!trackingData.tracking_number) {
      console.error('Webhook payload missing tracking_number');
      return res.status(400).json({ error: 'Missing tracking_number in payload' });
    }

    const trackingNumber = trackingData.tracking_number;
    const deliveryStatus = trackingData.delivery_status;
    const statusHeader = extractStatusHeader(trackingData);

    console.log(`[${trackingNumber}] Webhook update: delivery_status=${deliveryStatus}, statusHeader=${statusHeader}`);

    // Find tracking in database
    const tracking = await getTrackingNumberByTrackingNumber(trackingNumber);
    
    if (!tracking) {
      console.log(`[${trackingNumber}] Webhook received for unknown tracking number, ignoring`);
      // Return 200 to acknowledge receipt (don't want TrackingMore to retry)
      return res.status(200).json({ message: 'Tracking number not found in database, ignored' });
    }

    // Skip if status was manually set
    if (tracking.is_manual_status) {
      console.log(`[${trackingNumber}] Webhook received but status is manually set, skipping automatic update`);
      return res.status(200).json({ 
        message: 'Status is manually set, skipping automatic update',
        tracking_number: trackingNumber
      });
    }

    // Map delivery_status to our TrackingStatus enum
    const mappedStatus = mapDeliveryStatus(deliveryStatus);

    // Only update if status changed or statusHeader is different
    if (mappedStatus !== tracking.current_status || statusHeader !== tracking.status_details) {
      await updateTrackingStatus(tracking.id, mappedStatus, statusHeader, undefined, false, deliveryStatus);
      console.log(
        `[${trackingNumber}] Webhook updated: ${tracking.current_status} -> ${mappedStatus}`,
        statusHeader ? `Header: ${statusHeader}` : ''
      );
    } else {
      console.log(`[${trackingNumber}] Webhook received but no changes detected`);
    }

    // Return 200 to acknowledge receipt
    res.status(200).json({ 
      message: 'Webhook processed successfully',
      tracking_number: trackingNumber,
      status: mappedStatus
    });

  } catch (error) {
    console.error('Error processing webhook:', error);
    // Still return 200 to prevent TrackingMore from retrying
    // (we'll log the error for debugging)
    res.status(200).json({ error: 'Internal error processing webhook' });
  }
});

// Catch-all for webhook routes to help debug
// Must be LAST so it doesn't interfere with specific routes
router.all('/trackingmore/*', (req: Request, res: Response) => {
  console.log(`Unhandled webhook route: ${req.method} ${req.path}`);
  res.status(404).json({ 
    error: 'Webhook route not found',
    method: req.method,
    path: req.path,
    availableRoutes: ['GET /trackingmore/test', 'POST /trackingmore']
  });
});

export default router;

