<div align="center">

<img src="icon.svg" alt="Ticker Tape" width="96" />

<h1><code>ticker-tape</code></h1>

<strong>Market prices in the GNOME top bar.</strong>

<em>Stocks, ETFs, indices, forex, commodities and live crypto, across ten exchanges.</em>

<br />
<br />

<a href="https://www.gnome.org/"><img src="https://img.shields.io/badge/GNOME_Shell-49_|_50-4A86CF?style=flat-square&logo=gnome&logoColor=white" alt="GNOME Shell 49 and 50" /></a>
<a href="https://gjs.guide/extensions/"><img src="https://img.shields.io/badge/GJS-ESM,_no_build_step-E9A825?style=flat-square&logo=javascript&logoColor=white" alt="GJS ESM, no build step" /></a>
<img src="https://img.shields.io/badge/API_key-not_required-2ea44f?style=flat-square" alt="API key not required" />
<a href="LICENSE"><img src="https://img.shields.io/badge/License-GPL--2.0--or--later-blue?style=flat-square" alt="GPL-2.0-or-later" /></a>

</div>

<!-- Add a screenshot of the indicator in the top bar, then remove these comment markers:
<p align="center"><img src="screenshot.png" alt="The Ticker Tape indicator in the GNOME top bar" width="720"></p>
-->

---

## What this extension does

Ticker Tape shows market prices in the GNOME top bar.
It supports stocks, ETFs, indices, forex, commodities and crypto.
It covers ten exchanges in the US, Europe and Asia.
It does not need an API key.

The extension polls a non-crypto ticker at the refresh interval.
It polls less frequently when the market of that ticker is closed.
A crypto ticker uses a WebSocket connection for live updates.

> [!NOTE]
> The extension needs GNOME Shell 49 or 50.
> The UUID is `ticker-tape@romanornr`.

---

## Install

Use one of these commands:

| Command | Result |
|---|---|
| `./install.sh` | Installs a copy of the extension. |
| `./install-dev.sh` | Installs a symbolic link for development. |
| `./remove.sh` | Removes the installed files. |

GNOME Shell reads a new extension only after it starts again.
Log out and log in again on Wayland and on GNOME Shell 50.
Only GNOME Shell 49 on Xorg supports pressing `Alt+F2`, typing `r` and
pressing Enter to reload the shell in place.

---

## Default tickers

The extension includes these tickers:

| Label | Symbol | Category | Panel side |
|---|---|---|---|
| SPX | `^spx` | US equity | Right |
| NDX | `^ndq` | US equity | Right |
| DXY | `dx.f` | FX | Left |
| EUR/USD | `eurusd` | FX | Left |
| Gold | `xauusd` | Commodity | Right |
| USO | `uso.us` | US ETF | Right |
| ETH | `ethusd` | Crypto (Kraken) | Right |
| BTC | `btcusd` | Crypto (Kraken) | Right |

DXY and EUR/USD show on the left side of the panel.
The other tickers show on the right side.
The two crypto tickers use Kraken.
Select Hyperliquid for one crypto ticker with the `Crypto API` option.
Change any of these values in the extension preferences.

---

## Add a ticker

1. Open the extension preferences.
2. Click `+ Add ticker`.
3. Search the catalog by label, by symbol or by category.

Category search terms include `energy`, `metals`, `forex` and `crypto`.
Symbol examples include `QQQ`, `Gold`, `EUR/USD`, `SOL/USD`, `BTC/USD` and `USO`.

For a crypto ticker:

- The `Crypto API` option selects Kraken or Hyperliquid.
- The extension reads the Kraken markets from the Kraken WebSocket.
  Search for `SOL`, `SOLUSD` or `SOL/USD`.
- The extension reads the Hyperliquid markets from the Hyperliquid metadata endpoints.
  Search for a perp such as `BTC`.

The `Verify` button requests a live quote for a non-crypto ticker.
Use it before you save the ticker.
A crypto ticker has no `Verify` button.
The Save operation validates a crypto ticker against the provider catalog.

---

## Supported markets

