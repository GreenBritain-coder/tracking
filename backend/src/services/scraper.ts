import axios from 'axios';
import { TrackingStatus } from '../models/tracking';

const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY || '';

export async function checkRoyalMailStatus(trackingNumber: string): Promise<{
  status: TrackingStatus;
  details?: string;
  statusHeader?: string;
}> {
  try {
    if (!SCRAPINGBEE_API_KEY) {
      console.error('ScrapingBee API key not configured');
      return { 
        status: 'not_scanned', 
        details: 'ScrapingBee API key not configured' 
      };
    }

    console.log(`[${trackingNumber}] Fetching via ScrapingBee...`);
    
    // Use ScrapingBee to render the Royal Mail tracking page
    const trackingUrl = `https://www.royalmail.com/track-your-item#/tracking-results/${trackingNumber}`;
    
    // Retry up to 3 times if we don't get tracking content
    let html = '';
    let attempt = 0;
    const maxAttempts = 3;
    
    for (attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        console.log(`[${trackingNumber}] Retry attempt ${attempt}/${maxAttempts}...`);
        // Wait a bit between retries (random 3-5 seconds to look more human-like)
        const delay = 3000 + Math.floor(Math.random() * 2000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      // Use moderate wait times (15-17s) to avoid timeouts
      const waitTime = 13000 + (attempt * 2000); // 15s, 17s, 19s
      
      try {
        const response = await axios.get('https://app.scrapingbee.com/api/v1/', {
          params: {
            api_key: SCRAPINGBEE_API_KEY,
            url: trackingUrl,
            render_js: 'true', // Enable JavaScript rendering
            wait: waitTime.toString(), // Varying wait time
            premium_proxy: 'true', // Use premium proxies for better success rate
            block_resources: 'false', // Don't block any resources
            window_width: '1920',
            window_height: '1080',
          },
          timeout: 35000, // 35 second timeout
        });

        html = response.data;
        console.log(`[${trackingNumber}] Received HTML (attempt ${attempt}), length: ${html.length} bytes`);
        
        // Quick check: Extract a sample of text to verify it's tracking content, not search form
        // Remove HTML tags to get plain text sample
        const textSample = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .toLowerCase()
          .substring(0, 2000); // First 2000 chars should be enough
        
        // Check for actual tracking results (not search form)
        const hasTrackingResults = (
          (textSample.includes('tracking number:') && textSample.includes('service used:')) ||
          textSample.includes('we\'ve got it') || 
          textSample.includes('expect to deliver') ||
          (textSample.includes('delivered') && textSample.includes('tracking number:')) ||
          (textSample.includes('your item was delivered') && textSample.includes('tracking number:'))
        );
        
        // Check that it's NOT the search form (search form has "your reference number*" but no actual tracking data)
        const isSearchForm = textSample.includes('your reference number*') && 
                            !textSample.includes('tracking number:') &&
                            !textSample.includes('we\'ve got it') &&
                            !textSample.includes('delivered') &&
                            !textSample.includes('service used:');
        
        if (hasTrackingResults && !isSearchForm) {
          console.log(`[${trackingNumber}] Tracking content detected on attempt ${attempt}`);
          break; // Got good content, stop retrying
        } else {
          if (isSearchForm) {
            console.log(`[${trackingNumber}] Search form detected on attempt ${attempt} (not tracking results), retrying...`);
          } else {
            console.log(`[${trackingNumber}] No tracking content detected on attempt ${attempt}, may retry...`);
          }
          if (attempt === maxAttempts) {
            console.warn(`[${trackingNumber}] Failed to get tracking content after ${maxAttempts} attempts`);
          }
        }
      } catch (requestError) {
        // Handle 503 Service Unavailable (ScrapingBee infrastructure issue)
        if (axios.isAxiosError(requestError) && requestError.response?.status === 503) {
          console.warn(`[${trackingNumber}] ScrapingBee returned 503 (Service Unavailable) on attempt ${attempt}`);
          if (attempt < maxAttempts) {
            // Exponential backoff for 503s: 5s, 10s, 20s
            const backoffDelay = 5000 * Math.pow(2, attempt - 1);
            console.log(`[${trackingNumber}] Waiting ${backoffDelay}ms before retry (exponential backoff for 503)...`);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
            continue; // Retry the request
          } else {
            console.error(`[${trackingNumber}] ScrapingBee 503 error persisted after ${maxAttempts} attempts`);
            throw requestError; // Re-throw to be caught by outer catch
          }
        } else {
          // Other errors - re-throw to be caught by outer catch
          throw requestError;
        }
      }
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
