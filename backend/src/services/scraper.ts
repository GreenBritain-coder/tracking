import puppeteer, { Browser, Page } from 'puppeteer';
import { TrackingStatus } from '../models/tracking';

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled', // Hide automation
      ],
    });
  }
  return browser;
}

export async function checkRoyalMailStatus(trackingNumber: string): Promise<{
  status: TrackingStatus;
  details?: string;
}> {
  let page: Page | null = null;
  
  try {
    const browserInstance = await getBrowser();
    page = await browserInstance.newPage();
    
    // Set realistic viewport
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Set user agent and additional headers to avoid detection
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    
    // Set additional headers to look more like a real browser
    await page.setExtraHTTPHeaders({
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-GB,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Cache-Control': 'max-age=0',
    });
    
    // Remove webdriver property to avoid detection
    await page.evaluateOnNewDocument(() => {
      // @ts-ignore
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
    });
    
    // Add random delay before navigation to appear more human-like
    const randomDelay = Math.floor(Math.random() * 2000) + 1000; // 1-3 seconds
    await new Promise(resolve => setTimeout(resolve, randomDelay));
    
    // Navigate to Royal Mail tracking page
    const trackingUrl = `https://www.royalmail.com/track-your-item#/tracking-results/${trackingNumber}`;
    await page.goto(trackingUrl, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    // Wait for Royal Mail's dynamic content to load
    // Try to wait for specific elements that indicate content has loaded
    try {
      // Wait for any tracking content to appear (various possible selectors)
      await page.waitForSelector('body', { timeout: 10000 });
      // Additional wait for JavaScript to render content
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (e) {
      // If waiting fails, just continue with a longer delay
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    // Extract status information from the page
    // Royal Mail's page structure - try multiple approaches
    let statusText = '';
    let allPageText = '';
    
    try {
      // Try to get the main content area text
      // Royal Mail uses various structures, try common patterns
      const contentSelectors = [
        '[class*="tracking"]',
        '[class*="status"]',
        '[class*="result"]',
        'main',
        '[role="main"]',
        '.content',
        '#content',
      ];
      
      for (const selector of contentSelectors) {
        try {
          const elements = await page.$$(selector);
          if (elements.length > 0) {
            for (const element of elements) {
              const text = await page.evaluate((el) => el.textContent?.trim() || '', element);
              if (text && text.length > statusText.length) {
                statusText = text;
              }
            }
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      
      // If we didn't get good content, get all page text as fallback
      if (!statusText || statusText.length < 50) {
        allPageText = await page.evaluate(() => {
          // @ts-ignore - document is available in browser context
          return document.body.innerText || '';
        });
        // Use all page text if we didn't get specific content
        if (!statusText || statusText.length < 50) {
          statusText = allPageText;
        }
      }
    } catch (error) {
      console.error(`Error extracting status for ${trackingNumber}:`, error);
      // Fallback to getting all page text
      try {
        allPageText = await page.evaluate(() => {
          // @ts-ignore - document is available in browser context
          return document.body.innerText || '';
        });
        statusText = allPageText;
      } catch (e) {
        console.error(`Failed to get page text for ${trackingNumber}:`, e);
      }
    }
    
    // Log what we extracted for debugging
    const extractedText = statusText.substring(0, 200); // First 200 chars for logging
    console.log(`[${trackingNumber}] Extracted text (first 200 chars): ${extractedText}`);
    
    // Check for Access Denied errors first
    if (statusText.toLowerCase().includes('access denied') || 
        statusText.toLowerCase().includes('you don\'t have permission')) {
      console.log(`[${trackingNumber}] Access Denied - Royal Mail blocking request`);
      return { 
        status: 'not_scanned', 
        details: 'Access Denied by Royal Mail. May need to wait or use different approach.' 
      };
    }
    
    // Normalize the text for analysis
    const statusTextLower = statusText.toLowerCase();
    const allTextLower = allPageText.toLowerCase();
    const searchText = allTextLower || statusTextLower;
    
    // PRIORITY 0: Check for future delivery phrases (should be SCANNED, not DELIVERED)
    // These indicate the item is in transit, not yet delivered
    const futureDeliveryPhrases = [
      'expect to deliver',
      'will deliver',
      'to be delivered',
      'expected delivery',
      'delivery expected',
      'we expect to deliver',
      'on its way',
      'it\'s on its way',
    ];
    
    for (const phrase of futureDeliveryPhrases) {
      if (searchText.includes(phrase)) {
        console.log(`[${trackingNumber}] Detected SCANNED status (future delivery phrase: ${phrase})`);
        return { status: 'scanned', details: statusText.substring(0, 500) };
      }
    }
    
    // PRIORITY 1: Check for DELIVERED status (past tense, specific phrases only)
    // Use word boundaries to avoid matching "deliver" in "expect to deliver"
    const deliveredPhrases = [
      'has been delivered',
      'was delivered',
      'successfully delivered',
      'item delivered',
      'delivered to',
      'delivered and signed',
      'signed for and delivered',
      'delivery completed',
      'delivery successful',
      // Only match standalone "delivered" if it's clearly past tense context
    ];
    
    // Check for past tense "delivered" with context
    const deliveredRegex = /\b(delivered|delivery completed|successfully delivered)\b/i;
    const hasDeliveredKeyword = deliveredRegex.test(searchText);
    
    // But exclude if it's in a future context
    const futureContextRegex = /(expect|will|should|going to|due to).*deliver/i;
    const hasFutureContext = futureContextRegex.test(searchText);
    
    // Check for specific delivered phrases
    let isDelivered = false;
    for (const phrase of deliveredPhrases) {
      if (searchText.includes(phrase)) {
        isDelivered = true;
        break;
      }
    }
    
    // Only mark as delivered if we have a clear delivered phrase AND no future context
    if (isDelivered || (hasDeliveredKeyword && !hasFutureContext)) {
      // Double-check it's not a future delivery
      if (!hasFutureContext && !searchText.includes('expect') && !searchText.includes('will deliver')) {
        console.log(`[${trackingNumber}] Detected DELIVERED status`);
        return { status: 'delivered', details: statusText.substring(0, 500) };
      }
    }
    
    // PRIORITY 2: Check for NOT_SCANNED / NOT FOUND status
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
      if (searchText.includes(keyword)) {
        console.log(`[${trackingNumber}] Detected NOT_SCANNED status (keyword: ${keyword})`);
        return { status: 'not_scanned', details: statusText.substring(0, 500) || 'No tracking information available' };
      }
    }
    
    // PRIORITY 3: Check for SCANNED / IN TRANSIT status (only if we have substantial content)
    // Only mark as scanned if we have clear indicators of movement
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
      'at london central',
      'at delivery office',
      'we expect to deliver',
    ];
    
    let hasScannedIndicator = false;
    for (const keyword of scannedKeywords) {
      if (searchText.includes(keyword)) {
        hasScannedIndicator = true;
        console.log(`[${trackingNumber}] Detected SCANNED status (keyword: ${keyword})`);
        break;
      }
    }
    
    // Only return scanned if we have clear indicators AND substantial content
    if (hasScannedIndicator && statusText.length > 50) {
      return { status: 'scanned', details: statusText.substring(0, 500) };
    }
    
    // If we have substantial content but no clear indicators, check if it looks like tracking info
    if (statusText.length > 100 && searchText.includes('tracking')) {
      // Has tracking info but unclear status - default to scanned if we have dates/times
      const hasDateOrTime = /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}:\d{2}/.test(statusText);
      if (hasDateOrTime) {
        console.log(`[${trackingNumber}] Detected SCANNED status (has tracking info with dates)`);
        return { status: 'scanned', details: statusText.substring(0, 500) };
      }
    }
    
    // Default: if we can't determine, return not_scanned (safer than assuming scanned)
    console.log(`[${trackingNumber}] Unable to determine status, defaulting to NOT_SCANNED`);
    return { status: 'not_scanned', details: statusText.substring(0, 500) || 'Unable to determine status from page content' };
    
  } catch (error) {
    console.error(`Error checking status for ${trackingNumber}:`, error);
    // On error, return not_scanned (safer default)
    return { status: 'not_scanned', details: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` };
  } finally {
    if (page) {
      await page.close();
    }
  }
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  await closeBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeBrowser();
  process.exit(0);
});

