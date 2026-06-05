/**
 * Facebook Marketplace Scraper — Utilities
 */

export function randomDelay(min, max) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseFBPrice(priceObj) {
  if (!priceObj) return null;
  const raw = priceObj.amount ?? priceObj.formatted_amount ?? '';
  const numeric = String(raw).replace(/[^0-9.]/g, '');
  if (!numeric) return null;
  return Math.round(parseFloat(numeric) * 100);
}

export function buildListingUrl(listingId) {
  return `https://www.facebook.com/marketplace/item/${listingId}/`;
}

export function rotateCookieString(cookies) {
  if (!cookies || !cookies.length) return '';
  if (typeof cookies === 'string') return cookies;
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

export function* generateRequestId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let n = 0;
  while (true) {
    let id = '';
    let tmp = n;
    do {
      id = chars[tmp % 26] + id;
      tmp = Math.floor(tmp / 26) - 1;
    } while (tmp >= 0);
    yield id;
    n++;
  }
}

export function parseFBResponse(raw) {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  try {
    const parsed = JSON.parse(text);
    return parsed;
  } catch (_) {}

  const lines = text.split('\n').filter((l) => l.trim().startsWith('{'));
  let first = null;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (!first) first = parsed;
      if (parsed?.data?.marketplace_search) return parsed;
    } catch (_) {}
  }
  return first;
}