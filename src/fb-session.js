/**
 * Facebook Marketplace Scraper — Session Bootstrapper
 */
import { rotateCookieString } from './fb-utils.js';
import config from './fb-config.js';

const _cachedSessions = new Map();
const _pendingSessions = new Map();

const TOKEN_PATTERNS = {
  lsd: [
    /"LSD",\[\],\{"token":"([^"]+)"\}/,
    /\[ "LSD",\[\],\{"token":"([^"]+)"\}/,
    /name="lsd"\s+value="([^"]+)"/,
    /"lsd":"([^"]+)"/,
  ],
  fb_dtsg: [
    /"DTSGInitialData",\[\],\{"token":"([^"]+)"\}/,
    /"DTSGInitData",\[\],\{"token":"([^"]+)"\}/,
    /"dtsg":\{"token":"([^"]+)"\}/,
    /"fb_dtsg":"([^"]+)"/,
  ],
  jazoest: [
    /jazoest=(\d+)/,
    /name="jazoest"\s+value="(\d+)"/,
    /"jazoest":"(\d+)"/,
  ],
  __dyn: [ /&__dyn=([^&"'\s]+)/, /"__dyn":"([^"]+)"/ ],
  __csr: [ /&__csr=([^&"'\s]+)/, /"__csr":"([^"]+)"/ ],
  __rev: [ /"server_revision":(\d+)/, /"__rev":(\d+)/ ],
  __hsi: [ /"__hsi":"(\d+)"/, /&__hsi=(\d+)/ ],
  __spin_r: [ /"__spin_r":(\d+)/ ],
  __spin_b: [ /"__spin_b":"([^"]+)"/ ],
  __spin_t: [ /"__spin_t":(\d+)/ ],
};

function extractToken(source, patterns) {
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match && match[1]) return match[1];
  }
  return null;
}

export async function bootstrapSession(proxyUrl = null) {
  const cacheKey = proxyUrl || '__direct__';
  const cached = _cachedSessions.get(cacheKey) || null;
  if (cached) {
    const age = Date.now() - cached.timestamp;
    if (age < config.timing.sessionRefreshInterval) {
      return cached;
    }
  }
  if (_pendingSessions.has(cacheKey)) {
    return _pendingSessions.get(cacheKey);
  }

  const bootstrapPromise = (async () => {
    let puppeteer;
    try {
      puppeteer = (await import('puppeteer')).default;
    } catch (e) {
      throw new Error('puppeteer is not installed. Run: npm install puppeteer');
    }

    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1366,768',
    ];
    if (proxyUrl) launchArgs.push(`--proxy-server=${proxyUrl}`);

    const browser = await puppeteer.launch({ headless: 'new', args: launchArgs });
    const page = await browser.newPage();

    await page.setViewport({ width: 1280, height: 720 });
    const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
    await page.setUserAgent(userAgent);

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      delete navigator.__proto__.webdriver;
    });

    const discoveredDocIds = {};
    const capturedTokensFromNetwork = {};

    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');

    cdp.on('Network.requestWillBeSent', (event) => {
      const { url, postData } = event.request;
      if (!url.includes('/api/graphql/') || !postData) return;

      const docMatch = postData.match(/doc_id=(\d+)/);
      const nameMatch = postData.match(/fb_api_req_friendly_name=([^&]+)/);

      if (docMatch) {
        const docId = docMatch[1];
        const name = nameMatch ? decodeURIComponent(nameMatch[1]) : '';
        if (/CometMarketplaceSearchContentContainerQuery/i.test(name)) discoveredDocIds.searchContent = docId;
        if (/CometMarketplaceSearchRootQuery/i.test(name)) discoveredDocIds.searchRoot = docId;
        if (/MarketplacePDP|MarketplaceProductDetail|PDPContainer/i.test(name)) discoveredDocIds.detail = docId;
        discoveredDocIds.search = discoveredDocIds.searchRoot || discoveredDocIds.searchContent || docId;
      }

      for (const key of ['__dyn', '__csr', '__hsi', 'lsd', 'jazoest', '__rev', '__spin_r', '__spin_b', '__spin_t']) {
        const re = new RegExp(`(?:^|&)${key}=([^&]+)`);
        const m = postData.match(re);
        if (m && m[1]) capturedTokensFromNetwork[key] = decodeURIComponent(m[1]);
      }
    });

    try {
      await page.goto('https://www.facebook.com/marketplace/', { waitUntil: 'networkidle2', timeout: 45000 });

      // Accept cookies
      try {
        for (const selector of ['[data-testid="cookie-policy-manage-dialog-accept-button"]', '[data-cookiebanner="accept_button"]']) {
          const btn = await page.$(selector);
          if (btn) { await btn.click(); break; }
        }
      } catch (_) {}

      await page.goto('https://www.facebook.com/marketplace/search/?query=iphone&sortBy=creation_time_descend', { waitUntil: 'networkidle2', timeout: 30000 });
      await page.evaluate(() => window.scrollBy(0, 800));
      await new Promise(r => setTimeout(r, 2000));

      const html = await page.content();
      const allScriptText = await page.evaluate(() => [...document.querySelectorAll('script')].map(s => s.textContent || '').join('\n'));
      const fullSource = html + '\n' + allScriptText;

      const tokens = {};
      for (const [key, patterns] of Object.entries(TOKEN_PATTERNS)) {
        tokens[key] = extractToken(fullSource, patterns);
      }
      for (const [key, value] of Object.entries(capturedTokensFromNetwork)) {
        if (!tokens[key] && value) tokens[key] = value;
      }

      const cookiesArr = await page.cookies();
      const cookieString = rotateCookieString(cookiesArr);

      const session = {
        tokens,
        cookies: cookieString,
        cookiesArr,
        userAgent,
        docIds: discoveredDocIds,
        timestamp: Date.now(),
      };
      _cachedSessions.set(cacheKey, session);

      return session;
    } finally {
      await browser.close();
    }
  })();

  _pendingSessions.set(cacheKey, bootstrapPromise);
  try {
    return await bootstrapPromise;
  } finally {
    _pendingSessions.delete(cacheKey);
  }
}

export function clearSession(proxyUrl = null) {
  const cacheKey = proxyUrl || '__direct__';
  _cachedSessions.delete(cacheKey);
  _pendingSessions.delete(cacheKey);
}

export function getCachedSession(proxyUrl = null) {
  return _cachedSessions.get(proxyUrl || '__direct__') || null;
}