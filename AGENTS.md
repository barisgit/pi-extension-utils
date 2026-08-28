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
- `ui.fullscreen()` mounts via `ctx.ui.custom(factory, { overlay: true, overlayOptions: { anchor: "top-left", width: "100%", maxHeight: "100%" } })` in fullscreen mode and before the TUI mode is known. The cold-start default must be overlay: mode capture happens only after Pi invokes a wrapped factory, so defaulting unknown to the editor slot breaks the first fullscreen open. Only a positively captured regular TUI keeps the legacy editor-slot mount.
- Widget factories are wrapped by `withTuiCapture` when a capture is provided. Fallback registration must pass `record.factory` (the wrapped one), never the raw `factory` argument — the wrap is the point.
- Widget host/client coordinate over an event protocol with `PROTOCOL_VERSION`; the host ignores unknown fields and rejects newer protocol versions. Bump the version when event payloads change shape.
- All pi-facing types are structural on purpose: this package must not take a hard dependency on pi-tui/pi-coding-agent types in client-facing signatures.
- Pane-overlay wheels mirror Pi fullscreen semantics: normalize SGR coordinates to zero-based positions, move one logical row per report regardless of modifiers, route by the body under the pointer, contain detail movement at its boundaries so a sibling pane never changes selection, reattach sticky-bottom state upon reaching the end, and hide activity scrollbars after 1 second. Scrollbar styling must tolerate older Pi themes that throw on the newer `scrollbarThumb` role (`selectedBg`, then `dim`, are the compatibility fallbacks). Pi 0.84 does not forward ordinary SGR clicks to focused overlays, so do not claim runtime click/drag support without an upstream deferral seam.

## Known pitfalls

- Trial-installing with `--no-package-lock` re-resolves the whole tree and creates duplicate nested package instances (spurious cross-instance type errors). Verify tarball installs with the lockfile active.
