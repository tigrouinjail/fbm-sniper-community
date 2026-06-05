import axios from 'axios';
import https from 'https';
import { bootstrapSession, clearSession } from './fb-session.js';
import config from './fb-config.js';

const detailHttpsAgent = new https.Agent({ keepAlive: false });
import {
  randomDelay,
  parseFBPrice,
  buildListingUrl,
  generateRequestId,
  parseFBResponse,
} from './fb-utils.js';

const FB_GRAPHQL_URL = 'https://web.facebook.com/api/graphql/v2/';

function extractFeedUnits(parsed) {
  if (!parsed) return null;
  const direct = parsed?.data?.marketplace_search?.feed_units;
  if (direct?.edges) return direct;
  const viewer = parsed?.data?.viewer;
  if (viewer?.marketplace_search_feed_units?.edges) return viewer.marketplace_search_feed_units;
  const node = parsed?.data?.node;
  if (node?.marketplace_search?.feed_units?.edges) return node.marketplace_search.feed_units;
  const searchResults = parsed?.data?.marketplace_search_results;
  if (searchResults?.edges) return searchResults;
  return deepFindFeedUnits(parsed?.data);
}

function deepFindFeedUnits(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 5) return null;
  if (Array.isArray(obj.edges) && obj.edges.length > 0) {
    const sample = obj.edges[0]?.node;
    if (sample && (sample.listing || sample.marketplace_listing_title || sample.listing_price)) {
      return obj;
    }
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      const found = deepFindFeedUnits(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

const reqIdGen = generateRequestId();

function buildAxiosProxy(proxyUrl = null) {
  if (proxyUrl) {
    try {
      const parsed = new URL(proxyUrl);
      return {
        proxy: {
          host: parsed.hostname,
          port: Number(parsed.port),
          auth: parsed.username
            ? {
                username: decodeURIComponent(parsed.username),
                password: decodeURIComponent(parsed.password),
              }
            : undefined,
        },
      };
    } catch {
      return undefined;
    }
  }
  if (!config.proxy.enabled || !config.proxy.host) return undefined;
  return {
    proxy: {
      host: config.proxy.host,
      port: Number(config.proxy.port),
      auth: config.proxy.username
        ? { username: config.proxy.username, password: config.proxy.password }
        : undefined,
    },
  };
}

async function graphqlRequest(session, variables, docId, friendlyName, proxyUrl = null) {
  const reqId = reqIdGen.next().value;
  const params = new URLSearchParams({
    av: '0',
    __user: '0',
    __a: '1',
    __dyn: session.tokens.__dyn || '',
    __csr: session.tokens.__csr || '',
    __req: reqId,
    __pc: 'PHASED:DEFAULT',
    dpr: '1',
    __rev: session.tokens.__rev || '',
    __s: '',
    __hsi: session.tokens.__hsi || '',
    lsd: session.tokens.lsd || '',
    jazoest: session.tokens.jazoest || '',
    __spin_r: session.tokens.__spin_r || '',
    __spin_b: session.tokens.__spin_b || '',
    __spin_t: session.tokens.__spin_t || '',
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: friendlyName,
    variables: JSON.stringify(variables),
    doc_id: docId,
  });

  const axiosConfig = {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: '*/*',
      'accept-language': 'en-US,en;q=0.9',
      'accept-encoding': 'gzip, deflate',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'user-agent': session.userAgent,
      cookie: session.cookies,
      referer: 'https://www.facebook.com/marketplace/search/?query=iphone',
      origin: 'https://www.facebook.com',
      'x-fb-friendly-name': friendlyName,
    },
    responseType: 'text',
    ...buildAxiosProxy(proxyUrl),
  };

  const response = await axios.post(FB_GRAPHQL_URL, params.toString(), axiosConfig);
  return parseFBResponse(response.data);
}

export async function searchMarketplace({
  query,
  lat = config.location.latitude,
  lng = config.location.longitude,
  radiusKM = config.search.defaultRadiusKM,
  minPrice = 0,
  maxPrice = 1000000,
  sort = config.search.defaultSort,
  maxPages = config.search.maxPages,
  conditions = [],
  daysSinceListed = null,
  proxyUrl = null,
} = {}) {
  const defaultProxy = config.proxy.enabled ? `http://${config.proxy.username}:${config.proxy.password}@${config.proxy.host}:${config.proxy.port}` : null;
  const effectiveProxy = proxyUrl || defaultProxy;
  const session = await bootstrapSession(effectiveProxy);

  const docIdCandidates = [];
  if (session.docIds.searchRoot) docIdCandidates.push({ id: session.docIds.searchRoot, name: 'CometMarketplaceSearchRootQuery' });
  if (session.docIds.searchContent) docIdCandidates.push({ id: session.docIds.searchContent, name: 'CometMarketplaceSearchContentContainerQuery' });
  if (session.docIds.search && !docIdCandidates.find((c) => c.id === session.docIds.search)) {
    docIdCandidates.push({ id: session.docIds.search, name: 'CometMarketplaceSearchRootQuery' });
  }

  if (!docIdCandidates.length) {
    throw new Error(
      '[fb-scraper] No search doc_id available. Session bootstrap could not discover one.'
    );
  }

  const listings = [];
  let cursor = null;
  let pageNum = 0;
  let retries = 0;

  const conditionEnums = conditions
    .map((c) => ({
      new: 'NEW',
      used_like_new: 'USED_LIKE_NEW',
      used_good: 'USED_GOOD',
      used_fair: 'USED_FAIR',
      used_poor: 'USED_POOR',
    }[c] || c.toUpperCase()))
    .filter(Boolean);

  const builtFilters = [];
  if (conditionEnums.length) {
    builtFilters.push({ name: 'item_condition', values: conditionEnums });
  }
  if (daysSinceListed != null) {
    builtFilters.push({ name: 'days_since_listed', values: [String(daysSinceListed)] });
  }

  while (pageNum < maxPages) {
    const variables = {
      buyLocation: { latitude: lat, longitude: lng },
      categoryIDArray: [],
      count: config.search.resultsPerPage,
      cursor,
      filters: builtFilters,
      hideItemsSoldByPage: false,
      priceRange: [minPrice, maxPrice],
      query,
      radiusKM,
      savedSearchID: null,
      sortOrder: sort,
      topicPageParams: { topicPageID: null, url: null },
      vehicleParams: null,
    };

    const capturedVars = session.docIds._capturedVariables;
    if (capturedVars) {
      for (const key of Object.keys(capturedVars)) {
        if (!(key in variables)) variables[key] = capturedVars[key];
      }
      if (capturedVars.params) {
        variables.params = JSON.parse(JSON.stringify(capturedVars.params));
        if (variables.params.bqf) variables.params.bqf.query = query;
        if (variables.params.browse_request_params) {
          const brp = variables.params.browse_request_params;
          brp.filter_location_latitude = lat;
          brp.filter_location_longitude = lng;
          brp.filter_radius_km = radiusKM;
          brp.filter_price_lower_bound = minPrice;
          brp.filter_price_upper_bound = maxPrice;
          brp.filter_sort_by = sort;
          if (conditionEnums.length) brp.filter_item_condition = conditionEnums;
          if (daysSinceListed != null) {
            brp.filter_date_listed_range_days = daysSinceListed;
          }
        }
      }
    }

    let parsed = null;
    let lastError = null;

    for (const candidate of docIdCandidates) {
      try {
        parsed = await graphqlRequest(session, variables, candidate.id, candidate.name, effectiveProxy);
        const errors = parsed?.errors || [];
        const staleDocId = errors.some((e) => e?.message?.includes('was not found'));
        if (staleDocId) {
          parsed = null;
          continue;
        }
        const feedUnits = extractFeedUnits(parsed);
        if (feedUnits) break;
        parsed = null;
      } catch (err) {
        lastError = err;
        const status = err?.response?.status;
        const data = err?.response?.data || '';
        if (status === 429 || String(data).includes('1675004')) {
          if (retries >= config.timing.maxRetries) {
            throw new Error('[fb-scraper] Rate limited / IP blocked (error 1675004).');
          }
          const backoff = config.timing.retryDelay * Math.pow(2, retries);
          await randomDelay(backoff, backoff + 5000);
          retries++;
          clearSession(effectiveProxy);
          break;
        }
      }
    }

    if (!parsed) {
      if (retries > 0) continue;
      if (lastError) throw lastError;
      break;
    }

    retries = 0;
    const feedUnits = extractFeedUnits(parsed);
    if (!feedUnits) break;

    const edges = feedUnits.edges || [];
    for (const edge of edges) {
      const listing = edge?.node?.listing || edge?.node;
      if (listing) listings.push(normalizeListing(listing));
    }

    const pageInfo = feedUnits.page_info;
    if (!pageInfo?.has_next_page || !pageInfo.end_cursor) break;
    cursor = pageInfo.end_cursor;
    pageNum++;
    if (pageNum < maxPages) {
      await randomDelay(config.timing.minDelayBetweenRequests, config.timing.maxDelayBetweenRequests);
    }
  }

  return { listings, totalFound: listings.length };
}

export async function getListingDetail(listingId, sessionCookies, proxyUrl = null) {
  const defaultProxy = config.proxy.enabled ? `http://${config.proxy.username}:${config.proxy.password}@${config.proxy.host}:${config.proxy.port}` : null;
  const effectiveProxy = proxyUrl || defaultProxy;
  const session = await bootstrapSession(effectiveProxy);

  if (session.docIds.detail) {
    const capturedPdpVars = session.docIds._pdpVariables;
    const variables = capturedPdpVars
      ? { ...capturedPdpVars, listingID: listingId }
      : { listingID: listingId, scale: 2 };

    try {
      const parsed = await graphqlRequest(
        session,
        variables,
        session.docIds.detail,
        'MarketplacePDPContainerQuery',
        effectiveProxy
      );
      const detail =
        parsed?.data?.viewer?.marketplace_product_details_page?.target ||
        parsed?.data?.marketplace_product_details_page?.target ||
        parsed?.data?.node ||
        parsed?.data?.listing;
      if (detail) return detail;
    } catch (err) {
      console.warn(`[fb-scraper] GraphQL detail failed for ${listingId}: ${err.message}`);
    }
  }

  const url = `https://www.facebook.com/marketplace/item/${listingId}/`;
  const htmlFetchConfig = {
    headers: {
      'User-Agent': session.userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
      'Accept-Encoding': 'gzip, deflate',
      'Cache-Control': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Upgrade-Insecure-Requests': '1',
      'Connection': 'close',
      'cookie': sessionCookies || session.cookies,
    },
    timeout: 30000,
    responseType: 'text',
    maxRedirects: 5,
    httpsAgent: detailHttpsAgent,
    ...buildAxiosProxy(effectiveProxy),
  };

  let html = '';
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const htmlResp = await axios.get(url, htmlFetchConfig);
      html = htmlResp.data || '';
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || '');
      const retriable = msg === 'aborted' || /ECONNRESET|socket hang up|ETIMEDOUT|EAI_AGAIN|timeout/i.test(msg);
      if (!retriable || attempt === 2) break;
      await randomDelay(800 + attempt * 600, 1600 + attempt * 900);
    }
  }

  if (!html) {
    console.warn(`[fb-scraper] HTML detail fetch failed for ${listingId}: ${lastErr?.message || 'no response'}`);
    return null;
  }

  try {
    const ogDesc = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/)?.[1] || '';
    const ogImage = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/)?.[1] || '';

    const description = ogDesc
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&#39;/g, "'");

    const photos = [];
    const lpKey = '"listing_photos":[';
    const lpStart = html.indexOf(lpKey);
    if (lpStart !== -1) {
      let depth = 0;
      let i = lpStart + lpKey.length - 1;
      const arrayStart = i;
      for (; i < html.length; i++) {
        if (html[i] === '[') depth++;
        else if (html[i] === ']') { depth--; if (depth === 0) break; }
      }
      const section = html.slice(arrayStart, i + 1);
      const uriMatches = [...section.matchAll(/"uri"\s*:\s*"([^"]+)"/g)];
      for (const m of uriMatches) {
        let uri;
        try { uri = JSON.parse('"' + m[1] + '"'); }
        catch { uri = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/'); }
        if (uri && !photos.includes(uri)) photos.push(uri);
      }
    }
    if (photos.length === 0 && ogImage) photos.push(ogImage);

    const ctMatch = html.match(/"creation_time"\s*:\s*(\d+)/);
    const creationTime = ctMatch ? parseInt(ctMatch[1], 10) : null;

    const sellerMatch = html.match(/"seller_name"\s*:\s*"([^"]+)"/) ||
                        html.match(/"display_name"\s*:\s*"([^"]+)"/);
    const sellerName = sellerMatch?.[1] || '';

    return {
      redacted_description: { text: description },
      description,
      listing_photos: photos.map((uri) => ({ image: { uri } })),
      creation_time: creationTime,
      marketplace_listing_seller: sellerName ? { name: sellerName } : null,
      _source: 'html_scrape',
    };
  } catch (err) {
    console.warn(`[fb-scraper] HTML detail parse failed for ${listingId}: ${err.message}`);
    return null;
  }
}

