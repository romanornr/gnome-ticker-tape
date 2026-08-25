# Project Notes

GNOME Shell extension (GJS/ESM, Shell 49–50) showing market tickers in the top bar.

## Commands

- Tests: `gjs -m tests/run.js`
- Full local checks (lint-ish import sanity + tests): `./check.sh`
- Dev install (symlinks repo into extensions dir): `./install-dev.sh`; on Wayland the live session picks up code changes only after logout/login
- Run new code without logging out: `dbus-run-session -- gnome-shell --devkit` (nested window) or `--headless --virtual-monitor 1600x900` (log-only)

## Architecture Canon

- Catalog and settings symbols stay in historical Stooq-style form (`aapl.us`, `700.hk`, `eurusd`); providers translate at their boundary. Never change saved-symbol format — user gsettings contain it.
- Market quotes come from CNBC batches; symbol grammar mapping lives in
  `providers/cnbc/symbols.js`. FX pairs derive from the USD spot vector; DXY is direct.
- `QuotesService` composes the market, Kraken, and Hyperliquid providers. Each
  live symbol keeps REST fallback until its first valid WebSocket quote.
- Normalized quote shape everywhere past the provider boundary: `{price, quoteDate: 'YYYYMMDD', previousClose|null}` keyed by uppercase catalog symbol.
- `AGENTS.md` holds the file map and data/API conventions; update it in the same change when key files are added, renamed, or removed.

## Understanding This Code

Read the source. It is a small codebase with a file map in `AGENTS.md`; comments
are reserved for non-obvious boundaries and invariants per `CODE_STYLE_GUIDE.md`.

Do not depend on a generated code-intelligence index to understand or change it. A
pre-digested call graph answers "what calls this" but biases toward the shape the code
already has, and it goes stale silently — which is worse than no answer when the
question is whether the current shape is right.
