# Charter: pi-extension-utils

## Objective

Build pi-extension-utils: an npm package that is both a host pi extension and a vendored client library coordinating extension UI over the shared in-process event bus. Slice 1: versioned hello/ready handshake with graceful fallback, widget coordinator (ordered sub-widgets per placement, fullscreen acquire/release that blanks and restores the slot), and createLogger(ns) with rotation. Then migrate pi-subagents as first consumer (async widget via coordinator, dashboard via fullscreen) and pass all pi-subagents gates.

## Scope and constraints

- New separate git repo at /Users/blaz/Programming_local/Projects/pi-extensions/pi-extension-utils (user explicitly chose separate repo over workspace).
- One package, two faces: host extension (entry ./index.ts via package.json "pi" field) plus importable client library; consumers vendor their own copy, so all bus payloads carry protocolVersion and the host tolerates older clients.
- Coordination happens only over the shared in-process EventBus (loader.js creates one bus for all extensions); never share state via module scope across extensions.
- Coordinator is cooperative-only: widgets registered directly with pi by non-participating extensions stay visible; that is accepted behavior, not a bug.
- Client must degrade gracefully to direct ctx.ui.setWidget when no host answers the handshake (soft dependency, sequential load order means host may activate after client).
- The kitty/iTerm2 image-over-overlay punch-through is upstream pi-tui behavior; fullscreen must go through the editor-slot path (non-overlay), not overlays.
- pi-subagents migration happens on its existing branch unshitification; never stage the pre-existing index.ts notice-border ANSI hunk; the interim rowsBelow height hack in src/surfaces/subagents-status.ts gets deleted once fullscreen lands.
- Smallest correct change; no speculative pane-kit/reminders work in this slice (ranked features 2 and 4 are out of scope).

## Mission Boundaries (NEVER VIOLATE)

- DO NOT delete .gitignore, .editorconfig, or other top-level dotfiles.
- DO NOT create duplicate root-level docs (e.g. SPEC.md at root AND docs/).
- Charter UUID, feature IDs, VAL IDs MAY NEVER appear hardcoded in committed scripts.
- DO NOT commit or stage the pi-subagents index.ts notice-border ANSI hunk.
- DO NOT modify files under /Users/blaz/.bun/install/global/node_modules (pi host internals are read-only reference).
- Workers: If you cannot complete your work within these boundaries, return to orchestrator. Never violate boundaries.

## Commands

test: cd /Users/blaz/Programming_local/Projects/pi-extensions/pi-extension-utils && npm test
typecheck: cd /Users/blaz/Programming_local/Projects/pi-extensions/pi-extension-utils && npx tsc --noEmit
consumer-test: cd /Users/blaz/Programming_local/Projects/pi-extensions/pi-subagents && npm run test:unit
consumer-typecheck: cd /Users/blaz/Programming_local/Projects/pi-extensions/pi-subagents && bash scripts/charter-tsc-no-new-errors.sh
consumer-vocabulary: cd /Users/blaz/Programming_local/Projects/pi-extensions/pi-subagents && npm run check:source-vocabulary
