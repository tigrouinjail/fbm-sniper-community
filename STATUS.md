# Project Status

Last reviewed: 2026-05-16

## Working
- Discord webhook routing scaffold (`lib/shared-marketplace/notifier.js`) — sends test payloads fine.
- Local Electron dashboard shell — opens, persists watchlist, but every platform's fetch step is currently broken.

## Partially working / WIP
- **Facebook cars sniper** — `fb-scraper.js` worked through early May, then FB rotated the marketplace GraphQL endpoint mid-May. Old URL returns 404. New endpoint not yet identified (page bootstrap is heavily obfuscated). See FIXME at the top of `lib/fb-scraper.js`.
- **Wallapop sniper** — scaffold in place, API endpoint + device-id header changed since v2.0.0, listings come back empty.
- **Vinted sniper** — multi-region host map is correct, but cookie + CSRF flow broke around late April. See FIXMEs in `lib/vinted-sniper.js`.
- **Mercari sniper** — search endpoint structure outdated (`/v1/search` 404s), and the token refresh needs HMAC-signed nonce work that isn't done.
- **Facebook electronics sniper** — never finished; only the cars path was ever wired through `fb-scraper.js`, and even that's broken now.

## Not implemented
- Auto-update flow (mentioned in README but the actual `electron-updater` plumbing isn't here).
- Migration assistant from v1 watchlist format.
- Mercari iPhone-keyword detection ranking.

If you'd like to contribute on any of the WIP platforms, the structure is in place — PRs welcome.
