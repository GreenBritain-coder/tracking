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
    // Wait longer and try to wait for actual tracking content
    try {
      // Wait for body first
      await page.waitForSelector('body', { timeout: 10000 });
      
      // Wait for tracking-related content to appear (look for common phrases)
      let contentLoaded = false;
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const pageText = await page.evaluate(() => {
          // @ts-ignore
          return document.body.innerText || '';
        });
        
        // Check if we have actual tracking content (not just UI elements)
        if (pageText.includes('We\'ve got it') || 
            pageText.includes('expect to deliver') || 
            pageText.includes('on its way') ||
            pageText.includes('delivered') ||
            pageText.includes('tracking number') ||
            pageText.length > 200) {
          contentLoaded = true;
          break;
        }
      }
      
      if (!contentLoaded) {
        // Final wait if content hasn't loaded
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    } catch (e) {
      // If waiting fails, just continue with a longer delay
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    // Extract status information from the page
    // Get all page text and filter out UI elements
    let statusText = '';
    let allPageText = '';
    
    try {
      // Get all page text
      allPageText = await page.evaluate(() => {
        // @ts-ignore - document is available in browser context
        return document.body.innerText || '';
      });
      
      // Try to extract just the main content area (exclude navigation, buttons, etc.)
      // Look for the main content section
      const mainContent = await page.evaluate(() => {
        // @ts-ignore - document is available in browser context
        const main = document.querySelector('main') || 
                    // @ts-ignore
                    document.querySelector('[role="main"]') ||
                    // @ts-ignore
                    document.querySelector('.content') ||
                    // @ts-ignore
                    document.querySelector('#content') ||
                    // @ts-ignore
                    document.querySelector('[class*="tracking"]') ||
                    // @ts-ignore
                    document.querySelector('[class*="result"]');
        return main ? main.innerText : '';
      });
      
      // Use main content if we got it, otherwise use all page text
      statusText = mainContent && mainContent.length > 100 ? mainContent : allPageText;
      
      // Filter out common UI elements that might be getting picked up
      const uiElements = ['close', 'search', 'clear input', 'menu', 'navigation', 'cookie', 'accept'];
      const lines = statusText.split('\n').filter(line => {
        const lineLower = line.toLowerCase().trim();
        // Keep lines that are substantial or contain tracking-related keywords
        return line.length > 10 && 
               !uiElements.some(ui => lineLower === ui || lineLower.startsWith(ui + ' ')) &&
               (line.length > 20 || 
                lineLower.includes('deliver') || 
                lineLower.includes('track') || 
                lineLower.includes('item') ||
                lineLower.includes('way'));
      });
      
      statusText = lines.join('\n').trim();
      
      // If we still don't have good content, use all page text
      if (!statusText || statusText.length < 50) {
        statusText = allPageText;
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
    
    // PRIORITY 1: Check for DELIVERED status (VERY STRICT - only past tense, completed delivery)
    // Must have MULTIPLE indicators to avoid false positives
    
    // First, check for explicit future delivery phrases - if found, it's SCANNED, not DELIVERED
    const futureDeliveryIndicators = [
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
    ];
    
    let hasFutureIndicator = false;
    for (const indicator of futureDeliveryIndicators) {
      if (searchText.includes(indicator)) {
        hasFutureIndicator = true;
        break;
      }
    }
    
    // If we have ANY future delivery indicator, it's definitely SCANNED, not DELIVERED
    if (hasFutureIndicator) {
      console.log(`[${trackingNumber}] Detected SCANNED status (has future delivery indicator)`);
      return { status: 'scanned', details: statusText.substring(0, 500) };
    }
    
    // Only check for delivered if we have NO future indicators
    // Require STRONG past-tense delivered phrases
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
    
    // Check for past tense "delivered" with word boundary (not "deliver")
    const deliveredRegex = /\b(delivered|delivery completed|successfully delivered)\b/i;
    const hasDeliveredKeyword = deliveredRegex.test(searchText);
    
    // Check for specific delivered phrases
    let hasDeliveredPhrase = false;
    for (const phrase of deliveredPhrases) {
      if (searchText.includes(phrase)) {
        hasDeliveredPhrase = true;
        break;
      }
    }
    
    // Only mark as delivered if:
    // 1. We have a specific delivered phrase OR the word "delivered" with proper context
    // 2. NO future delivery indicators
    // 3. NO "expect" or "will" in the text
    const hasNoFutureWords = !searchText.includes('expect') && 
                             !searchText.includes('will deliver') && 
                             !searchText.includes('to be delivered');
    
    if ((hasDeliveredPhrase || hasDeliveredKeyword) && hasNoFutureWords) {
      console.log(`[${trackingNumber}] Detected DELIVERED status`);
      return { status: 'delivered', details: statusText.substring(0, 500) };
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

