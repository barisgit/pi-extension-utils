# AGENTS.md

Shared utility library for Pi extensions: widget coordination (host + client), fullscreen leases, fullscreen-aware custom UI mounting, pane overlays, reminders, and structured logging. Published to npm as `pi-extension-utils`.

## Publishing

- Never run `npm publish` manually. There is no local npm token by design: publishing uses OIDC trusted publishing from GitHub Actions, and a local publish fails with E401/E404.
- `release.yml` publishes automatically on every push to `main` when `package.json`'s version is newer than the npm `latest`. It typechecks, tests, builds, publishes with provenance, pushes tag `v<version>`, and creates a GitHub release. Same version already on npm -> skipped.
- To release a new version: bump `package.json`, then sync the lockfile (`npm install --package-lock-only`) — the workflow installs with `npm ci`, which hard-fails if the lockfile root version lags `package.json`. Commit both, push to `main`.

## Source of truth and build

- Pi extensions import `pi-extension-utils/pi`, whose TypeScript source entry keeps host peers inside jiti’s alias/virtual-module resolution. Ordinary Node consumers retain the compiled root (`main: ./dist/src/index.js`); run `npm run build` for those consumers (`dist/` is gitignored — CI builds it during publish). Keep both entries API-identical and ship the source entry in npm tarballs.
- The Pi host entry is the TypeScript source `./index.ts` (Pi loads extensions through jiti). Pi Git installs run `git clean -fdx` and `npm install --omit=dev` without building, so the manifest must not point into `dist/`, and the npm `files` list must keep shipping `index.ts` and `src`.
- `npm run typecheck` and `npm test` (node --test over `test/**/*.test.ts`) must pass before any release; `prepublishOnly` and the workflow both enforce them.

## Architecture invariants

- `connect()` (src/client/index.ts) builds one `TuiModeCapture` shared by the widget coordinator and the ui client. Both must receive the same instance: widget factory invocations populate the TUI mode, and `ui.fullscreen()` reads it to decide how to mount.
- `ui.fullscreen()` uses the `ctx.ui.custom(..., { overlay: true, ... })` path in fullscreen mode and before the TUI mode is known, but a factory that reveals a fullscreen viewport TUI with `setLayoutRoot` must temporarily install the dashboard as the sole layout root and force redraws on install and exact-root restoration. The host overlay receives an empty input-forwarding proxy so it does not render the dashboard twice. The cold-start default must remain overlay, only a positively captured regular TUI keeps the legacy editor-slot mount, and fullscreen TUIs without the layout-root seam retain the overlay fallback.
- Pi 1.2.0 exposes `setLayoutRoot()` without a getter. Keep the isolated structural read of its TypeScript-private `layoutRoot` runtime property in `src/ui/client.ts`; do not add a hard `pi-tui` dependency.
- Widget factories are wrapped by `withTuiCapture` when a capture is provided. Each fallback widget must raw-register one stable proxy factory; repeated `widgets.set` calls replace and invalidate the proxy's delegated component without another raw `setWidget`, preserving cross-extension insertion order. Delegated factory calls must continue through `record.factory` so TUI mode capture is preserved.
- Widget host/client coordinate over an event protocol with `PROTOCOL_VERSION`; the host ignores unknown fields and rejects newer protocol versions. Bump the version when event payloads change shape.
- UI factories and TUI mounting seams remain structural; normalized mouse events use pi-tui’s type-only contracts. Runtime Pi peers resolve through the host.
- Pane overlays receive Pi 1.2 normalized mouse input via `handleMouse`, with component-local coordinates. Proxies preserve this handler; vertically stacked widget hosts subtract each child’s rendered row offset and preserve capture through release. Wheel deltas retain the host’s accelerated logical line count, route by the pane under the pointer, and are consumed even at boundaries so the transcript cannot scroll behind the surface. Detail scrolling stays contained, reattaches sticky-bottom at the end, and hides activity scrollbars after 1 second. Raw SGR input remains an adapter for consumers that synthesize wheel reports (not the fullscreen host dispatch path).
- Injected `KeybindingsManager.matches` owns `tui.select.*` bindings. Pane-specific j/k, u/d, g/G, focus, resize, and custom shortcuts remain local; the host selection bindings replace their default arrows, paging, Enter, and Escape.


## Known pitfalls

- Trial-installing with `--no-package-lock` re-resolves the whole tree and creates duplicate nested package instances (spurious cross-instance type errors). Verify tarball installs with the lockfile active.
