# AGENTS.md

## Repo Purpose

This repository contains a GNOME Shell extension that shows market tickers in the top bar.
The default ticker list is defined in `utils/settings.js`, and the curated suggestion catalog is defined under `utils/catalog/`.

## Key Files

- `extension.js`: extension lifecycle orchestration, panel registration, service startup/shutdown
- `prefs.js`: GNOME preferences window for ticker configuration, refresh cadence, and display options
- `ui/indicator.js`: panel indicator rendering
- `services/quotes.js`: settings-backed provider orchestration, quote storage, and entry updates
- `services/quote-store.js`: in-memory quote cache and refresh-cadence timestamps for normalized symbols
- `services/entry-model.js`: panel entry/view-model building, including loading/error states and price-flash decoration
- `services/quote-update-scheduler.js`: refresh timer, throttled entry rebuilds, price-flash reset, and network recovery for `QuotesService`
- `providers/market-quotes.js`: CNBC-first market refresh with narrow Nasdaq and FX-rate-table fallbacks
- `providers/http.js`: shared Soup transport with one timeout policy and request headers
- `providers/cnbc/quotes.js`: batched CNBC parsing and FX derivation from USD spot rates
- `providers/cnbc/symbols.js`: catalog-symbol-to-CNBC grammar mapping, including direct DXY
- `providers/nasdaq.js`: fallback for U.S. listings plus NDX; foreign symbols could resolve to differently-priced ADRs
- `providers/open-er-api.js`: daily USD rate-table fallback for a missing CNBC FX vector
- `providers/live-websocket-provider.js`: shared websocket connect, reconnect, routing, and watchdog lifecycle
- `providers/kraken/`: Kraken catalog, symbol grammar, quote parsing, and runtime provider
- `providers/hyperliquid/`: Hyperliquid catalog, symbol grammar, quote parsing, and runtime provider
- `README.md`: user-facing setup notes, ticker add flow, and curated catalog editing guide
- `CODE_STYLE_GUIDE.md`: repo-local coding and commenting contract intended to be understandable by human contributors and coding agents
- `utils/format.js`: loading/error/quote entry formatting and color helpers
- `utils/asset-categories.js`: shared asset/provider taxonomy, market-session derivation, and live-ticker routing
- `utils/market-sessions.js`: compact market-session profile registry used by current ticker normalization and scheduling
- `utils/display-settings.js`: visibility defaults, separator/font options, and refresh-interval helpers
- `utils/market-schedule.js`: market-local trading windows and refresh-cadence rules
- `utils/panel-sides.js`: shared left/right panel-side constants used by settings, ticker normalization, and UI flows
- `utils/settings.js`: shared settings defaults, validation, and settings-backed ticker/display loading
- `utils/ticker-config.js`: strict current saved-ticker normalization and serialization
- `utils/prefs/ticker-dialog-controller.js`: fixed-category catalog selection and ticker-dialog save orchestration
- `utils/display-density.js`: density estimation and mono-font scaling policy for crowded indicators
- `utils/ticker-catalog.js`: curated ticker aggregation and search helpers for guided prefs selection
- `utils/catalog/*.js`: curated ticker data split by asset category for contributor-friendly maintenance
- `utils/catalog/*-equity.js`: alphabetized country-level equity catalogs; mainland China and Hong Kong stay separate
- `utils/catalog/us-equity.js`: alphabetized curated U.S. equity catalog; keep symbols provider-verified and search keywords sensible
- `utils/catalog/us-etf.js`: alphabetized curated U.S. ETF catalog; keep symbols provider-verified and search keywords sensible
- `utils/catalog/commodity.js` and `utils/catalog/fx.js`: keep labels alphabetized and prefer verified symbols when adding or replacing entries
- `schemas/org.gnome.shell.extensions.ticker-tape.gschema.xml`: extension settings schema
- `metadata.json`: GNOME Shell extension metadata and compatibility
- `LICENSE`: GPL-2.0-or-later, matching GNOME Shell so extensions.gnome.org can distribute the extension
- `icon.png`: project logo for the extensions.gnome.org listing, which needs a raster upload; not shipped in the installed extension
- `icon.svg`: vector logo shown in the README, and the source the PNG is rendered from
- `install.sh`: copy-based local install, including runtime module directories
- `install-dev.sh`: symlink-based development install
- `pack.sh`: canonical release bundle builder; explicitly includes the complete runtime module tree
- `check.sh`: canonical lint, focused GJS test, and package-inventory verification entry point
- `check-shell.sh`: isolated packaged-extension lifecycle smoke test for GNOME Shell 49 and 50
- `tests/shell-smoke.js`: Shell-hosted enable/disable/enable check used by `check-shell.sh`
- `eslint.config.js`, `package.json`, and `package-lock.json`: pinned GNOME-aligned JavaScript lint toolchain
- `remove.sh`: remove installed extension
- `DEBUGGING_GUIDE.md`: debugging notes for extension behavior and API parsing

