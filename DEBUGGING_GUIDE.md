# Debugging Guide

This extension runs in two processes: `extension.js` and `ui/` run inside
GNOME Shell, while `prefs.js` and `utils/prefs/` run in the preferences process.
Start by identifying which boundary owns the failure.

## Before Debugging

Run the repository checks:

```bash
./check.sh
```

For a packaged lifecycle check on supported Shell versions:

```bash
./check-shell.sh
```

The second command needs the container/runtime dependencies described by its
own output. A passing unit test does not replace testing the extension in a real
GNOME session after changes to actors, placement, or lifecycle cleanup.

## Shell Logs

Follow GNOME Shell messages while reproducing the problem:

```bash
journalctl --user -f /usr/bin/gnome-shell
```

Use `log()` for short temporary state messages and `logError(error, context)`
for actual failures. Remove temporary diagnostic logging before submission.
Looking Glass (`Alt+F2`, then `lg` on Xorg) is useful for inspecting actors and
extensions.

On Wayland, log out and back in to restart Shell. On supported Xorg sessions,
`Alt+F2`, then `r`, reloads it. Reinstall or rerun the development installer
when the installed extension is not symlinked to this checkout.

## Runtime Pipeline

Trace failures in this order:

1. `extension.js` loads settings, starts `QuotesService`, and owns the two panel
   indicators.
2. `services/quotes.js` selects REST/live work and writes normalized quotes to
   `QuoteStore`.
3. `services/quote-store.js` retains quotes and refresh timestamps by normalized
   symbol.
4. `services/quote-update-scheduler.js` owns polling, coalesced entry rebuilds,
   network recovery, and price-flash timing.
5. `services/entry-model.js` turns cached quotes into display entries.
6. `ui/indicator.js` renders entries for its panel side.

Check the first boundary whose output is wrong. Avoid adding guards in later
layers to conceal invalid data from an earlier one.

## REST Providers

`services/providers/rest-quotes.js` coordinates CNBC with narrow Nasdaq and FX
fallbacks. Nasdaq covers U.S. listings plus NDX. When debugging a response, inspect:

- HTTP status and error body;
- the documented top-level response envelope;
- provider symbol mapping;
- normalized `price`, `previousClose`, and `quoteDate`;
- whether the quote was stored under the saved ticker's normalized symbol.

CNBC rejects common tool user agents. A direct diagnostic request needs a
custom one, for example:

```bash
curl -A 'test/1.0' 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=AAPL&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1'
```

An invalid envelope or non-success HTTP response is an error, not an empty
successful quote set. Synthetic FX and DXY quotes use the oldest component date
so a stale component cannot make the result appear fresh.

## Live Crypto Providers

Kraken supplies spot markets. Hyperliquid supplies perpetual futures. Each uses
one persistent public WebSocket connection for all saved markets, with REST
fallback on the normal polling cadence.

For a live failure, check:

- saved provider and normalized live symbol;
- subscription payload and provider acknowledgement;
- the first valid quote payload;
- stored quote and entry rebuild request;
- socket close reason and conservative reconnect;
- REST fallback while no valid live quote has arrived.

A subscription acknowledgement proves only that the subscription was accepted.
The provider becomes live-ready after its first valid quote.

## Preferences

The add flow is catalog based:

1. Choose a category.
2. Search and select a catalog entry.
3. Adjust decimals, panel side, and crypto provider where applicable.
4. Save.

The selected catalog entry supplies symbol, category, and market-session policy.
If saving fails, inspect the selected catalog item and normalized ticker config;
there is no separate Verify or editable session path.

Crypto catalogs are loaded from their providers. A Kraken catalog failure must
not silently select Hyperliquid, and Hyperliquid results must contain perpetual
markets only.

## Lifecycle Problems

For disable/re-enable crashes, verify that every object cleans up the resources
it creates: GLib sources, signal handlers, Soup sessions, cancellables, sockets,
and child actors. Owners must clear references after cleanup. Async completions
must not mutate a stopped service.

Do not hide lifecycle errors with empty catches, optional calls on guaranteed
methods, or `_destroyed`/`_enabled` flags. Fix the ownership or call order.

## Useful Final Checks

- Change the ticker list and confirm retained quotes remain visible.
- Add the same symbol to both panel sides and confirm both entries render.
- Disable and enable the extension while a request is pending.
- Disconnect and restore networking once; confirm one recovery refresh.
- Hide the direction arrow and confirm negative percentages retain their sign.
- Confirm weekend/session-skipped tickers retain their last cached quote.
