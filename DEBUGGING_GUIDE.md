# GNOME Extension Debugging Guide

This guide explains how to debug this GNOME Shell extension while you are developing it. The short version is that a GNOME extension is not a black box. It is debuggable, but the tools are different from what you might be used to in a browser or a normal Node.js app.

The most important fact is that your extension runs inside the GNOME Shell process. That means your code is executed by GNOME Shell itself, and your logs and exceptions go to GNOME Shell's logs. Because of that, the two main debugging tools are:

- logging from your extension code
- reading GNOME Shell logs while the extension runs

## 1. Understand what "debugging a GNOME extension" means

When you enable the extension, GNOME Shell loads your JavaScript file and keeps that code in memory. If the code throws an exception, the error does not appear in a browser console. Instead, it is usually written into the GNOME session logs.

This changes the debugging workflow a bit. Instead of relying on browser devtools, you usually debug by:

1. adding `log()` or `logError()` statements
2. watching the GNOME Shell logs live in a terminal
3. making one small change at a time
4. verifying exactly which step works and which step fails

That is the normal workflow for GNOME Shell extension development.

## 2. Use `log()` and `logError()` in the extension

The easiest way to debug is to add explicit logs to your code.

For example:

```js
log('BTC extension: enable() called');
log('BTC extension: starting refresh');
log(`BTC extension: raw csv = ${csv}`);
log(`BTC extension: parsed price = ${price}`);
logError(error, 'BTC extension: refresh failed');
```

These log messages help you answer basic questions:

- did `enable()` run?
- did the HTTP request code run?
- what raw response did the server return?
- what value did the parser extract?
- where exactly did the failure happen?

`log()` is useful for normal progress messages. `logError()` is better when you caught an exception and want the error details and stack trace in the logs.

## 3. Watch GNOME Shell logs from the terminal

Once your code writes logs, you need to read them.

The most useful command is often:

```bash
journalctl --user -f /usr/bin/gnome-shell
```

If that does not show what you need on your system, use:

```bash
journalctl --user -f
```

The `-f` means "follow", which is similar to `tail -f`. The terminal stays open and shows new log lines as they happen.

This is useful because you can:

- start the log command in one terminal
- trigger your extension
- immediately see your `log()` output and errors

That is usually the fastest feedback loop available for GNOME Shell extension work.

If you need to confirm whether the shell currently sees the extension at all,
start with:

```bash
gnome-extensions info ticker-tape@romanornr
```

or:

```bash
gnome-extensions show ticker-tape@romanornr
```

If those commands return no information, the extension is either not installed
for the current session or the current environment cannot see the active GNOME
session bus. In that case, do not trust CLI inspection alone; install the
extension and verify in the real desktop session.

If `busctl --user list` fails with a permission or transport error, you are not
in a usable user-bus context for live shell inspection. In that case, local
`gjs` checks still help, but they do not replace desktop-session verification.

## 4. Use Looking Glass

GNOME Shell has a built-in inspection and debugging tool called Looking Glass.

To open it, press:

```text
Alt+F2
```

then type:

```text
lg
```

and press Enter.

Looking Glass is useful because it can show:

- loaded extensions
- extension errors
- shell objects and state

It is one of the standard GNOME Shell debugging tools. When you are learning extension development, it is worth getting used to it early.

## 5. Debug in small checkpoints, not giant jumps

The easiest way to make GNOME extension debugging painful is to change too many things at once. A better approach is to add one piece, test it, and only then move on.

A good order for this extension is:

1. confirm `enable()` runs
2. confirm the indicator appears in the panel
3. confirm the label text can be changed manually
4. confirm the fetch function is called
5. confirm the raw HTTP response is what you expect
6. confirm the parser extracts the correct field
7. confirm timer-based refresh works

This approach makes failures much easier to understand. If you change five things at once and it breaks, you do not know which of the five caused the problem. If you change one thing at a time, the source of the problem is usually obvious.

## 6. Show visible fallback states in the UI

Debugging is easier when the extension tells you its state directly in the panel.

For example:

- `BTC ...` can mean "loading"
- `BTC 84321.18` can mean "success"
- `BTC --` can mean "error or unavailable"

