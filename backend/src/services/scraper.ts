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
    
    // Set user agent to avoid detection
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    
    // Navigate to Royal Mail tracking page
    const trackingUrl = `https://www.royalmail.com/track-your-item#/tracking-results/${trackingNumber}`;
    await page.goto(trackingUrl, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    // Wait a bit for dynamic content to load
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Try to find tracking status on the page
    // Royal Mail uses various selectors, we'll try multiple approaches
    let statusText = '';
    
    try {
      // Try to find status in common locations
      const statusSelectors = [
        '.tracking-status',
        '.status-text',
        '[data-testid="tracking-status"]',
        '.tracking-result-status',
        'h2',
        'h3',
        '.status',
      ];
      
      for (const selector of statusSelectors) {
        try {
          const element = await page.$(selector);
          if (element) {
            statusText = await page.evaluate((el) => el.textContent?.trim() || '', element);
            if (statusText) break;
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      
      // If no specific status element found, get page text
      if (!statusText) {
        statusText = await page.evaluate(() => {
          // @ts-ignore - document is available in browser context
          return document.body.innerText || '';
        });
      }
    } catch (error) {
      console.error(`Error extracting status for ${trackingNumber}:`, error);
    }
    
    // Map Royal Mail statuses to our three states
    const statusTextLower = statusText.toLowerCase();
    
    // Check for delivered status
    if (
      statusTextLower.includes('delivered') ||
      statusTextLower.includes('delivery completed') ||
      statusTextLower.includes('signed for') ||
      statusTextLower.includes('item delivered')
    ) {
      return { status: 'delivered', details: statusText };
    }
    
    // Check for scanned/in-transit status
    if (
      statusTextLower.includes('in transit') ||
      statusTextLower.includes('out for delivery') ||
      statusTextLower.includes('at delivery office') ||
      statusTextLower.includes('on its way') ||
      statusTextLower.includes('collected') ||
      statusTextLower.includes('accepted') ||
      statusTextLower.includes('processed') ||
      statusTextLower.includes('dispatched') ||
      statusTextLower.includes('in the post') ||
      statusTextLower.includes('tracking information')
    ) {
      return { status: 'scanned', details: statusText };
    }
    
    // Check for not found / not scanned
    if (
      statusTextLower.includes('not found') ||
      statusTextLower.includes('no tracking information') ||
      statusTextLower.includes('unable to find') ||
      statusTextLower.includes('please check') ||
      statusTextLower.length < 20 // Very short text likely means no info
    ) {
      return { status: 'not_scanned', details: statusText || 'No tracking information available' };
    }
    
    // Default: if we got some text but can't categorize, assume scanned
    if (statusText.length > 20) {
      return { status: 'scanned', details: statusText };
    }
    
    // Default to not_scanned if we can't determine
    return { status: 'not_scanned', details: 'Unable to determine status' };
    
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

