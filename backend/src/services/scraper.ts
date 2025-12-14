import axios from 'axios';
import { TrackingStatus } from '../models/tracking';

const TRACKINGMORE_API_KEY = process.env.TRACKINGMORE_API_KEY || '';
const TRACKINGMORE_API_BASE = 'https://api.trackingmore.com/v4';

/**
 * Parse JSON API response from Royal Mail's microsummary endpoint
 */
function parseJsonApiResponse(data: any, trackingNumber: string): {
  status: TrackingStatus;
  details?: string;
  statusHeader?: string;
} {
  try {
    // Extract status from the JSON response
    // The API structure may vary, so we'll check common fields
    const statusText = data?.status || data?.summary?.status || data?.mailPieces?.[0]?.status || '';
    const statusLower = statusText.toLowerCase();
    
    // Extract status header/description
    const statusHeader = data?.summary?.description || 
                        data?.mailPieces?.[0]?.summary || 
                        data?.statusDescription || 
                        statusText;
    
    // Extract details
    const details = JSON.stringify(data).substring(0, 500);
    
    // Map API status to our TrackingStatus enum
    if (statusLower.includes('delivered') || statusLower.includes('delivery completed')) {
      console.log(`[${trackingNumber}] JSON API: Detected DELIVERED status`);
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
               statusLower.includes('we\'ve got it')) {
      console.log(`[${trackingNumber}] JSON API: Detected SCANNED status`);
      return {
        status: 'scanned',
        details,
        statusHeader: statusHeader || 'In Transit',
      };
    } else {
      console.log(`[${trackingNumber}] JSON API: Defaulting to NOT_SCANNED (status: ${statusText})`);
      return {
        status: 'not_scanned',
        details,
        statusHeader: statusHeader || 'Not Scanned',
      };
    }
  } catch (error) {
    console.error(`[${trackingNumber}] Error parsing JSON API response:`, error);
    return {
      status: 'not_scanned',
      details: 'Error parsing JSON API response',
    };
  }
}

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
    // First, try the JSON API endpoint (much more reliable than scraping HTML)
    console.log(`[${trackingNumber}] Trying JSON API endpoint...`);
    try {
      const apiUrl = `https://api-web.royalmail.com/mailpieces/microsummary/v1/summary/${trackingNumber}`;
      const apiResponse = await axios.get(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Accept-Language': 'en-GB,en;q=0.9',
          'Referer': 'https://www.royalmail.com/track-your-item',
          'Origin': 'https://www.royalmail.com',
        },
        timeout: 15000,
      });

      if (apiResponse.data) {
        console.log(`[${trackingNumber}] Successfully fetched from JSON API`);
        return parseJsonApiResponse(apiResponse.data, trackingNumber);
      }
    } catch (apiError) {
      console.log(`[${trackingNumber}] JSON API failed, falling back to TrackingMore:`, 
        axios.isAxiosError(apiError) ? apiError.message : 'Unknown error');
    }

    // Fall back to TrackingMore if JSON API fails
    if (!TRACKINGMORE_API_KEY) {
      console.error('TrackingMore API key not configured');
      return { 
        status: 'not_scanned', 
        details: 'Both JSON API and TrackingMore failed' 
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
              console.log(`[${trackingNumber}] Response structure:`, JSON.stringify(createResponse.data, null, 2).substring(0, 1000));
              return parseTrackingMoreResponse(createResponse.data, trackingNumber);
            } else if (!Array.isArray(createResponse.data.data) && Object.keys(createResponse.data.data).length > 0) {
              // Object with properties - has tracking data
              console.log(`[${trackingNumber}] POST response contains tracking data object, using it directly`);
              console.log(`[${trackingNumber}] Response structure:`, JSON.stringify(createResponse.data, null, 2).substring(0, 1000));
              return parseTrackingMoreResponse(createResponse.data, trackingNumber);
            } else {
              // Empty array or empty object - need to GET the data
              console.log(`[${trackingNumber}] POST response is empty, will fetch tracking data via GET`);
            }
          }
          
          courierCode = code;
          trackingCreated = true;
          break;
        } catch (createError) {
          // If tracking already exists (409), that's fine - continue to get tracking
          if (axios.isAxiosError(createError) && createError.response?.status === 409) {
            console.log(`[${trackingNumber}] Tracking already exists in TrackingMore with courier code: ${code}`);
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
      
      if (!trackingCreated) {
        console.warn(`[${trackingNumber}] Could not create tracking with any courier code, trying to get anyway...`);
      }
      
      // Step 2: Get tracking information
      // Wait a moment for TrackingMore to process the tracking (increased wait time)
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      console.log(`[${trackingNumber}] Getting tracking information from TrackingMore...`);
      // Try different GET endpoint formats
      let getResponse;
      const getFormats = [
        // Format 1: Path-based format (most likely correct based on API docs)
        {
          url: `${TRACKINGMORE_API_BASE}/trackings/${courierCode}/${cleanTrackingNumber}`,
          params: {},
        },
        // Format 2: Path-based without courier code
        {
          url: `${TRACKINGMORE_API_BASE}/trackings/${cleanTrackingNumber}`,
          params: {},
        },
        // Format 3: Query params with tracking_number and courier_code (snake_case)
        {
          url: `${TRACKINGMORE_API_BASE}/trackings/get`,
          params: { 
            tracking_number: cleanTrackingNumber,
            courier_code: courierCode 
          },
        },
        // Format 4: Query params with just tracking_number
        {
          url: `${TRACKINGMORE_API_BASE}/trackings/get`,
          params: { tracking_number: cleanTrackingNumber },
        },
        // Format 5: Try camelCase field names
        {
          url: `${TRACKINGMORE_API_BASE}/trackings/get`,
          params: { 
            trackingNumber: cleanTrackingNumber,
            courierCode: courierCode 
          },
        },
      ];
      
      let lastError;
      for (const format of getFormats) {
        try {
          console.log(`[${trackingNumber}] Trying GET format: ${format.url} with params:`, JSON.stringify(format.params));
          getResponse = await axios.get(format.url, {
            params: format.params,
            headers: {
              'Tracking-Api-Key': TRACKINGMORE_API_KEY,
            },
            timeout: 30000,
          });
          
          // Check if response has actual tracking data
          if (getResponse.data?.data && 
              ((Array.isArray(getResponse.data.data) && getResponse.data.data.length > 0) ||
               (!Array.isArray(getResponse.data.data) && Object.keys(getResponse.data.data).length > 0))) {
            console.log(`[${trackingNumber}] GET successful with format: ${format.url}`);
            break;
          } else {
            console.warn(`[${trackingNumber}] GET returned empty data, trying next format...`);
            continue;
          }
        } catch (getError) {
          lastError = getError;
          if (axios.isAxiosError(getError) && getError.response) {
            const status = getError.response.status;
            const errorData = getError.response.data;
            console.warn(`[${trackingNumber}] GET failed (${status}):`, JSON.stringify(errorData).substring(0, 200));
            // If it's a 404 or 4130, try next format
            if (status === 404 || (errorData?.meta?.code === 4130)) {
              continue;
            }
          }
          // For other errors, continue trying
          continue;
        }
      }
      
      if (!getResponse) {
        throw lastError || new Error('All GET formats failed');
      }
      
      if (getResponse.data) {
        console.log(`[${trackingNumber}] Successfully fetched from TrackingMore`);
        return parseTrackingMoreResponse(getResponse.data, trackingNumber);
      }
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
