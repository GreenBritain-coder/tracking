import axios from 'axios';
import { TrackingStatus } from '../models/tracking';

const TRACKINGMORE_API_KEY = process.env.TRACKINGMORE_API_KEY || '';
const TRACKINGMORE_API_BASE = 'https://api.trackingmore.com/v4';

/**
 * Parse TrackingMore API response
 */
function parseTrackingMoreResponse(data: any, trackingNumber: string): {
  status: TrackingStatus;
  details?: string;
  statusHeader?: string;
} {
  try {
    // Log the full response structure for debugging
    console.log(`[${trackingNumber}] Parsing TrackingMore response:`, JSON.stringify(data, null, 2).substring(0, 1000));
    
    // TrackingMore API response structure - try multiple possible formats
    const trackingData = data?.data || data?.item || data;
    
    // Try different status field names
    const statusText = trackingData?.status || 
                      trackingData?.latest_status || 
                      trackingData?.lastEvent || 
                      trackingData?.last_event ||
                      trackingData?.tracking_status ||
                      '';
    const statusLower = statusText.toLowerCase();
    
    // Extract status header/description
    const statusHeader = trackingData?.latest_status || 
                        trackingData?.status || 
                        trackingData?.lastEvent ||
                        trackingData?.last_event ||
                        trackingData?.sub_status ||
                        statusText;
    
    // Extract details from tracking events - try multiple possible paths
    const events = trackingData?.origin_info?.trackinfo || 
                   trackingData?.tracking_info || 
                   trackingData?.trackinfo ||
                   trackingData?.events ||
                   trackingData?.origin_info?.tracking_info ||
                   [];
    
    const details = events.length > 0 
      ? JSON.stringify(events.map((e: any) => ({
          date: e.date || e.track_date || e.time,
          status: e.status || e.track_status || e.event,
          details: e.details || e.track_location || e.location
        }))).substring(0, 500)
      : JSON.stringify(trackingData).substring(0, 500);
    
    // Check if tracking exists but has no status yet (pending)
    if (!statusText && !events.length && trackingData) {
      // If we have tracking data but no status/events, it might be pending
      console.log(`[${trackingNumber}] TrackingMore: Has tracking data but no status yet, checking for pending state`);
      if (trackingData.tracking_number || trackingData.courier_code) {
        // Tracking was created but not yet scanned by courier
        return {
          status: 'not_scanned',
          details,
          statusHeader: 'Pending',
        };
      }
    }
    
    // Map TrackingMore status to our TrackingStatus enum
    if (statusLower.includes('delivered') || 
        statusLower.includes('delivery completed') ||
        statusLower.includes('delivered to recipient')) {
      console.log(`[${trackingNumber}] TrackingMore: Detected DELIVERED status`);
      return {
        status: 'delivered',
        details,
        statusHeader: statusHeader || 'Delivered',
      };
    } else if (statusLower.includes('in transit') || 
               statusLower.includes('on its way') ||
               statusLower.includes('collected') ||
               statusLower.includes('accepted') ||
               statusLower.includes('processed') ||
               statusLower.includes('scanned') ||
               statusLower.includes('we\'ve got it') ||
               statusLower.includes('arrived') ||
               statusLower.includes('departed') ||
               statusLower.includes('out for delivery')) {
      console.log(`[${trackingNumber}] TrackingMore: Detected SCANNED status`);
      return {
        status: 'scanned',
        details,
        statusHeader: statusHeader || 'In Transit',
      };
    } else if (statusLower.includes('not found') ||
               statusLower.includes('no information') ||
               statusLower.includes('pending')) {
      console.log(`[${trackingNumber}] TrackingMore: Detected NOT_SCANNED status`);
      return {
        status: 'not_scanned',
        details,
        statusHeader: statusHeader || 'Not Scanned',
      };
    } else {
      // Default: if we have any tracking info, consider it scanned
      if (events.length > 0) {
        console.log(`[${trackingNumber}] TrackingMore: Has tracking events, defaulting to SCANNED`);
        return {
          status: 'scanned',
          details,
          statusHeader: statusHeader || 'In Transit',
        };
      } else {
        console.log(`[${trackingNumber}] TrackingMore: No tracking info, defaulting to NOT_SCANNED`);
        return {
          status: 'not_scanned',
          details,
          statusHeader: statusHeader || 'Not Scanned',
        };
      }
    }
  } catch (error) {
    console.error(`[${trackingNumber}] Error parsing TrackingMore response:`, error);
    return {
      status: 'not_scanned',
      details: 'Error parsing TrackingMore response',
    };
  }
}

