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
    // Get all tracking numbers (use large limit to get all)
    const allTrackingNumbersResponse = await getAllTrackingNumbers(1, 10000);
    const trackingNumbers = allTrackingNumbersResponse.data;
    
    console.log(`Checking ${trackingNumbers.length} tracking number(s)...`);
    
    let updated = 0;
    let errors = 0;
    
    // If no tracking numbers to check, exit early
    if (trackingNumbers.length === 0) {
      console.log('No tracking numbers to check');
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
        
        // Update if status changed OR if status_details is missing/empty but we have a statusHeader
        const statusChanged = result.status !== tn.current_status;
        const needsStatusDetails = (!tn.status_details || tn.status_details === '-') && result.statusHeader;
        const statusDetailsChanged = result.statusHeader && result.statusHeader !== tn.status_details;
        
        if (statusChanged || needsStatusDetails || statusDetailsChanged) {
          // Store the statusHeader (like "We've got it") in the status_details field
          await updateTrackingStatus(tn.id, result.status, result.statusHeader);
          updated++;
          if (statusChanged) {
            console.log(
              `Updated ${tn.tracking_number}: ${tn.current_status} -> ${result.status}`,
              result.statusHeader ? `Header: ${result.statusHeader}` : ''
            );
          } else {
            console.log(
              `Updated status_details for ${tn.tracking_number}: ${tn.status_details || '(empty)'} -> ${result.statusHeader || '(empty)'}`
            );
          }
        }
      } catch (error) {
        errors++;
        console.error(`Error updating ${tn.tracking_number}:`, error);
        
        // If rate limited, wait longer before continuing
        // Per TrackingMore docs: wait 120 seconds after 429 error
        if (error instanceof Error && error.message.includes('429')) {
          console.log('Rate limit detected (429), waiting 120 seconds before continuing (per API docs)...');
          await new Promise((resolve) => setTimeout(resolve, 120000));
        }
      }
    }
    
    console.log(
      `Update complete. Updated: ${updated}, Errors: ${errors}, Checked: ${trackingNumbers.length}, Total: ${allTrackingNumbersResponse.data.length}`
    );
  } catch (error) {
    console.error('Error in scheduled update:', error);
  } finally {
    isRunning = false;
  }
}

export function startScheduler() {
  // Run every 4 hours (at the top of every 4th hour: 0:00, 4:00, 8:00, 12:00, 16:00, 20:00)
  cron.schedule('0 */4 * * *', () => {
    updateAllTrackingStatuses();
  });
  
  // Also run immediately on startup to get initial status
  console.log('Scheduler started. Will run every 4 hours.');
  // Run on startup to get initial status
  updateAllTrackingStatuses();
}

