<div align="center">

<img src="icon.svg" alt="Ticker Tape" width="96" />

<h1><code>ticker-tape</code></h1>

<strong>Market prices in the GNOME top bar.</strong>

<em>Stocks, ETFs, indices, forex, commodities, and live crypto across ten exchanges.</em>

<br />
<br />

<a href="https://www.gnome.org/"><img src="https://img.shields.io/badge/GNOME_Shell-49_|_50-4A86CF?style=flat-square&logo=gnome&logoColor=white" alt="GNOME Shell 49 and 50" /></a>
<a href="https://gjs.guide/extensions/"><img src="https://img.shields.io/badge/GJS-ESM,_no_build_step-E9A825?style=flat-square&logo=javascript&logoColor=white" alt="GJS ESM, no build step" /></a>
<img src="https://img.shields.io/badge/API_key-not_required-2ea44f?style=flat-square" alt="API key not required" />
<a href="LICENSE"><img src="https://img.shields.io/badge/License-GPL--2.0--or--later-blue?style=flat-square" alt="GPL-2.0-or-later" /></a>

</div>

## Features

Ticker Tape supports stocks, ETFs, indices, forex, commodities, Kraken spot
markets, and Hyperliquid perpetual futures without an API key.

Non-crypto prices use a configurable polling interval and slow down or pause
according to their market schedule. Crypto prices use one WebSocket connection
per provider, with REST fallback on the normal polling cadence. Tickers can be
placed independently on the left or right side of the panel.

The extension requires GNOME Shell 49 or 50. Its UUID is
`ticker-tape@romanornr`.

## Install

| Command | Result |
|---|---|
| `./install.sh` | Install a copy of the extension. |
| `./install-dev.sh` | Install a symbolic link for development. |
| `./remove.sh` | Remove the installed extension. |

GNOME Shell must restart before it sees a new extension. Log out and back in on
Wayland and GNOME Shell 50. On GNOME Shell 49 under Xorg, press `Alt+F2`, enter
`r`, and press Enter.

## Default Tickers

| Label | Symbol | Category | Panel side |
|---|---|---|---|
| SPX | `^spx` | U.S. equity | Right |
| NDX | `^ndq` | U.S. equity | Right |
| DXY | `dx.f` | FX | Left |
| EUR/USD | `eurusd` | FX | Left |
| Gold | `xauusd` | Commodity | Right |
| USO | `uso.us` | U.S. ETF | Right |
| ETH | `ethusd` | Crypto (Kraken) | Right |
| BTC | `btcusd` | Crypto (Kraken) | Right |

## Add Or Edit A Ticker

1. Open the extension preferences and click **Add ticker**.
2. Choose the asset category.
3. Search the catalog by label, symbol, or a focused keyword.
4. Select a result, then choose decimals and panel side.
5. For crypto, choose Kraken or Hyperliquid before selecting a market.
6. Save.

The chosen catalog entry supplies the symbol, category, and market-session
policy. Those values are not independently editable, preventing combinations
that the providers cannot serve.

Kraken markets are discovered from its WebSocket instrument catalog and contain
spot pairs such as `SOL/USD`. Hyperliquid markets come from its metadata API and
contain perpetual futures such as `BTC`.

## Markets And Providers

| Category | Session behavior |
|---|---|
| U.S. equities and ETFs | U.S. extended-hours schedule |
| International equities | Local exchange schedule |
| Commodities | Weekday schedule, or U.S. schedule for U.S.-listed funds |
| FX | Weekday schedule |
| Crypto | Always open |

CNBC is the primary batched REST source for non-crypto quotes. Nasdaq is a
narrow fallback for missed U.S. listings, and open.er-api.com supplies an FX
rate-table fallback. Saved catalog symbols retain their historical form while
`services/providers/cnbc-symbols.js` translates them for CNBC.

| Feature | Kraken | Hyperliquid |
|---|---|---|
| Markets | Spot pairs | Perpetual futures |
| Live transport | WebSocket v2 | WebSocket |
| REST fallback | Ticker endpoint | Market snapshot |
| Catalog source | Instrument metadata | Perpetual-market metadata |
| Connection model | One batched socket | One socket, subscription per market |

A subscription acknowledgement does not disable REST fallback. A provider is
considered live only after a valid quote arrives.

## Display Settings

Three independent switches control whether each ticker shows its price,
direction arrow, and percentage change. Preferences also control the separator
between entries and the polling interval. The default interval is five minutes.

## Developer Layout

- `extension.js` owns Shell lifecycle, settings, and panel indicators.
- `prefs.js` and `utils/prefs/` own the catalog-based preferences UI.
- `services/quotes.js` composes providers, `QuoteStore`, and entry updates.
- `services/quote-update-scheduler.js` owns polling and display timers.
- `services/providers/` owns REST and WebSocket transports.
- `utils/crypto-providers/kraken/` and `hyperliquid/` own provider-specific
  symbols, catalogs, and quote normalization.
- `utils/catalog/` contains the curated non-crypto catalog.

Shell UI code and preferences UI code run in separate processes. Shared modules
must not import either process's UI libraries.

## Edit The Curated Catalog

Each non-crypto category has a file under `utils/catalog/`. Before changing a
symbol, verify it against CNBC using a custom user agent. CNBC rejects several
well-known tool user agents.

```bash
curl -A 'test/1.0' 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=AAPL&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1'
```

Keep catalog rows alphabetized by label. Use compact keywords relevant to the
asset, and let the category/symbol policy derive the market session. Do not add
static crypto rows; the selected provider supplies its catalog at runtime.

## Checks And Packaging

Install the pinned development dependencies once:

```bash
npm ci
```

Run the complete local check:

```bash
./check.sh
```

It runs ESLint, the behavior-oriented GJS tests, builds the release archive, and
compares its production inventory with the source tree. The tests cover market
schedules, current ticker settings, presentation, REST normalization/fallbacks,
live-provider lifecycle, and quote-service behavior.

Run the packaged Shell lifecycle smoke test where its GNOME runtime dependencies
are available:

```bash
./check-shell.sh
```

It installs the archive in an isolated session and checks enable, disable, and
enable again. Build only the release archive with `./pack.sh`; the default output
is `dist/ticker-tape@romanornr.shell-extension.zip`.

After a structural change, also test in a real GNOME session:

- enable, disable, and enable the extension without errors;
- add, edit, remove, reorder, and reset tickers;
- render left and right entries, including the same symbol on both sides;
- receive one Kraken and one Hyperliquid live update;
- retain cached prices after changing the ticker list;
- flash once after a price change and then return to the normal color.

Follow Shell logs with:

```bash
journalctl --user -f /usr/bin/gnome-shell
```

## Guides

- [DEBUGGING_GUIDE.md](DEBUGGING_GUIDE.md) covers runtime/provider diagnosis.
- [CODE_STYLE_GUIDE.md](CODE_STYLE_GUIDE.md) defines repository code style.
- [AGENTS.md](AGENTS.md) maps current files and data conventions.

## License

Ticker Tape is licensed under GPL-2.0-or-later. See [LICENSE](LICENSE).
