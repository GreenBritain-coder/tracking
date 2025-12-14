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
    // TrackingMore API response structure
    const trackingData = data?.data || data;
    const statusText = trackingData?.status || trackingData?.latest_status || '';
    const statusLower = statusText.toLowerCase();
    
    // Extract status header/description
    const statusHeader = trackingData?.latest_status || 
                        trackingData?.status || 
                        trackingData?.sub_status ||
                        statusText;
    
    // Extract details from tracking events
    const events = trackingData?.origin_info?.trackinfo || trackingData?.tracking_info || [];
    const details = events.length > 0 
      ? JSON.stringify(events.map((e: any) => ({
          date: e.date || e.track_date,
          status: e.status || e.track_status,
          details: e.details || e.track_location
        }))).substring(0, 500)
      : JSON.stringify(trackingData).substring(0, 500);
    
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
      // Courier code for Royal Mail - try 'royal-mail' first, fallback to 'royalmail' if needed
      const courierCode = 'royal-mail';
      
      try {
        console.log(`[${trackingNumber}] Creating tracking in TrackingMore...`);
        await axios.post(
          `${TRACKINGMORE_API_BASE}/trackings/post`,
          {
            tracking_number: cleanTrackingNumber,
            courier_code: courierCode,
          },
          {
            headers: {
              'Tracking-Api-Key': TRACKINGMORE_API_KEY,
              'Content-Type': 'application/json',
            },
            timeout: 30000,
          }
        );
        console.log(`[${trackingNumber}] Tracking created/updated in TrackingMore`);
      } catch (createError) {
        // If tracking already exists (409), that's fine - continue to get tracking
        if (axios.isAxiosError(createError) && createError.response?.status === 409) {
          console.log(`[${trackingNumber}] Tracking already exists in TrackingMore`);
        } else {
          console.warn(`[${trackingNumber}] Failed to create tracking:`, 
            axios.isAxiosError(createError) ? createError.message : 'Unknown error');
        }
      }
      
      // Step 2: Get tracking information
      console.log(`[${trackingNumber}] Getting tracking information from TrackingMore...`);
      const getResponse = await axios.get(
        `${TRACKINGMORE_API_BASE}/trackings/get`,
        {
          params: {
            tracking_number: cleanTrackingNumber,
            courier_code: courierCode,
          },
          headers: {
            'Tracking-Api-Key': TRACKINGMORE_API_KEY,
          },
          timeout: 30000,
        }
      );
      
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