export function mergeDetail(searchListing, rawDetail) {
  if (!rawDetail) return searchListing;
  const description =
    rawDetail.redacted_description?.text ||
    rawDetail.description?.text ||
    rawDetail.description ||
    searchListing.description || '';

  const detailPhotos =
    rawDetail.listing_photos ||
    rawDetail.photos ||
    rawDetail.media_photos || [];
  const detailPhotoUris = [];
  for (const p of detailPhotos) {
    const uri = p?.image?.uri || p?.image?.url || p?.uri;
    if (uri && !detailPhotoUris.includes(uri)) detailPhotoUris.push(uri);
  }
  const photos = detailPhotoUris.length > 0 ? detailPhotoUris : [...searchListing.photos];

  const sellerRaw =
    rawDetail.marketplace_listing_seller ||
    rawDetail.seller ||
    rawDetail.author || {};
  const sellerName =
    sellerRaw.name ||
    sellerRaw.display_name ||
    searchListing.seller.name;
  const sellerId = sellerRaw.id || searchListing.seller.id;

  const postedAt =
    rawDetail.creation_time
      ? new Date(rawDetail.creation_time * 1000).toISOString()
      : rawDetail.listed_time
      ? new Date(rawDetail.listed_time * 1000).toISOString()
      : searchListing.postedAt;

  return {
    ...searchListing,
    description,
    photos,
    seller: { ...searchListing.seller, name: sellerName, id: sellerId },
    postedAt,
    _rawDetail: rawDetail,
  };
}