export async function checkRoyalMailStatus(trackingNumber: string): Promise<{
  status: TrackingStatus;
  details?: string;
  statusHeader?: string;
}> {
  try {
    // Use TrackingMore API
    if (!TRACKINGMORE_API_KEY) {
      console.error('TrackingMore API key not configured');
      return { 
        status: 'not_scanned', 
        details: 'TrackingMore API key not configured' 
      };
    }

    console.log(`[${trackingNumber}] Fetching via TrackingMore API...`);
    
    // Clean tracking number (remove spaces)
    const cleanTrackingNumber = trackingNumber.replace(/\s+/g, '');
    
    try {
      // Step 1: Create tracking in TrackingMore (if not already exists)
      // Try different courier codes for Royal Mail
      const courierCodes = ['royalmail', 'royal-mail'];
      let courierCode = courierCodes[0];
      let trackingCreated = false;
      
      for (const code of courierCodes) {
        try {
          console.log(`[${trackingNumber}] Creating tracking in TrackingMore with courier code: ${code}...`);
          const requestBody = {
            tracking_number: cleanTrackingNumber,
            courier_code: code,
          };
          
          const createResponse = await axios.post(
            `${TRACKINGMORE_API_BASE}/trackings`,
            requestBody,
            {
              headers: {
                'Content-Type': 'application/json',
                'Tracking-Api-Key': TRACKINGMORE_API_KEY,
              },
              timeout: 30000,
            }
          );
          console.log(`[${trackingNumber}] Tracking created/updated in TrackingMore with courier code: ${code}`);
          
          // Check if POST response contains actual tracking data (not just empty array)
          if (createResponse.data?.data) {
            if (Array.isArray(createResponse.data.data) && createResponse.data.data.length > 0) {
              // Array with items - has tracking data
              console.log(`[${trackingNumber}] POST response contains tracking data array, using it directly`);
              return parseTrackingMoreResponse(createResponse.data, trackingNumber);
            } else if (!Array.isArray(createResponse.data.data) && Object.keys(createResponse.data.data).length > 0) {
              // Object with properties - has tracking data
              console.log(`[${trackingNumber}] POST response contains tracking data object, using it directly`);
              return parseTrackingMoreResponse(createResponse.data, trackingNumber);
            } else {
              // Empty array or empty object - tracking created but not scanned yet
              console.log(`[${trackingNumber}] POST response is empty - tracking created but not yet scanned`);
            }
          } else {
            // No data field - tracking created but not scanned yet
            console.log(`[${trackingNumber}] POST response has no data - tracking created but not yet scanned`);
          }
          
          courierCode = code;
          trackingCreated = true;
          break;
        } catch (createError) {
          // If tracking already exists (409), check if response has data we can use
          if (axios.isAxiosError(createError) && createError.response?.status === 409) {
            console.log(`[${trackingNumber}] Tracking already exists in TrackingMore with courier code: ${code}`);
            // Check if 409 response includes tracking data
            const errorData = createError.response.data;
            if (errorData?.data) {
              if ((Array.isArray(errorData.data) && errorData.data.length > 0) ||
                  (!Array.isArray(errorData.data) && Object.keys(errorData.data).length > 0)) {
                console.log(`[${trackingNumber}] 409 response contains tracking data, using it`);
                return parseTrackingMoreResponse(errorData, trackingNumber);
              }
            }
            courierCode = code;
            trackingCreated = true;
            break;
          } else if (axios.isAxiosError(createError) && createError.response) {
            const errorData = createError.response.data;
            console.warn(`[${trackingNumber}] Failed to create tracking with courier code ${code}:`, 
              `${createError.response.status} ${createError.response.statusText}`,
              JSON.stringify(errorData));
            // If it's a 404 or invalid courier code, try next one
            if (createError.response.status === 404 || 
                (errorData?.meta?.code === 4130 && errorData?.meta?.message?.includes('courier'))) {
              continue; // Try next courier code
            }
          }
        }
      }
      
      // If POST response was empty, the tracking hasn't been scanned yet
      // No need to make GET request - just return not_scanned
      if (!trackingCreated) {
        console.warn(`[${trackingNumber}] Could not create tracking with any courier code`);
        return {
          status: 'not_scanned',
          details: 'Tracking not found in TrackingMore',
        };
      }
      
      // If we reach here, POST was successful but returned empty data
      // This means tracking was created but not yet scanned by Royal Mail
      console.log(`[${trackingNumber}] Tracking created in TrackingMore but not yet scanned - returning not_scanned`);
      return {
        status: 'not_scanned',
        details: 'Tracking created but not yet scanned by Royal Mail',
      };
    } catch (trackingMoreError) {
      console.error(`[${trackingNumber}] TrackingMore API error:`, 
        axios.isAxiosError(trackingMoreError) 
          ? `${trackingMoreError.response?.status} ${trackingMoreError.response?.statusText}: ${JSON.stringify(trackingMoreError.response?.data)}`
          : 'Unknown error');
      
      // Return not_scanned if TrackingMore fails
      return {
        status: 'not_scanned',
        details: `TrackingMore API error: ${axios.isAxiosError(trackingMoreError) ? trackingMoreError.message : 'Unknown error'}`,
      };
    }
    
    // If we reach here, both methods failed
    return {
      status: 'not_scanned',
      details: 'Unable to fetch tracking information',
    };
    
  } catch (error) {
    console.error(`Error checking status for ${trackingNumber}:`, error);
    if (axios.isAxiosError(error)) {
      if (error.response) {
        // Server responded with error status
        console.error(`TrackingMore API error: ${error.response.status} ${error.response.statusText}`);
        console.error(`Response data:`, JSON.stringify(error.response.data, null, 2));
        console.error(`Response headers:`, error.response.headers);
      } else if (error.request) {
        // Request was made but no response received (timeout, network error, etc.)
        console.error(`TrackingMore request failed - no response received`);
        console.error(`Request config:`, {
          url: error.config?.url,
          method: error.config?.method,
          timeout: error.config?.timeout,
        });
        if (error.code === 'ECONNABORTED') {
          console.error(`Request timed out after ${error.config?.timeout}ms`);
        } else {
          console.error(`Error code: ${error.code}`);
        }
      } else {
        // Error setting up the request
        console.error(`Error setting up TrackingMore request:`, error.message);
      }
    } else {
      console.error(`Non-Axios error:`, error);
    }
    return { 
      status: 'not_scanned', 
      details: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// No need for browser cleanup with TrackingMore
export async function closeBrowser(): Promise<void> {
  // No-op - TrackingMore is API-based
}
