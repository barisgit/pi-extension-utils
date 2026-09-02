# AGENTS.md

Shared utility library for Pi extensions: widget coordination (host + client), fullscreen leases, fullscreen-aware custom UI mounting, pane overlays, reminders, and structured logging. Published to npm as `pi-extension-utils`.

## Publishing

- Never run `npm publish` manually. There is no local npm token by design: publishing uses OIDC trusted publishing from GitHub Actions, and a local publish fails with E401/E404.
- `release.yml` publishes automatically on every push to `main` when `package.json`'s version is newer than the npm `latest`. It typechecks, tests, builds, publishes with provenance, pushes tag `v<version>`, and creates a GitHub release. Same version already on npm -> skipped.
- To release a new version: bump `package.json`, then sync the lockfile (`npm install --package-lock-only`) — the workflow installs with `npm ci`, which hard-fails if the lockfile root version lags `package.json`. Commit both, push to `main`.

## Source of truth and build

- Consumers import the compiled package (`main: ./dist/src/index.js`). Editing `src/` alone changes nothing at runtime; run `npm run build` after source changes (`dist/` is gitignored — CI builds it during publish).
- `npm run typecheck` and `npm test` (node --test over `test/**/*.test.ts`) must pass before any release; `prepublishOnly` and the workflow both enforce them.

## Architecture invariants

- `connect()` (src/client/index.ts) builds one `TuiModeCapture` shared by the widget coordinator and the ui client. Both must receive the same instance: widget factory invocations populate the TUI mode, and `ui.fullscreen()` reads it to decide how to mount.
- `ui.fullscreen()` uses the `ctx.ui.custom(..., { overlay: true, ... })` path in fullscreen mode and before the TUI mode is known, but a factory that reveals a fullscreen viewport TUI with `setLayoutRoot` must temporarily install the dashboard as the sole layout root and force redraws on install and exact-root restoration. The host overlay receives an empty input-forwarding proxy so it does not render the dashboard twice. The cold-start default must remain overlay, only a positively captured regular TUI keeps the legacy editor-slot mount, and fullscreen TUIs without the layout-root seam retain the overlay fallback.
- Pi 0.84.x exposes `setLayoutRoot()` without a getter. Keep the isolated structural read of its TypeScript-private `layoutRoot` runtime property in `src/ui/client.ts`; do not add a hard `pi-tui` dependency.
- Widget factories are wrapped by `withTuiCapture` when a capture is provided. Each fallback widget must raw-register one stable proxy factory; repeated `widgets.set` calls replace and invalidate the proxy's delegated component without another raw `setWidget`, preserving Pi 0.84.x cross-extension insertion order. Delegated factory calls must continue through `record.factory` so TUI mode capture is preserved.
- Widget host/client coordinate over an event protocol with `PROTOCOL_VERSION`; the host ignores unknown fields and rejects newer protocol versions. Bump the version when event payloads change shape.
- All pi-facing types are structural on purpose: this package must not take a hard dependency on pi-tui/pi-coding-agent types in client-facing signatures.
- Pane-overlay wheels mirror Pi fullscreen semantics: normalize SGR coordinates to zero-based positions, move one logical row per report regardless of modifiers, route by the body under the pointer, contain detail movement at its boundaries so a sibling pane never changes selection, reattach sticky-bottom state upon reaching the end, and hide activity scrollbars after 1 second. Scrollbar styling must tolerate older Pi themes that throw on the newer `scrollbarThumb` role (`selectedBg`, then `dim`, are the compatibility fallbacks). Pi 0.84 does not forward ordinary SGR clicks to focused overlays, so do not claim runtime click/drag support without an upstream deferral seam.

## Known pitfalls

- Trial-installing with `--no-package-lock` re-resolves the whole tree and creates duplicate nested package instances (spurious cross-instance type errors). Verify tarball installs with the lockfile active.