export function normalizeListing(fbListing) {
  if (!fbListing) return null;
  const id = fbListing.id || fbListing.listing_id || fbListing.target?.id || '';
  const title =
    fbListing.marketplace_listing_title ||
    fbListing.listing_title ||
    fbListing.name ||
    fbListing.title || '';
  const priceObj = fbListing.listing_price || fbListing.price;
  const priceCents = parseFBPrice(priceObj);
  const priceAmount = priceCents !== null ? priceCents / 100 : null;
  const currency = priceObj?.currency || priceObj?.amount_with_offset_in_currency?.currency || 'EUR';

  const locationData =
    fbListing.location?.reverse_geocode ||
    fbListing.listing_location?.reverse_geocode ||
    fbListing.location || {};
  const city =
    locationData.city ||
    locationData.city_page?.name ||
    locationData.neighborhood || '';
  const state =
    locationData.state ||
    locationData.state_abbreviation ||
    locationData.region || '';

  const sellerRaw =
    fbListing.marketplace_listing_seller ||
    fbListing.seller ||
    fbListing.author || {};
  const sellerName =
    sellerRaw.name || sellerRaw.display_name || '';
  const sellerId = sellerRaw.id || sellerRaw.marketplace_seller_id || '';

  const photos = [];
  const primaryUri =
    fbListing.primary_listing_photo?.image?.uri ||
    fbListing.primary_listing_photo?.image?.url ||
    fbListing.cover_photo?.image?.uri;
  if (primaryUri) photos.push(primaryUri);

  const allPhotos =
    fbListing.listing_photos ||
    fbListing.photos ||
    fbListing.media_photos || [];
  for (const p of allPhotos) {
    const uri = p?.image?.uri || p?.image?.url || p?.uri;
    if (uri && !photos.includes(uri)) photos.push(uri);
  }

  let condition = null;
  const subTitles = fbListing.custom_sub_titles_with_rendering_flags || [];
  let shippingOffered = Boolean(
    fbListing.is_shipping_offered ||
    fbListing.shipping_offered ||
    fbListing.marketplace_shipping_eligible ||
    fbListing.marketplace_shipping_seller_eligible ||
    fbListing.shipping_eligible
  );
  let shippingText = '';
  for (const sub of subTitles) {
    const text = sub?.subtitle || sub?.text || '';
    if (!condition && /bueno|buen estado|good|fair|excellent|nuevo|new|usado|used|like new/i.test(text)) {
      condition = text.trim();
    }
    if (!shippingOffered && /ship|shipping|delivery|pickup/i.test(text)) {
      shippingOffered = /ship|shipping|delivery/i.test(text);
      shippingText = text.trim();
    }
  }
  if (!condition) {
    condition =
      fbListing.condition ||
      fbListing.listing_condition?.display_name ||
      null;
  }

  const description =
    fbListing.redacted_description?.text ||
    fbListing.description?.text ||
    fbListing.description || '';

  if (!shippingText) {
    shippingText =
      fbListing.shipping_label?.text ||
      fbListing.shipping_label ||
      fbListing.delivery_type ||
      fbListing.delivery_method || '';
  }

  const creationTime =
    fbListing.creation_time ||
    fbListing.listed_time ||
    fbListing.created_time ||
    null;

  return {
    id,
    title,
    price: priceAmount,
    currency,
    description,
    photos,
    seller: {
      name: sellerName || 'Unknown',
      id: sellerId,
      location: [city, state].filter(Boolean).join(', '),
    },
    condition,
    postedAt: creationTime ? new Date(creationTime * 1000).toISOString() : null,
    isPending: fbListing.is_pending || false,
    shippingOffered,
    shippingText,
    url: buildListingUrl(id),
    source: 'facebook',
  };
}