| Category | Description | Trading session |
|---|---|---|
| **U.S. equities** | Stocks and major U.S. equity indexes | U.S. session |
| **International equities** | Mainland China, Germany, Hong Kong, Japan, Netherlands and UK stocks | Local market session |
| **U.S. ETFs** | Exchange-traded funds | U.S. session |
| **Commodities** | Metals, energy markets and exchange-listed funds | Weekday session, or U.S. session for a U.S.-listed fund |
| **FX** | Forex pairs and currency products such as DXY | Weekday session |
| **Crypto** | Spot and perpetual crypto markets | Always open |

---

## Crypto exchanges

| Feature | Kraken | Hyperliquid |
|---|---|---|
| **Markets** | Spot pairs | Perps and spot pairs |
| **Live transport** | WebSocket v2 | WebSocket |
| **REST fallback** | Ticker endpoint | Market snapshots |
| **Catalog source** | Instrument metadata | Spot and perp metadata endpoints |
| **Search examples** | `SOL`, `SOLUSD`, `SOL/USD` | `BTC`, `ETH`, `ETH/USDC` |
| **Connection model** | One socket, batch subscribe | One socket, subscribe per symbol |

Each provider keeps one WebSocket connection for all of its crypto tickers.
It does not open one connection for each ticker.
If the connection stops, the provider polls the REST endpoint at the refresh interval.
The provider also tries to connect again.

---

## Display settings

The preferences window has these display options:

| Option | Result |
|---|---|
| **Format preset** | Selects which parts of a ticker show. |
| **Show price**, **Show arrow**, **Show percent** | Each one shows or hides one part. |
| **Separator style** | Sets the character between two tickers. The default is a dot. |
| **Refresh interval** | Sets how frequently the extension polls quotes. The default is 5 minutes. |

The extension polls less frequently when a market is closed.

---

## Manage the extension

Open this page after you install the extension:

- `https://extensions.gnome.org/local/`

The page shows the extensions that GNOME Shell reads for your session.
On the page you can enable, disable or remove the extension.

Use the page when you do not have this repository on the disk.
Also use it when you do not want to run `./remove.sh`.

> [!NOTE]
> The page needs the GNOME Shell Integration browser add-on.
> Without the add-on, the website cannot control a local extension.

The puzzle image on this page does not mean that the repository logo is
broken. The local page requests extension details and artwork from the public
extensions.gnome.org listing; it does not read `icon.png` from the installed
extension. Until this UUID has an active public listing, the puzzle is the
expected fallback.

After the first submission is editable, the extension owner uploads
`icon.png` by clicking the puzzle image on that listing. The existing PNG is
the 512×512 raster artwork intended for that upload. `icon.svg` remains the
README source image; SVG is not an accepted listing-icon format. Neither image
belongs in the installed extension ZIP.

---

## Provider layout

This section is for developers.

The crypto provider code has two layers:

- `utils/crypto-providers/` holds the provider semantics.
  These are symbol normalization, catalog load, search score and quote normalization.
- `services/providers/` holds the runtime transport, the provider ownership and the refresh order.

`utils/crypto-providers/index.js` composes the adapter objects.
The preferences code and the runtime code both use these adapters.
Each provider keeps its own files:

- `utils/crypto-providers/kraken/`
- `utils/crypto-providers/hyperliquid/`

---

## Edit the catalog

One file holds the tickers of one market:

- [utils/catalog/us-equity.js](utils/catalog/us-equity.js)
- [utils/catalog/us-etf.js](utils/catalog/us-etf.js)
- [utils/catalog/commodity.js](utils/catalog/commodity.js)
- [utils/catalog/fx.js](utils/catalog/fx.js)
- [utils/catalog/crypto.js](utils/catalog/crypto.js)

The crypto file holds a small static list for offline use.
At runtime the live providers supply the full crypto catalog.

[utils/asset-categories.js](utils/asset-categories.js) holds the category labels,
the market-session policy and the category search terms.

To add a ticker to the catalog:

1. Verify the provider symbol first. This step does not apply to a crypto ticker.
2. Add one compact record to the file of its asset category.
3. Keep the label order of that file.
4. Let the mapper of the file supply the shared values.
   The market session derives centrally from the symbol suffix or from the category.
