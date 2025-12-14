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

  // Compare signatures (use timing-safe comparison)
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
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
 * Test endpoint to verify webhook route is accessible
 */
router.get('/trackingmore/test', (req: Request, res: Response) => {
  res.json({ 
    message: 'Webhook endpoint is accessible', 
    timestamp: new Date().toISOString(),
    webhookSecretConfigured: !!WEBHOOK_SECRET
  });
});

/**
 * TrackingMore webhook endpoint
 * Receives POST requests from TrackingMore when tracking status changes
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
    const rawBody = req.rawBody || JSON.stringify(req.body);
    console.log('Raw body length:', rawBody.length);
    console.log('Raw body preview:', rawBody.substring(0, 200));
    
    // Get signature from header
    // TrackingMore may send signature in different header formats
    const signature = req.headers['x-signature'] as string || 
                     req.headers['x-trackingmore-signature'] as string ||
                     req.headers['signature'] as string;
    console.log('Signature header present:', !!signature);
    console.log('Webhook secret configured:', !!WEBHOOK_SECRET);

    // Verify webhook signature (if secret is configured)
    if (WEBHOOK_SECRET && !verifyWebhookSignature(rawBody, signature)) {
      console.error('Webhook signature verification failed');
      console.error('Expected signature format: SHA256 HMAC of raw body');
      return res.status(401).json({ error: 'Invalid signature' });
    } else if (WEBHOOK_SECRET) {
      console.log('Webhook signature verified successfully');
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

    // Map delivery_status to our TrackingStatus enum
    const mappedStatus = mapDeliveryStatus(deliveryStatus);

    // Only update if status changed or statusHeader is different
    if (mappedStatus !== tracking.current_status || statusHeader !== tracking.status_details) {
      await updateTrackingStatus(tracking.id, mappedStatus, statusHeader);
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

export default router;

