import puppeteer, { Browser, Page } from 'puppeteer';
import { TrackingStatus } from '../models/tracking';

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: 'new', // Use new headless mode (less detectable)
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled', // Hide automation
        '--window-size=1920,1080',
      ],
    });
  }
  return browser;
}

export async function checkRoyalMailStatus(trackingNumber: string): Promise<{
  status: TrackingStatus;
  details?: string;
  statusHeader?: string;
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
    
    // Instead of using hash routing (which doesn't work reliably), use the search form
    console.log(`[${trackingNumber}] Navigating to Royal Mail tracking page`);
    
    await page.goto('https://www.royalmail.com/track-your-item', { 
      waitUntil: 'networkidle0',
      timeout: 45000 
    });
    
    console.log(`[${trackingNumber}] Page loaded, looking for search form...`);
    
    // Wait for the tracking number input field to appear
    try {
      await page.waitForSelector('input[type="text"], input[name*="track"], input[id*="track"]', { 
        timeout: 10000,
        visible: true 
      });
      
      console.log(`[${trackingNumber}] Found input field, entering tracking number...`);
      
      // Find and fill the tracking number input
      await page.evaluate((tn) => {
        // @ts-ignore
        const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
        // Find the tracking number input (usually has placeholder or label about tracking)
        const trackingInput = inputs.find(input => {
          // @ts-ignore
          const placeholder = input.getAttribute('placeholder') || '';
          // @ts-ignore
          const label = input.getAttribute('aria-label') || '';
          return placeholder.toLowerCase().includes('track') || 
                 placeholder.toLowerCase().includes('reference') ||
                 label.toLowerCase().includes('track') ||
                 label.toLowerCase().includes('reference');
        });
        
        if (trackingInput) {
          // @ts-ignore
          trackingInput.value = tn;
          // @ts-ignore
          trackingInput.dispatchEvent(new Event('input', { bubbles: true }));
          // @ts-ignore
          trackingInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, trackingNumber);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Click the track/search button
      console.log(`[${trackingNumber}] Looking for submit button...`);
      const buttonClicked = await page.evaluate(() => {
        // @ts-ignore
        const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], a[role="button"]'));
        const trackButton = buttons.find(btn => {
          // @ts-ignore
          const text = btn.textContent || btn.getAttribute('value') || '';
          return text.toLowerCase().includes('track') || 
                 text.toLowerCase().includes('search') ||
                 text.toLowerCase().includes('submit');
        });
        
        if (trackButton) {
          // @ts-ignore
          trackButton.click();
          return true;
        }
        return false;
      });
      
      if (buttonClicked) {
        console.log(`[${trackingNumber}] Clicked track button, waiting for results...`);
      } else {
        console.warn(`[${trackingNumber}] Could not find track button, trying Enter key...`);
        await page.keyboard.press('Enter');
      }
      
      // Add a longer initial wait after clicking (Royal Mail may be slow)
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Check current URL to see if navigation happened
      const currentUrl = page.url();
      console.log(`[${trackingNumber}] Current URL after click: ${currentUrl}`);
      
      // Wait for results to load
      let contentLoaded = false;
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const pageInfo = await page.evaluate(() => {
          // @ts-ignore
          const bodyText = document.body.innerText || '';
          const hasResults = bodyText.includes('We\'ve got it') || 
                 bodyText.includes('expect to deliver') || 
                 bodyText.includes('have your item at') ||
                 bodyText.includes('Tracking number:') ||
                 bodyText.includes('Service used:');
          
          return {
            hasResults,
            textLength: bodyText.length,
            snippet: bodyText.substring(0, 200)
          };
        });
        
        if (pageInfo.hasResults) {
          contentLoaded = true;
          console.log(`[${trackingNumber}] ✅ Tracking results appeared after ${i + 3} seconds`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          break;
        }
        
        if ((i + 1) % 5 === 0) {
          console.log(`[${trackingNumber}] Still waiting for results... (${i + 3}s) - Text length: ${pageInfo.textLength}`);
        }
      }
      
      if (!contentLoaded) {
        console.warn(`[${trackingNumber}] ⚠️ Tracking results didn't appear within 23 seconds`);
        // Take a screenshot for debugging (save to /tmp in container)
        try {
          await page.screenshot({ path: `/tmp/rm-tracking-${trackingNumber.replace(/\s/g, '')}.png` });
          console.log(`[${trackingNumber}] Screenshot saved to /tmp/rm-tracking-${trackingNumber.replace(/\s/g, '')}.png`);
        } catch (e) {
          console.error(`[${trackingNumber}] Failed to save screenshot:`, e);
        }
      }
      
    } catch (error) {
      console.error(`[${trackingNumber}] Error interacting with search form:`, error);
      console.log(`[${trackingNumber}] Falling back to direct URL method...`);
      
      // Fallback: try the direct hash URL
      const trackingUrl = `https://www.royalmail.com/track-your-item#/tracking-results/${trackingNumber}`;
      await page.goto(trackingUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    // Extract status information from the page
    // Get all page text and filter out UI elements
    let statusText = '';
    let allPageText = '';
    let statusHeader = '';
    
    try {
      // Get all page text
      allPageText = await page.evaluate(() => {
        // @ts-ignore - document is available in browser context
        return document.body.innerText || '';
      });
      
      // Try to extract the status header (like "We've got it", "Item delivered", etc.)
      statusHeader = await page.evaluate(() => {
        // @ts-ignore - document is available in browser context
        const h1 = document.querySelector('h1');
        // @ts-ignore
        const h2 = document.querySelector('h2');
        // @ts-ignore
        const h3 = document.querySelector('h3');
        
        // Get the first heading that looks like a status
        const heading = h1 || h2 || h3;
        if (heading) {
          const text = heading.innerText?.trim() || '';
          // Filter out generic headings
          if (text && 
              text.length < 100 && 
              !text.toLowerCase().includes('royal mail') &&
              !text.toLowerCase().includes('track your item')) {
            return text;
          }
        }
        return '';
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
      
      // Log extracted header for debugging
      if (statusHeader) {
        console.log(`[${trackingNumber}] Extracted status header: ${statusHeader}`);
      }
      
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
      'we\'ve got it',
      'we have got it',
      'got it',
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
      return { 
        status: 'scanned', 
        details: statusText.substring(0, 500),
        statusHeader: statusHeader || undefined
      };
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
      return { 
        status: 'delivered', 
        details: statusText.substring(0, 500),
        statusHeader: statusHeader || undefined
      };
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
        return { 
          status: 'not_scanned', 
          details: statusText.substring(0, 500) || 'No tracking information available',
          statusHeader: statusHeader || undefined
        };
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
      'we\'ve got it',
      'we have got it',
      'got it',
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
      return { 
        status: 'scanned', 
        details: statusText.substring(0, 500),
        statusHeader: statusHeader || undefined
      };
    }
    
    // If we have substantial content but no clear indicators, check if it looks like tracking info
    if (statusText.length > 100 && searchText.includes('tracking')) {
      // Has tracking info but unclear status - default to scanned if we have dates/times
      const hasDateOrTime = /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}:\d{2}/.test(statusText);
      if (hasDateOrTime) {
        console.log(`[${trackingNumber}] Detected SCANNED status (has tracking info with dates)`);
        return { 
          status: 'scanned', 
          details: statusText.substring(0, 500),
          statusHeader: statusHeader || undefined
        };
      }
    }
    
    // Default: if we can't determine, return not_scanned (safer than assuming scanned)
    console.log(`[${trackingNumber}] Unable to determine status, defaulting to NOT_SCANNED`);
    return { 
      status: 'not_scanned', 
      details: statusText.substring(0, 500) || 'Unable to determine status from page content',
      statusHeader: statusHeader || undefined
    };
    
  } catch (error) {
    console.error(`Error checking status for ${trackingNumber}:`, error);
    // On error, return not_scanned (safer default)
    return { 
      status: 'not_scanned', 
      details: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
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

