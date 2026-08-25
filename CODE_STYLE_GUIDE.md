# Code Style Guide

Write the smallest code that clearly expresses the extension's current behavior.
Target GNOME Shell 49 and 50; do not add speculative compatibility branches for
older Shell or unreleased project formats.

Follow the official EGO review guidelines. Keep lines at or below 200
characters and run `./check.sh` before submitting. Linting covers mechanical
rules; ownership, lifecycle correctness, useful modularity, and comment quality
still require review.

## Comments

Comments explain decisions that are not evident from the code. They are not a
coverage target.

Use a concise module or class comment when it clarifies:

- ownership of timers, signals, sessions, or actors;
- a boundary between the Shell and preferences processes;
- a provider wire-format invariant;
- market-data behavior that would otherwise look accidental.

Do not comment every export or helper. Remove comments that restate a method
name, narrate local syntax, advertise an abstraction, or merely say that logic
is centralized. Prefer clearer names and direct control flow.

Useful examples:

```js
/* A valid quote, rather than a subscription acknowledgement, disables REST fallback. */
```

```js
/* CNBC uses the oldest component date so a partly stale synthetic quote is not presented as fresh. */
```

Unhelpful examples:

```js
/* This helper creates a button. */
/* Saving reuses the shared config builder. */
/* This class owns mutable dialog state. */
```

## Structure

- Keep `extension.js` focused on GNOME lifecycle and panel actors.
- Keep `enable()` and `disable()` adjacent and do not add empty lifecycle stubs
  or aliases that merely rename another method.
- Keep GTK/Adwaita preferences code out of Shell runtime modules, and Shell UI
  imports out of preferences/shared modules. Put process-specific helpers under
  an obvious process-specific directory such as `utils/prefs/`.
- A class that creates a signal, timer, session, cancellable, or actor cleans it
  up itself.
- Do not spawn shell commands from the extension when a GNOME API or D-Bus
  service provides the operation. Keep heavy work outside the Shell process.
- Prefer a direct call over callback injection when there is only one real
  implementation. Keep test seams only for external boundaries such as network
  transports and the network monitor.
- Internal normalized objects may be trusted. Validate persisted settings and
  external provider payloads at their boundaries instead of spreading optional
  access and fallback defaults through every layer.
- Extract shared code only when it removes real duplication without coupling
  unrelated processes or provider responsibilities.
- Declare `settings-schema` in `metadata.json` and call `this.getSettings()`
  without repeating the schema id.

## Lifecycle And GNOME APIs

- Call guaranteed APIs directly. Do not add `typeof method === 'function'` or
  optional-call checks for methods supplied by the targeted Shell versions.
- Do not wrap `destroy()`, `connect()`, `disconnect()`, `abort()`, or
  `GLib.Source.remove()` in defensive `try`/`catch` blocks.
- Do not use `_destroyed` or `_enabled` flags to tolerate invalid ownership.
  After destruction, clear the owner's reference and do not reuse the object.
- A widget overrides `destroy()` instead of connecting to its own `destroy`
  signal. Remove sources, disconnect signals, release children/resources, then
  call `super.destroy()` last.
- When replacing a timeout, remove the existing source immediately before the
  new source is created. The class that creates it also removes it on cleanup.
- Use `Gtk.Image` in preferences and `St.Icon` or `icon_name` in Shell UI. Do
  not use emoji as icons or text glyphs as progress bars.

## Compact Formatting

Short object literals, guards, and calls may stay on one line when they remain
easy to scan:

```js
return {price, quoteDate, previousClose};
if (!quote) return null;
session.abort();
```

Use multiple lines for nested data, substantial callbacks, or conditions whose
shape becomes harder to understand when compressed.

## Changes

When editing code:

- preserve useful explanations of non-obvious behavior;
- delete stale comments and compatibility paths with no supported consumer;
- keep production and tests simpler together—do not add production machinery
  solely to make a private state transition testable;
- prefer a net line reduction for refactors, while never hiding a real error or
  weakening required lifecycle cleanup to meet a line target.