This is useful because sometimes you do not want to inspect logs immediately. A visible label state can tell you roughly what happened:

- if it stays on `BTC ...`, maybe the refresh function never ran
- if it changes to `BTC --`, maybe the request failed or parsing failed
- if it shows a number, the main flow worked

That is not a replacement for logs, but it is a good first signal.

## 7. Debug the fetch in stages

When you implement the BTC request, do not try to debug everything at once. Break the work into stages and log each stage.

A useful pattern is:

```js
log('BTC extension: creating request');
log('BTC extension: request finished');
log(`BTC extension: csv = ${csv}`);
log(`BTC extension: fields[6] = ${fields[6]}`);
```

This tells you exactly where the problem is:

- if you never see "request finished", the HTTP request may be failing
- if `csv` is unexpected, the server response may not match your assumption
- if `fields[6]` is empty, your parsing logic may need adjustment

This style of debugging is simple, but it is very effective.

## 8. Expect to restart the session on Wayland and GNOME Shell 50

On Wayland, code changes usually require a logout/login cycle. GNOME Shell 50
also removed X11 support, so it always follows this path. Only GNOME Shell 49
on an Xorg session can reload in place with `Alt+F2`, `r`, Enter.

So a realistic workflow is:

1. edit the extension
2. add or adjust logs
3. log out
4. log back in
5. watch `journalctl`
6. inspect the result

That does not mean debugging is impossible. It only means you should make smaller edits so each restart teaches you something specific.

## 9. Good first debug statements for this project

When you start converting this extension from `hello world` into a BTC ticker, these are the first log statements I would add:

```js
log(`${this.uuid}: enable()`);
log(`${this.uuid}: indicator created`);
log(`${this.uuid}: refresh started`);
log(`${this.uuid}: response received`);
log(`${this.uuid}: parsed price ${price}`);
logError(error, `${this.uuid}: refresh failed`);
```

That gives you a clear timeline:

- extension enabled
- UI created
- refresh started
- network finished
- parse succeeded or failed

Once the extension is stable, you can remove noisy logs and keep only the important error logging.

## 10. Suggested debugging workflow for this repository

If you want a practical step-by-step workflow, use this:

1. Make one small code change.
2. Add logs only around the code you changed.
3. Start `journalctl --user -f /usr/bin/gnome-shell` in a terminal.
4. Reload the session if needed.
5. Watch which logs appear.
6. If something fails, fix only that one failure before changing anything else.

This is the main habit that keeps GNOME extension development manageable.

## 11. Refactor regression checklist for this repository

When the code has been reorganized or split across modules, do not stop at import checks. Run a short live checklist in the real GNOME host:

1. Run `./check.sh`.
2. Install with `./install-dev.sh` or `./install.sh`.
3. Follow the session-specific reload instruction:
   on Wayland and GNOME Shell 50, log out and back in;
   on GNOME Shell 49 with Xorg, use `Alt+F2`, `r`, Enter.
4. Watch logs with:

```bash
journalctl --user -f /usr/bin/gnome-shell
```

5. Verify these behaviors in the running extension:
   the extension enables and disables cleanly;
   the indicator appears and updates in the panel;
   left and right panel tickers preserve their configured side and order;
   loading and error states still render sensibly;
   CNBC verification for non-crypto symbols still works;
   prefs add/edit/remove/reorder/reset flows still persist;
   Kraken and Hyperliquid provider selection still changes search and Save validation;
   live crypto updates continue arriving without shell warnings or reconnect loops;
   price flash behavior still highlights a move and then resets.

If any of these fail after a refactor, debug from the narrowest seam first:

- provider adapter for transport or parsing problems
- `services/quotes.js` for orchestration/subscription problems
- prefs helper modules for validation or suggestion-state regressions
- `services/entry-model.js` for rendering-state regressions

## Summary

This project is not a black box. The main debugging tools are:

- `log()` for progress messages
- `logError()` for failures
- `journalctl --user -f` to watch GNOME Shell logs live
- Looking Glass (`Alt+F2`, then `lg`) for shell inspection
- small, incremental changes instead of large rewrites

If you follow that workflow, debugging this extension will be slower than debugging a browser app, but it will still be straightforward.
