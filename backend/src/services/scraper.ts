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
    
    // Try a longer fixed wait since Royal Mail's JavaScript takes time to load
    const response = await axios.get('https://app.scrapingbee.com/api/v1/', {
      params: {
        api_key: SCRAPINGBEE_API_KEY,
        url: trackingUrl,
        render_js: 'true', // Enable JavaScript rendering
        wait: '15000', // Wait 15 seconds for Royal Mail's SPA to render
        premium_proxy: 'true', // Use premium proxies for better success rate
        block_resources: 'false', // Don't block any resources
        window_width: '1920',
        window_height: '1080',
      },
      timeout: 30000, // 30 second timeout
    });

    const html = response.data;
    console.log(`[${trackingNumber}] Received HTML, length: ${html.length} bytes`);

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

    // Extract status header from HTML (look for h1, h2, h3 tags)
    let statusHeader = '';
    const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
    const h2Match = html.match(/<h2[^>]*>(.*?)<\/h2>/i);
    const h3Match = html.match(/<h3[^>]*>(.*?)<\/h3>/i);
    
    const headingMatch = h1Match || h2Match || h3Match;
    if (headingMatch && headingMatch[1]) {
      statusHeader = headingMatch[1]
        .replace(/<[^>]+>/g, '') // Remove any nested tags
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .trim();
      
      // Filter out generic headings
      if (statusHeader.length < 100 && 
          !statusHeader.toLowerCase().includes('royal mail') &&
          !statusHeader.toLowerCase().includes('track your item')) {
        console.log(`[${trackingNumber}] Extracted status header: ${statusHeader}`);
      } else {
        statusHeader = '';
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

    // PRIORITY 1: Check for DELIVERED status (STRICT - only past tense)
    const deliveredPhrases = [
      'has been delivered',
      'was delivered',
      'successfully delivered',
      'item delivered to',
      'delivered and signed',
      'signed for and delivered',
      'delivery completed',
      'delivery successful',
    ];

    const deliveredRegex = /\b(delivered|delivery completed|successfully delivered)\b/i;
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
      console.error(`ScrapingBee API error: ${error.response?.status} ${error.response?.statusText}`);
      console.error(`Response data:`, error.response?.data);
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
