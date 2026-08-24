# AGENTS.md

## Repo Purpose

This repository contains a GNOME Shell extension that shows market tickers in the top bar.
The default ticker list is defined in `utils/settings.js`, and the curated suggestion catalog is defined under `utils/catalog/`.

## Key Files

- `extension.js`: extension lifecycle orchestration, panel registration, service startup/shutdown
- `prefs.js`: GNOME preferences window for ticker configuration, refresh cadence, and display options
- `ui/indicator.js`: panel indicator rendering
- `services/quotes.js`: settings-backed composition of REST/live providers, quote storage, and entry updates
- `services/quote-store.js`: in-memory quote cache and refresh-cadence timestamps for normalized symbols
- `services/entry-model.js`: panel entry/view-model building, including loading/error states and price-flash decoration
- `services/quotes-coordinator.js`: refresh timer, throttled entry rebuild scheduling, and price-flash reset coordination for `QuotesService`
- `services/providers/rest-quotes.js`: shared REST refresh/verification capability — CNBC primary with narrow Nasdaq/FX-rate-table fallbacks for missed symbols
- `services/providers/cnbc.js`: batched CNBC quote fetching/parsing and FX derivation from USD spot rates
- `services/providers/cnbc-symbols.js`: catalog-symbol-to-CNBC-grammar mapping (suffix rules, futures/index overrides, FX pair parsing)
- `services/providers/nasdaq.js`: per-symbol Nasdaq fallback for US listings only (foreign symbols would resolve to differently-priced ADRs)
- `services/providers/open-er-api.js`: daily USD rate table fallback deriving FX pairs when CNBC's spot vector is unavailable
- `services/providers/live-websocket-provider.js`: direct live-provider routing plus shared websocket connect/reconnect/watchdog lifecycle
- `services/providers/kraken-live.js`: Kraken runtime provider with REST polling fallback and websocket protocol handling
- `services/providers/hyperliquid-live.js`: Hyperliquid runtime provider with REST snapshot fallback and websocket protocol handling
- `README.md`: user-facing setup notes, ticker add flow, and curated catalog editing guide
- `CODE_STYLE_GUIDE.md`: repo-local coding and commenting contract intended to be understandable by human contributors and coding agents
- `utils/format.js`: display-entry formatting and color helpers
- `utils/asset-categories.js`: shared asset/provider taxonomy, live-ticker routing, search terms, and defaults
- `utils/market-sessions.js`: shared market-session profile registry, including behavior-based session ids, legacy market-type migration helpers, and prefs session option metadata
- `utils/crypto-providers/index.js`: crypto provider composition and switchboard that exposes the shared adapter seam to prefs, ticker normalization, and runtime layers
- `utils/crypto-providers/kraken/catalog.js`: Kraken catalog discovery, cached instrument snapshot loading, and runtime catalog entry normalization
- `utils/crypto-providers/kraken/quotes.js`: Kraken WebSocket quote normalization plus REST ticker request construction, fetching, and parsing
- `utils/crypto-providers/kraken/symbols.js`: Kraken live symbol normalization, saved ticker id derivation, and catalog search scoring
- `utils/crypto-providers/hyperliquid/catalog.js`: Hyperliquid REST discovery, snapshot loading, and catalog entry normalization for perp and spot markets
- `utils/crypto-providers/hyperliquid/quotes.js`: Hyperliquid quote normalization helpers shared by REST fallback and live websocket paths
- `utils/crypto-providers/hyperliquid/symbols.js`: Hyperliquid symbol normalization, spot detection, and catalog search scoring helpers
- `utils/crypto-providers/shared.js`: intentionally small shared helper layer for provider-agnostic crypto adapter normalization utilities
- `utils/display-settings.js`: display preset defaults, separator metadata, and refresh-interval option helpers
- `utils/market-schedule.js`: shared market-hours and refresh-cadence rules using `America/New_York`
- `utils/panel-sides.js`: shared left/right panel-side constants used by settings, ticker normalization, and UI flows
- `utils/settings.js`: shared settings defaults, validation, and settings-backed ticker/display loading
- `utils/ticker-config.js`: saved ticker normalization, serialization, asset inference, and legacy compatibility policy
- `utils/prefs/ticker-dialog-state.js`: pure ticker-dialog validation, crypto resolution, and form-to-config normalization helpers
- `utils/prefs/catalog-suggestions.js`: prefs-side crypto catalog loading and suggestion row model generation
- `utils/prefs/ticker-dialog-controller.js`: ticker dialog orchestration, state transitions, non-crypto verification, and suggestion wiring for prefs
- `utils/http.js`: shared Soup transport with one timeout policy and request headers, used by every REST provider
- `utils/display-density.js`: density estimation and mono-font scaling policy for crowded indicators
- `utils/ticker-catalog.js`: curated ticker aggregation and search helpers for guided prefs selection
- `utils/catalog/*.js`: curated ticker data split by asset category for contributor-friendly maintenance
- `utils/catalog/mainland-china-equity.js`, `utils/catalog/germany-equity.js`, `utils/catalog/hong-kong-equity.js`, `utils/catalog/japan-equity.js`, `utils/catalog/netherlands-equity.js`, and `utils/catalog/uk-equity.js`: alphabetized curated country-level equity catalogs using provider-verified symbols and region-appropriate market-session ids; mainland China and Hong Kong stay separate
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

