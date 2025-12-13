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
    const trackingNumbers = await getAllTrackingNumbers();
    console.log(`Checking ${trackingNumbers.length} tracking numbers...`);
    
    let updated = 0;
    let errors = 0;
    
    // Process in batches to avoid overwhelming the scraper
    const batchSize = 5;
    for (let i = 0; i < trackingNumbers.length; i += batchSize) {
      const batch = trackingNumbers.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(async (tn) => {
          try {
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
            
            // Add small delay between requests to avoid rate limiting
            await new Promise((resolve) => setTimeout(resolve, 1000));
          } catch (error) {
            errors++;
            console.error(`Error updating ${tn.tracking_number}:`, error);
          }
        })
      );
      
      // Longer delay between batches
      if (i + batchSize < trackingNumbers.length) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    
    console.log(
      `Update complete. Updated: ${updated}, Errors: ${errors}, Total: ${trackingNumbers.length}`
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

