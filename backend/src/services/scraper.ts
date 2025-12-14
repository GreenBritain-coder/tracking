import axios from 'axios';
import { TrackingStatus } from '../models/tracking';

const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY || '';

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
      console.log(`[${trackingNumber}] JSON API failed, falling back to ScrapingBee:`, 
        axios.isAxiosError(apiError) ? apiError.message : 'Unknown error');
    }

    // Fall back to ScrapingBee if JSON API fails
    if (!SCRAPINGBEE_API_KEY) {
      console.error('ScrapingBee API key not configured');
      return { 
        status: 'not_scanned', 
        details: 'Both JSON API and ScrapingBee failed' 
      };
    }

    console.log(`[${trackingNumber}] Fetching via ScrapingBee...`);
    
    // Clean tracking number (remove spaces) for URL
    const cleanTrackingNumber = trackingNumber.replace(/\s+/g, '');
    
    // Try multiple URL formats - Royal Mail supports query parameter format
    const urlFormats = [
      `http://www.royalmail.com/track-trace?trackNumber=${cleanTrackingNumber}`,
      `https://www.royalmail.com/track-trace?trackNumber=${cleanTrackingNumber}`,
      `https://www.royalmail.com/track-your-item?trackNumber=${cleanTrackingNumber}`,
    ];
    
    // Retry up to 2 times to save credits
    let html = '';
    let attempt = 0;
    const maxAttempts = 2;
    let foundContent = false;
    
    outerLoop: for (attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        console.log(`[${trackingNumber}] Retry attempt ${attempt}/${maxAttempts}...`);
        // Shorter delay between retries (3-5 seconds)
        const delay = 3000 + Math.floor(Math.random() * 2000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      // Try each URL format
      for (const trackingUrl of urlFormats) {
        try {
          console.log(`[${trackingNumber}] Trying URL: ${trackingUrl}`);
          
          // Ensure URL is properly encoded
          const encodedUrl = encodeURI(trackingUrl);
          
          // Simple direct approach - use the query parameter URL directly
          // Royal Mail should process the query parameter and show tracking results
          const response = await axios.get('https://app.scrapingbee.com/api/v1/', {
            params: {
              api_key: SCRAPINGBEE_API_KEY,
              url: encodedUrl, // Direct URL with properly encoded query parameter
              render_js: 'true', // Enable JavaScript rendering for dynamic content
              wait: '15000', // 15 second wait for page to fully load and process query param
              premium_proxy: 'true', // Use premium proxies for better success rate
              block_resources: 'false', // Don't block any resources (as ScrapingBee suggests)
              window_width: '1920',
              window_height: '1080',
              country_code: 'GB', // UK geolocation
            },
            timeout: 30000, // 30 second timeout
          });
          
          html = response.data;
          console.log(`[${trackingNumber}] Received HTML (attempt ${attempt}), length: ${html.length} bytes`);
          
          // Extract text from HTML (remove scripts, styles, tags)
          const fullTextSample = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .toLowerCase();
          
          // Get a sample for logging (first 1000 chars)
          const textSampleForLog = fullTextSample.substring(0, 1000);
          console.log(`[${trackingNumber}] Text sample (first 1000 chars): ${textSampleForLog}`);
          
          // Check for actual tracking results (not search form) - check FULL HTML, not just sample
          // Make keywords more flexible (removed colons, added variations)
          const hasTrackingResults = (
            (fullTextSample.includes('tracking number') && fullTextSample.includes('service used')) ||
            fullTextSample.includes('we\'ve got it') || 
            fullTextSample.includes('we have your item') ||
            fullTextSample.includes('expect to deliver') ||
            fullTextSample.includes('on its way') ||
            (fullTextSample.includes('delivered') && fullTextSample.includes('tracking number')) ||
            (fullTextSample.includes('your item was delivered') && fullTextSample.includes('tracking number')) ||
            fullTextSample.includes('tracking information') ||
            fullTextSample.includes('item status') ||
            fullTextSample.includes('mailpiece') ||
            fullTextSample.includes('parcel status')
          );
          
          // Check that it's NOT the search form (search form has "your reference number" but no actual tracking data)
          const isSearchForm = (fullTextSample.includes('your reference number') || 
                              fullTextSample.includes('enter your tracking number')) && 
                              !fullTextSample.includes('tracking number') &&
                              !fullTextSample.includes('we\'ve got it') &&
                              !fullTextSample.includes('delivered') &&
                              !fullTextSample.includes('service used') &&
                              !fullTextSample.includes('item status');
          
          // Enhanced debug logging
          console.log(`[${trackingNumber}] Content detection results:`);
          console.log(`[${trackingNumber}] - Has tracking results: ${hasTrackingResults}`);
          console.log(`[${trackingNumber}] - Is search form: ${isSearchForm}`);
          console.log(`[${trackingNumber}] - Full text length: ${fullTextSample.length} chars`);
          
          if (hasTrackingResults && !isSearchForm) {
            console.log(`[${trackingNumber}] ✅ Tracking content detected on attempt ${attempt} with URL: ${trackingUrl}`);
            foundContent = true;
            break outerLoop; // Got good content, stop retrying
          } else {
            if (isSearchForm) {
              console.log(`[${trackingNumber}] ❌ Search form detected with URL: ${trackingUrl}, trying next URL format...`);
            } else {
              console.log(`[${trackingNumber}] ❌ No tracking content detected with URL: ${trackingUrl}, trying next URL format...`);
            }
            // Continue to next URL format
          }
        } catch (requestError) {
          // Handle different error types
          if (axios.isAxiosError(requestError)) {
            const status = requestError.response?.status;
            const statusText = requestError.response?.statusText;
            
            if (status === 401) {
              // 401 Unauthorized - Royal Mail is blocking ScrapingBee
              console.warn(`[${trackingNumber}] ⚠️ ScrapingBee returned 401 (Unauthorized) with URL: ${trackingUrl}`);
              console.warn(`[${trackingNumber}] This likely means Royal Mail is blocking ScrapingBee's requests`);
              // Try next URL format - maybe a different URL will work
              continue;
            } else if (status === 403) {
              // 403 Forbidden - Similar to 401, blocked access
              console.warn(`[${trackingNumber}] ⚠️ ScrapingBee returned 403 (Forbidden) with URL: ${trackingUrl}`);
              continue;
            } else if (status === 503) {
              // 503 Service Unavailable (ScrapingBee infrastructure issue)
              console.warn(`[${trackingNumber}] ⚠️ ScrapingBee returned 503 (Service Unavailable) with URL: ${trackingUrl}`);
              // Try next URL format on 503
              continue;
            } else if (requestError.code === 'ECONNABORTED') {
              console.warn(`[${trackingNumber}] ⚠️ Request timed out with URL: ${trackingUrl}, trying next URL format...`);
              // Try next URL format on timeout
              continue;
            } else {
              // Other errors - log details and try next URL format
              console.warn(`[${trackingNumber}] ⚠️ Error with URL ${trackingUrl}:`, 
                status ? `${status} ${statusText}` : requestError.message);
              if (requestError.response?.data) {
                console.warn(`[${trackingNumber}] Response data:`, JSON.stringify(requestError.response.data).substring(0, 200));
              }
              continue;
            }
          } else {
            // Non-Axios errors
            console.warn(`[${trackingNumber}] ⚠️ Non-Axios error with URL ${trackingUrl}:`, 
              requestError instanceof Error ? requestError.message : 'Unknown error');
            continue;
          }
        }
      }
      
      // If we've tried all URL formats and still no content, break to retry attempt
      if (!foundContent && attempt === maxAttempts) {
        console.warn(`[${trackingNumber}] Failed to get tracking content after ${maxAttempts} attempts with all URL formats`);
      }
    }
    
    // If we didn't get any content, return early
    if (!foundContent || !html) {
      console.warn(`[${trackingNumber}] No tracking content found after all attempts`);
      return {
        status: 'not_scanned',
        details: 'Unable to fetch tracking information from Royal Mail',
      };
    }

    // Try to extract just the main tracking content (skip header, footer, cookie banners)
    // Look for the main content area in Royal Mail's page
    let mainContent = '';
    const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    const roleMainMatch = html.match(/<[^>]*role=["']main["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
    
    const contentHtml = mainMatch?.[1] || roleMainMatch?.[1] || html;
    
    // Extract text content from HTML
    const textContent = contentHtml
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove scripts
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove styles
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '') // Remove header
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '') // Remove footer
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '') // Remove navigation
      .replace(/<[^>]+>/g, ' ') // Remove all remaining tags
      .replace(/\s+/g, ' ') // Collapse whitespace
      .replace(/Your privacy and our use of cookies.*?Continue/gi, '') // Remove cookie banner
      .replace(/This site uses JavaScript.*?enabled/gi, '') // Remove JS warning
      .trim();

    console.log(`[${trackingNumber}] Extracted text, length: ${textContent.length} chars`);
    console.log(`[${trackingNumber}] First 500 chars: ${textContent.substring(0, 500)}`);
    
    // Also log if we found key tracking phrases
    const hasTrackingContent = textContent.toLowerCase().includes('we\'ve got it') || 
                                textContent.toLowerCase().includes('expect to deliver') ||
                                textContent.toLowerCase().includes('tracking number:');
    console.log(`[${trackingNumber}] Has tracking content: ${hasTrackingContent}`);

    // Extract status header from HTML
    // Royal Mail uses various heading structures, so try multiple approaches
    let statusHeader = '';
    
    // Try to find headings with regex (allows for nested tags)
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const h2Match = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const h3Match = html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    
    const headingMatch = h1Match || h2Match || h3Match;
    if (headingMatch && headingMatch[1]) {
      statusHeader = headingMatch[1]
        .replace(/<[^>]+>/g, '') // Remove any nested tags
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ') // Collapse whitespace
        .trim();
      
      // Filter out generic headings
      if (statusHeader.length < 100 && 
          !statusHeader.toLowerCase().includes('royal mail') &&
          !statusHeader.toLowerCase().includes('track your item') &&
          statusHeader.length > 0) {
        console.log(`[${trackingNumber}] Extracted status header: "${statusHeader}"`);
      } else {
        statusHeader = '';
      }
    }
    
    // If no heading found, try to extract from the text content
    if (!statusHeader) {
      // Look for common status phrases in the beginning of the text
      const textStart = textContent.substring(0, 200);
      if (textStart.includes('We\'ve got it')) {
        statusHeader = 'We\'ve got it';
        console.log(`[${trackingNumber}] Extracted status header from text: "${statusHeader}"`);
      } else if (textStart.includes('Item delivered')) {
        statusHeader = 'Item delivered';
        console.log(`[${trackingNumber}] Extracted status header from text: "${statusHeader}"`);
      } else if (textStart.includes('On its way')) {
        statusHeader = 'On its way';
        console.log(`[${trackingNumber}] Extracted status header from text: "${statusHeader}"`);
      }
    }

    const textLower = textContent.toLowerCase();

    // Check for Access Denied or errors
    if (textLower.includes('access denied') || textLower.includes('you don\'t have permission')) {
      console.log(`[${trackingNumber}] Access Denied`);
      return { 
        status: 'not_scanned', 
        details: 'Access Denied by Royal Mail',
        statusHeader: statusHeader || undefined
      };
    }

    // PRIORITY 0: Check for future delivery phrases (should be SCANNED, not DELIVERED)
    const futureDeliveryPhrases = [
      'expect to deliver',
      'will deliver',
      'to be delivered',
      'expected delivery',
      'delivery expected',
      'we expect to deliver',
      'on its way',
      'it\'s on its way',
      'we have your item',
      'at london central',
      'at delivery office',
      'by 7:30pm',
      'have your item at',
    ];

    for (const phrase of futureDeliveryPhrases) {
      if (textLower.includes(phrase)) {
        console.log(`[${trackingNumber}] Detected SCANNED status (has future delivery indicator: ${phrase})`);
        return { 
          status: 'scanned', 
          details: textContent.substring(0, 500),
          statusHeader: statusHeader || undefined
        };
      }
    }

    // PRIORITY 1: Check for DELIVERED status (VERY STRICT - only past tense AND must have tracking content)
    // Check for delivered status FIRST before validation (delivered pages might be shorter)
    const deliveredPhrases = [
      'your item was delivered',
      'has been delivered',
      'was delivered',
      'successfully delivered',
      'item delivered to',
      'delivered and signed',
      'signed for and delivered',
      'delivery completed',
      'delivery successful',
    ];
    
    // Check if this is a delivered status page
    const hasDeliveredIndicator = deliveredPhrases.some(phrase => textLower.includes(phrase)) ||
                                   textLower.includes('delivered') && textLower.includes('tracking number:');
    
    // Validation: Do we have actual tracking content?
    // Real tracking pages have "Tracking number:" label (either delivered or in-transit)
    // Search form does NOT have this
    const hasTrackingNumberLabel = textLower.includes('tracking number:');
    const hasServiceUsedLabel = textLower.includes('service used:');
    
    // If we have these labels, it's definitely tracking content regardless of length
    if (hasTrackingNumberLabel && hasServiceUsedLabel) {
      console.log(`[${trackingNumber}] Validated: Has tracking labels (length: ${textContent.length})`);
      // Continue to status detection
    } else if (textContent.length < 700) {
      // Short content without tracking labels = search form or error
      console.log(`[${trackingNumber}] No actual tracking content found (length: ${textContent.length}, no tracking labels), defaulting to NOT_SCANNED`);
      return { 
        status: 'not_scanned', 
        details: 'No tracking information loaded from Royal Mail',
        statusHeader: statusHeader || undefined
      };
    } else if (!textLower.includes('we\'ve got it') && 
               !textLower.includes('expect to deliver') &&
               !textLower.includes('delivered') &&
               !textLower.includes('on its way')) {
      // Medium length but no tracking-related keywords = likely search form
      console.log(`[${trackingNumber}] No tracking keywords found despite length ${textContent.length}, defaulting to NOT_SCANNED`);
      return { 
        status: 'not_scanned', 
        details: 'No tracking information loaded from Royal Mail',
        statusHeader: statusHeader || undefined
      };
    }
    
    console.log(`[${trackingNumber}] Validation passed, proceeding with status detection...`);

    const deliveredRegex = /\b(has been delivered|was delivered|delivery completed)\b/i;
    const hasDeliveredKeyword = deliveredRegex.test(textLower);
    
    let hasDeliveredPhrase = false;
    for (const phrase of deliveredPhrases) {
      if (textLower.includes(phrase)) {
        hasDeliveredPhrase = true;
        break;
      }
    }

    // Check for future indicators that would override "delivered" detection
    const hasNoFutureWords = !textLower.includes('expect') && 
                             !textLower.includes('will deliver') && 
                             !textLower.includes('to be delivered');

    if ((hasDeliveredPhrase || hasDeliveredKeyword) && hasNoFutureWords) {
      console.log(`[${trackingNumber}] Detected DELIVERED status`);
      return { 
        status: 'delivered', 
        details: textContent.substring(0, 500),
        statusHeader: statusHeader || undefined
      };
    }

    // PRIORITY 2: Check for NOT_SCANNED status
    const notScannedKeywords = [
      'not found',
      'no tracking information',
      'unable to find',
      'please check the tracking number',
      'invalid tracking number',
      'tracking number not recognised',
      'no information available',
      'we cannot find',
    ];

    for (const keyword of notScannedKeywords) {
      if (textLower.includes(keyword)) {
        console.log(`[${trackingNumber}] Detected NOT_SCANNED status (keyword: ${keyword})`);
        return { 
          status: 'not_scanned', 
          details: textContent.substring(0, 500) || 'No tracking information available',
          statusHeader: statusHeader || undefined
        };
      }
    }

    // PRIORITY 3: Check for SCANNED status
    const scannedKeywords = [
      'in transit',
      'out for delivery',
      'at delivery office',
      'on its way',
      'it\'s on its way',
      'collected',
      'accepted',
      'processed',
      'dispatched',
      'in the post',
      'tracking information',
      'item received',
      'received at',
      'arrived at',
      'sorted',
      'ready for delivery',
      'we have your item',
      'we\'ve got it',
    ];

    let hasScannedIndicator = false;
    for (const keyword of scannedKeywords) {
      if (textLower.includes(keyword)) {
        hasScannedIndicator = true;
        console.log(`[${trackingNumber}] Detected SCANNED status (keyword: ${keyword})`);
        break;
      }
    }

    if (hasScannedIndicator && textContent.length > 50) {
      return { 
        status: 'scanned', 
        details: textContent.substring(0, 500),
        statusHeader: statusHeader || undefined
      };
    }

    // Check if we have substantial content with dates/times
    if (textContent.length > 100 && textLower.includes('tracking')) {
      const hasDateOrTime = /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}:\d{2}/.test(textContent);
      if (hasDateOrTime) {
        console.log(`[${trackingNumber}] Detected SCANNED status (has tracking info with dates)`);
        return { 
          status: 'scanned', 
          details: textContent.substring(0, 500),
          statusHeader: statusHeader || undefined
        };
      }
    }

    // Default: not_scanned
    console.log(`[${trackingNumber}] Unable to determine status, defaulting to NOT_SCANNED`);
    return { 
      status: 'not_scanned', 
      details: textContent.substring(0, 500) || 'Unable to determine status from page content',
      statusHeader: statusHeader || undefined
    };
    
  } catch (error) {
    console.error(`Error checking status for ${trackingNumber}:`, error);
    if (axios.isAxiosError(error)) {
      if (error.response) {
        // Server responded with error status
        console.error(`ScrapingBee API error: ${error.response.status} ${error.response.statusText}`);
        console.error(`Response data:`, JSON.stringify(error.response.data, null, 2));
        console.error(`Response headers:`, error.response.headers);
      } else if (error.request) {
        // Request was made but no response received (timeout, network error, etc.)
        console.error(`ScrapingBee request failed - no response received`);
        console.error(`Request config:`, {
          url: error.config?.url,
          method: error.config?.method,
          timeout: error.config?.timeout,
          params: error.config?.params
        });
        if (error.code === 'ECONNABORTED') {
          console.error(`Request timed out after ${error.config?.timeout}ms`);
        } else {
          console.error(`Error code: ${error.code}`);
        }
      } else {
        // Error setting up the request
        console.error(`Error setting up ScrapingBee request:`, error.message);
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

// No need for browser cleanup with ScrapingBee
export async function closeBrowser(): Promise<void> {
  // No-op - ScrapingBee is API-based
}