## Maintenance Rule

If a key repo file is created, renamed, or deleted, update this `AGENTS.md` file in the same change so the file map stays accurate.

## Data And API Conventions

- Non-crypto refreshes use CNBC, with Nasdaq for missed U.S. listings plus NDX and
  open.er-api.com for a missing FX vector. Kraken serves spot crypto;
  Hyperliquid serves perpetual futures.
- Catalog symbols keep their historical Stooq-style form (`aapl.us`, `700.hk`) because saved user settings contain them; `providers/cnbc/symbols.js` owns the translation to CNBC grammar.
- CNBC rejects well-known tool user agents, so direct checks need a custom UA;
  the README contains an example command.
- FX pairs derive from the per-currency CNBC USD spot vector (`EUR=`, `JPY=`, ...); DXY uses CNBC's direct `.DXY` quote.
- Keep catalog files alphabetical by `label`, and verify changed symbols with
  CNBC before committing them.
- Tickers may be split across panel sides via `panelSide`. Append left-side
  indicators after existing items so other extensions are not shifted.
- Prefer the batched quote endpoint for current prices.
- Maintain one persistent Kraken public WebSocket connection for all saved crypto pairs rather than opening one socket per ticker.
- Maintain one persistent Hyperliquid public WebSocket connection for all saved Hyperliquid perpetual markets rather than opening one socket per ticker.
- Keep disconnected live providers on the normal REST cadence and reconnect
  conservatively. Restored networking reconnects once and forces one refresh.
- Throttle crypto-driven UI updates so the top bar is not repainted on every trade.
- Previous close should be cached per symbol and invalidated based on the provider quote date, not the user's local timezone.
- Do not hard-code market open, pre-market, or rollover times using the local system clock.
- Treat crypto and index session boundaries according to the provider's returned date.
- Do an initial fetch for all tickers on startup so the panel can render immediately.
- Ongoing polling may skip US-session tickers on weekends using `America/New_York`, but always-open tickers like crypto should continue refreshing.
- Weekday-session tickers such as DXY, EUR/USD, and Gold should refresh on weekdays and skip weekend polling.
- Outside U.S. extended hours, U.S.-session tickers may refresh less often;
  use `America/New_York`, not the local system clock.
- When polling is skipped for a ticker, preserve and render its last known quote from in-memory cache.

## Editing Rules

- Preserve existing user changes unless explicitly asked to revert them.
- Prefer `rg` for file and text search.
- Use `apply_patch` for manual file edits.
- Keep code changes minimal and consistent with the current extension structure.
- Avoid destructive git commands unless explicitly requested.
- Follow `CODE_STYLE_GUIDE.md` when editing code comments and structure.
- Comment non-obvious ownership, provider, and lifecycle decisions; do not add comments merely to document every helper or export.

## Verification Notes

- GNOME Shell extension behavior is primarily driven by `extension.js`.
- After changing extension code, verify by reinstalling or reloading the extension in GNOME Shell as appropriate for the session type.
- Be careful with changes that affect API parsing, panel placement, refresh timing, or cache invalidation.