5. For an equity or an ETF, the symbol derives from the lowercase label plus the market suffix.
   Keep a verified exception explicit. `us-equity.js` does this for `BRK.B`, `NDX` and `SPX`.
6. Keep a commodity symbol explicit.
   Add `priceDecimals` only where the mapper of that file permits a row value.
7. Add a small number of `keywords`. The catalog search then finds the ticker more easily.

> [!WARNING]
> Do not add a crypto ticker to the static catalog.
> The selected live provider supplies the crypto markets at runtime.

---

## Run the local checks

Install the pinned developer dependencies once after cloning or after the
lockfile changes:

```bash
npm ci
```

Then one command runs the local safety net:

```bash
./check.sh
```

The command runs these checks:

- ESLint with the GNOME JavaScript rules and the repository's documented style overrides
- the behavior-oriented GJS suites through `gjs -m tests/run.js`
- creation and ZIP integrity of the distributable extension
- an exact comparison between the production source inventory and the ZIP contents

The GJS tests cover the boundaries where several helpers compose into visible
or persisted behavior:

- the market schedule policy
- loading, error, fresh, stale and price-flash presentation
- REST fallback and normalized provider output
- the live WebSocket lifecycle and provider routing
- QuotesService refresh, settings and logging behavior
- saved ticker migration and dialog-to-config behavior

Prefer extending one of these composed scenarios to adding a test for every
small helper. A separate unit test is useful only when a helper owns policy or
an edge case that cannot be observed clearly through a higher-level output.

To exercise the actual packaged extension in an isolated, headless Shell
session, run:

```bash
./check-shell.sh
```

The smoke test installs the ZIP, verifies both panel indicators, disables the
extension, and enables it again. Run it on both a GNOME Shell 49 and a GNOME
Shell 50 development environment before release.

Create the release ZIP without running the full check suite with:

```bash
./pack.sh
```

By default this writes
`dist/ticker-tape@romanornr.shell-extension.zip`. Pass one output directory as
an argument to write it elsewhere.

---

## Test after a refactor

Do this end-to-end pass after a structural change.
Do it before you start more feature work.

1. Run `./check.sh`.
2. Install the current tree.
   Run `./install-dev.sh` for development, or `./install.sh` for a copy.
3. The install script can report that GNOME Shell does not read the extension yet.
   Log out and back in on Wayland and on GNOME Shell 50.
   On GNOME Shell 49 with Xorg, press `Alt+F2`, type `r` and press Enter.
4. Start a log in a second terminal:

```bash
journalctl --user -f /usr/bin/gnome-shell
```

5. Open the extension preferences. Then confirm each item of this checklist:
   - The extension enables and disables without an error.
   - The indicator shows in the panel.
   - A left-panel ticker stays on the left. A right-panel ticker stays on the right.
   - The panel shows a placeholder at startup, before the first quote arrives.
   - `Verify` still works for a non-crypto catalog entry.
   - Add, edit, remove, reorder and reset-to-defaults each persist correctly.
   - A change of `Crypto API` changes the searchable markets and the Save validation.
   - A Kraken ticker and a Hyperliquid ticker each receive live updates.
   - A price change flashes one time. The color then returns to the default color.
6. If you find a runtime problem, add a temporary focused diagnostic near the
   related provider, orchestrator or preferences path. Remove high-frequency
   diagnostics after the problem is understood so normal refreshes do not
   flood the journal.

`gnome-extensions info ticker-tape@romanornr` can return no data.
`gnome-extensions show ticker-tape@romanornr` can also return no data.
Then the extension is not installed, or the active session cannot read it.
Install the extension first. Then do the checklist again in the real GNOME session.

---

## Developer guides

- [DEBUGGING_GUIDE.md](DEBUGGING_GUIDE.md) tells you how to debug the extension behavior and the API parse steps.
- [CODE_STYLE_GUIDE.md](CODE_STYLE_GUIDE.md) gives the comment rules and the code style rules.
- [AGENTS.md](AGENTS.md) holds the file map and the data conventions.

---

## License

Ticker Tape uses the GPL-2.0-or-later license. See [LICENSE](LICENSE).

GNOME Shell also uses the GPL-2.0-or-later license.
An extension runs in the GNOME Shell process.
Thus an extension must use compatible terms.
