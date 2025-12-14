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
    // Handle case where data.data is an empty array vs an object
    let trackingData;
    if (data?.data) {
      if (Array.isArray(data.data)) {
        // If data is an array, use first item if available, otherwise it's empty
        if (data.data.length > 0) {
          trackingData = data.data[0];
        } else {
          // Empty array - tracking exists but no data yet
          trackingData = null;
        }
      } else {
        // data is an object
        trackingData = data.data;
      }
    } else {
      trackingData = data?.item || data;
    }
    
    // If no tracking data found, return not_scanned
    if (!trackingData || (Array.isArray(trackingData) && trackingData.length === 0)) {
      console.log(`[${trackingNumber}] TrackingMore: Empty data array - tracking exists but not yet processed`);
      return {
        status: 'not_scanned',
        details: 'Tracking exists in TrackingMore but not yet processed',
        statusHeader: 'Pending',
      };
    }
    
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
            // Add optional fields that might help with creation
            order_id: cleanTrackingNumber, // Use tracking number as order ID
            title: `Royal Mail Tracking ${cleanTrackingNumber}`,
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
          console.log(`[${trackingNumber}] POST response status: ${createResponse.status}`);
          console.log(`[${trackingNumber}] POST response body:`, JSON.stringify(createResponse.data, null, 2).substring(0, 1000));
          
          // Check if tracking was actually created (201 Created) vs just accepted (200 OK)
          if (createResponse.status === 201) {
            console.log(`[${trackingNumber}] Tracking successfully CREATED (201) in TrackingMore with courier code: ${code}`);
          } else if (createResponse.status === 200) {
            // 200 with empty data might mean request accepted but tracking not created
            if (!createResponse.data?.data || 
                (Array.isArray(createResponse.data.data) && createResponse.data.data.length === 0)) {
              console.warn(`[${trackingNumber}] POST returned 200 with empty data - tracking may not have been created in TrackingMore`);
            } else {
              console.log(`[${trackingNumber}] Tracking created/updated (200) in TrackingMore with courier code: ${code}`);
            }
          }
          
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
      
      // If POST response was empty, try to GET the tracking data
      // This handles cases where tracking exists in TrackingMore but POST didn't return data
      if (!trackingCreated) {
        console.warn(`[${trackingNumber}] Could not create tracking with any courier code, trying to fetch existing tracking...`);
      } else {
        console.log(`[${trackingNumber}] POST returned empty data, fetching tracking from TrackingMore...`);
      }
      
      // Wait longer for TrackingMore to process the tracking (especially if it was just created)
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Try to GET the tracking data using path-based format: /trackings/{courier_code}/{tracking_number}
      // Try both courier code formats
      for (const code of courierCodes) {
        try {
          console.log(`[${trackingNumber}] Fetching tracking data from TrackingMore using courier code: ${code}`);
          const getResponse = await axios.get(
            `${TRACKINGMORE_API_BASE}/trackings/${code}/${cleanTrackingNumber}`,
            {
              headers: {
                'Tracking-Api-Key': TRACKINGMORE_API_KEY,
              },
              timeout: 30000,
            }
          );
          
          if (getResponse.status === 200 && getResponse.data) {
            // Check if response has actual data (not just empty array)
            const responseData = getResponse.data;
            const hasData = responseData?.data && 
              ((Array.isArray(responseData.data) && responseData.data.length > 0) ||
               (!Array.isArray(responseData.data) && Object.keys(responseData.data).length > 0));
            
            if (hasData) {
              console.log(`[${trackingNumber}] Successfully fetched tracking data from TrackingMore`);
              return parseTrackingMoreResponse(responseData, trackingNumber);
            } else {
              // Response is 200 but data is empty - log full response for debugging
              console.log(`[${trackingNumber}] GET returned 200 but data is empty. Full response:`, 
                JSON.stringify(responseData, null, 2).substring(0, 1000));
              console.log(`[${trackingNumber}] Trying shipments endpoint as fallback...`);
              
              // Try shipments endpoint as alternative - get all shipments and filter
              try {
                console.log(`[${trackingNumber}] Trying shipments endpoint to find tracking...`);
                // First try with tracking_number parameter
                let shipmentsResponse = await axios.get(
                  `${TRACKINGMORE_API_BASE}/shipments`,
                  {
                    params: {
                      tracking_number: cleanTrackingNumber,
                    },
                    headers: {
                      'Tracking-Api-Key': TRACKINGMORE_API_KEY,
                    },
                    timeout: 30000,
                  }
                );
                
                // If that doesn't work, try getting all shipments and filtering
                if (shipmentsResponse.status === 200 && shipmentsResponse.data?.data) {
                  const shipmentsData = shipmentsResponse.data.data;
                  console.log(`[${trackingNumber}] Shipments endpoint response:`, JSON.stringify(shipmentsResponse.data, null, 2).substring(0, 500));
                  
                  // Find the matching tracking number
                  let shipment;
                  if (Array.isArray(shipmentsData)) {
                    shipment = shipmentsData.find((s: any) => 
                      s.tracking_number === cleanTrackingNumber || 
                      s.tracking_number?.replace(/\s+/g, '') === cleanTrackingNumber
                    );
                  } else if (shipmentsData.tracking_number === cleanTrackingNumber) {
                    shipment = shipmentsData;
                  }
                  
                  if (shipment) {
                    console.log(`[${trackingNumber}] Found tracking data via shipments endpoint`);
                    return parseTrackingMoreResponse({ data: shipment }, trackingNumber);
                  }
                }
                
                // If not found, try getting all shipments (might need pagination)
                console.log(`[${trackingNumber}] Not found with tracking_number param, trying to get all shipments...`);
                shipmentsResponse = await axios.get(
                  `${TRACKINGMORE_API_BASE}/shipments`,
                  {
                    params: {
                      page: 1,
                      limit: 100,
                    },
                    headers: {
                      'Tracking-Api-Key': TRACKINGMORE_API_KEY,
                    },
                    timeout: 30000,
                  }
                );
                
                if (shipmentsResponse.status === 200 && shipmentsResponse.data?.data) {
                  const allShipments = shipmentsResponse.data.data;
                  if (Array.isArray(allShipments)) {
                    const shipment = allShipments.find((s: any) => 
                      s.tracking_number === cleanTrackingNumber || 
                      s.tracking_number?.replace(/\s+/g, '') === cleanTrackingNumber
                    );
                    
                    if (shipment) {
                      console.log(`[${trackingNumber}] Found tracking data in shipments list`);
                      return parseTrackingMoreResponse({ data: shipment }, trackingNumber);
                    }
                  }
                }
              } catch (shipmentsError) {
                // Log the error for debugging
                if (axios.isAxiosError(shipmentsError) && shipmentsError.response) {
                  console.warn(`[${trackingNumber}] Shipments endpoint failed:`, shipmentsError.response.status, 
                    JSON.stringify(shipmentsError.response.data).substring(0, 200));
                } else {
                  console.warn(`[${trackingNumber}] Shipments endpoint error:`, shipmentsError);
                }
              }
              
              // If shipments endpoint also fails, continue to next courier code
              continue;
            }
          }
        } catch (getError) {
          // 404 is expected if tracking not found yet, don't log as error
          if (axios.isAxiosError(getError) && getError.response?.status === 404) {
            console.log(`[${trackingNumber}] GET failed (404) with courier code ${code}, trying next...`);
            continue; // Try next courier code
          } else if (axios.isAxiosError(getError) && getError.response) {
            // Log other errors but continue trying
            console.warn(`[${trackingNumber}] GET failed (${getError.response.status}) with courier code ${code}:`, 
              JSON.stringify(getError.response.data).substring(0, 200));
            continue;
          }
        }
      }
      
      // If GET also fails or returns empty, tracking hasn't been scanned yet
      console.log(`[${trackingNumber}] No tracking data available yet - returning not_scanned`);
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
