import cron from 'node-cron';
import { getAllTrackingNumbers, updateTrackingStatus } from '../models/tracking';
import { checkRoyalMailStatus } from './scraper';

let isRunning = false;

export async function updateAllTrackingStatuses() {
  if (isRunning) {
    console.log('Update job already running, skipping...');
    return;
  }
  
  isRunning = true;
  console.log('Starting scheduled tracking update...');
  
  try {
    const allTrackingNumbers = await getAllTrackingNumbers();
    
    // Filter out tracking numbers that are already marked as "delivered"
    const trackingNumbers = allTrackingNumbers.filter(tn => tn.current_status !== 'delivered');
    const skippedCount = allTrackingNumbers.length - trackingNumbers.length;
    
    if (skippedCount > 0) {
      console.log(`Skipping ${skippedCount} tracking number(s) already marked as delivered`);
    }
    console.log(`Checking ${trackingNumbers.length} tracking number(s)...`);
    
    let updated = 0;
    let errors = 0;
    
    // If no tracking numbers to check, exit early
    if (trackingNumbers.length === 0) {
      console.log('No tracking numbers to check (all are delivered or none exist)');
      isRunning = false;
      return;
    }
    
    // Process sequentially to avoid rate limiting (API limit is 10 requests/second)
    // Add delay before each request to stay well under the limit
    for (const tn of trackingNumbers) {
      try {
        // Delay before each request to avoid rate limiting (500ms = max 2 requests/second, well under 10/sec limit)
        await new Promise((resolve) => setTimeout(resolve, 500));
        
        const result = await checkRoyalMailStatus(tn.tracking_number);
        
        // Only update if status changed or statusHeader changed
        if (result.status !== tn.current_status) {
          // Store the statusHeader (like "We've got it") in the status_details field
          await updateTrackingStatus(tn.id, result.status, result.statusHeader);
          updated++;
          console.log(
            `Updated ${tn.tracking_number}: ${tn.current_status} -> ${result.status}`,
            result.statusHeader ? `Header: ${result.statusHeader}` : ''
          );
        }
      } catch (error) {
        errors++;
        console.error(`Error updating ${tn.tracking_number}:`, error);
        
        // If rate limited, wait longer before continuing
        if (error instanceof Error && error.message.includes('429')) {
          console.log('Rate limit detected, waiting 10 seconds before continuing...');
          await new Promise((resolve) => setTimeout(resolve, 10000));
        }
      }
    }
    
    console.log(
      `Update complete. Updated: ${updated}, Errors: ${errors}, Checked: ${trackingNumbers.length}, Skipped (delivered): ${skippedCount}, Total: ${allTrackingNumbers.length}`
    );
  } catch (error) {
    console.error('Error in scheduled update:', error);
  } finally {
    isRunning = false;
  }
}

export function startScheduler() {
  // Run every 5 minutes
  cron.schedule('*/5 * * * *', () => {
    updateAllTrackingStatuses();
  });
  
  // Also run immediately on startup (optional, can be removed if desired)
  console.log('Scheduler started. Will run every 5 minutes.');
  // Uncomment to run on startup:
  // updateAllTrackingStatuses();
}