- Non-crypto refreshes and prefs verification share one REST chain: CNBC's batch quote webservice, with Nasdaq as a narrow fallback for missed U.S. listings and open.er-api.com as a fallback for the USD FX vector. Kraken WebSocket v2 and Hyperliquid REST/WebSocket APIs are used for crypto market discovery and live crypto updates.
- Catalog symbols keep their historical Stooq-style form (`aapl.us`, `700.hk`) because saved user settings contain them; `services/providers/cnbc-symbols.js` owns the translation to CNBC grammar.
- CNBC rejects well-known tool user agents, so a `curl` check needs a custom UA, e.g. `curl -A 'test/1.0' 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=AAPL&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1'`.
- FX pairs have no direct CNBC symbol; the provider derives every pair from the per-currency USD spot vector (`EUR=`, `JPY=`, ...).
- Keep `utils/catalog/us-equity.js`, `utils/catalog/mainland-china-equity.js`, `utils/catalog/germany-equity.js`, `utils/catalog/hong-kong-equity.js`, `utils/catalog/japan-equity.js`, `utils/catalog/netherlands-equity.js`, and `utils/catalog/uk-equity.js` in alphabetical order by `label`, and verify new or changed symbols with a CNBC REST lookup before committing them.
- Keep `utils/catalog/us-etf.js`, `utils/catalog/commodity.js`, and `utils/catalog/fx.js` in alphabetical order by `label`, and verify new or changed symbols with a CNBC REST lookup before committing them.
- Tickers may be split across GNOME panel sides via per-ticker `panelSide` metadata; when adding indicators to the left panel, append them after existing left-side items so other extensions are not shifted unexpectedly.
- Prefer the batched quote endpoint for current prices.
- Maintain one persistent Kraken public WebSocket connection for all saved crypto pairs rather than opening one socket per ticker.
- Maintain one persistent Hyperliquid public WebSocket connection for all saved Hyperliquid crypto markets rather than opening one socket per ticker.
- Keep REST fallback behavior on the normal polling cadence if the crypto socket disconnects; do not increase REST frequency because the socket is down. One exception: a rejected direct-REST pass arms a bounded retry ladder that forces every provider, so a disconnected socket's fallback polls a few times faster until the ladder reaches the base interval.
- Throttle crypto-driven UI updates so the top bar is not repainted on every trade.
- Reconnect the Kraken socket conservatively and avoid aggressive retry loops.
- Previous close should be cached per symbol and invalidated based on the provider quote date, not the user's local timezone.
- Do not hard-code market open, pre-market, or rollover times using the local system clock.
- Treat crypto and index session boundaries according to the provider's returned date.
- Do an initial fetch for all tickers on startup so the panel can render immediately.
- Ongoing polling may skip US-session tickers on weekends using `America/New_York`, but always-open tickers like crypto should continue refreshing.
- Weekday-session tickers such as DXY, EUR/USD, and Gold should refresh on weekdays and skip weekend polling.
- On weekday overnights outside the U.S. extended-hours window, US-session tickers may refresh less frequently than the normal polling cadence, using `America/New_York` rather than the local system clock.
- When polling is skipped for a ticker, preserve and render its last known quote from in-memory cache.

## Editing Rules

- Preserve existing user changes unless explicitly asked to revert them.
- Prefer `rg` for file and text search.
- Use `apply_patch` for manual file edits.
- Keep code changes minimal and consistent with the current extension structure.
- Avoid destructive git commands unless explicitly requested.
- Follow `CODE_STYLE_GUIDE.md` when editing code comments and structure.
- For meaningful JS source files, prefer system-level comments that explain module role, class/function responsibility, and how the code fits into the quote or prefs pipeline.
- Do not rely on sparse token comments; comment coverage should be consistent enough that a new contributor can understand the architecture file by file.

## Verification Notes

- GNOME Shell extension behavior is primarily driven by `extension.js`.
- After changing extension code, verify by reinstalling or reloading the extension in GNOME Shell as appropriate for the session type.
- Be careful with changes that affect API parsing, panel placement, refresh timing, or cache invalidation.
<!-- BEGIN BYTEROVER RULES -->

# Workflow Instruction

You are a coding agent integrated with ByteRover via MCP (Model Context Protocol).

## Core Rules

1. **Query First**: Automatically call the mcp tool `brv-query` when you need to query the context for the task and you do not have the context.
2. **Curate Later**: After finishing the task, call `brv-curate` to store back the knowledge if it is very important.

## Tool Usage

- `brv-query`: Query the context tree.
- `brv-curate`: Store context to the context tree.


---
Generated by ByteRover CLI for Codex
<!-- END BYTEROVER RULES -->
