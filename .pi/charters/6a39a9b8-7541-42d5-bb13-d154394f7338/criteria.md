# Criteria for pi-extension-utils

## m1-scaffold Repo scaffold and protocol contract

### VAL-SCAFFOLD-PACKAGE Package loads as a pi extension and exports the client library
A fresh checkout has a valid package.json whose "pi.extensions" entry points at the host entry file, TypeScript sources typecheck cleanly, and the client library surface (widgets, fullscreen, createLogger) is importable from the package root without activating the host. Failure modes: host entry not registered, circular host/client imports, tsc errors.

Verifier: command
Command: cd /Users/blaz/Programming_local/Projects/pi-extensions/pi-extension-utils && npx tsc --noEmit && node -e "const p=require('./package.json'); if(!p.pi||!p.pi.extensions||!p.pi.extensions.length) process.exit(1)"
RequireFreshEvidence: true
RequireReviewSubagent: false

### VAL-PROTOCOL-VERSIONED Every bus message carries a protocol version and the host tolerates older clients
All event payloads defined by the protocol module include protocolVersion; the host accepts messages with an older protocolVersion without throwing and ignores unknown newer fields. Failure modes: payload without version, host crash on version mismatch. Evidence: unit tests exercising version-mismatch paths.

Verifier: command
Command: cd /Users/blaz/Programming_local/Projects/pi-extensions/pi-extension-utils && npm test
RequireFreshEvidence: true
RequireReviewSubagent: false

## m2-coordinator Host coordinator: handshake, widgets, fullscreen

### VAL-HANDSHAKE-LATE-JOIN Handshake works regardless of load order
A client that activates before the host (emits hello, later receives ready) and a client that activates after the host (receives ready reply to hello) both end up attached to the coordinator. Failure modes: client stuck in fallback when host exists, double-attach on repeated ready. Evidence: unit tests simulating both orderings on a shared bus stub.

Verifier: command
Command: cd /Users/blaz/Programming_local/Projects/pi-extensions/pi-extension-utils && npm test
RequireFreshEvidence: true
RequireReviewSubagent: false

### VAL-FALLBACK-NO-HOST Client degrades to direct setWidget when no host answers
With no host on the bus, a client widgets.set call renders via the consumer's own ctx.ui.setWidget and widgets.remove clears it; no errors are thrown and no events leak. Failure modes: widget invisible without host, fallback never upgrading nor duplicating after a late host appears (defined behavior must be tested either way).

Verifier: command
Command: cd /Users/blaz/Programming_local/Projects/pi-extensions/pi-extension-utils && npm test
RequireFreshEvidence: true
RequireReviewSubagent: false

### VAL-WIDGET-ORDERING Registered widgets render sorted by (order, insertion) within one host slot per placement
Multiple clients registering widgets for the same placement appear in a single host-owned slot, ordered by their numeric order then insertion sequence; unregistering or disposing a client removes only its widgets and re-renders the rest. Failure modes: interleaving with stale content, ordering flapping across refreshes, leak after unregister.

Verifier: command
Command: cd /Users/blaz/Programming_local/Projects/pi-extensions/pi-extension-utils && npm test
RequireFreshEvidence: true
RequireReviewSubagent: false

### VAL-FULLSCREEN-ACQUIRE-RESTORE fullscreen.acquire blanks coordinated widgets and release restores them exactly
While a fullscreen lease is held, the coordinator renders nothing (or a minimal placeholder) in its slots; on release or lease-holder disposal, all previously registered widgets reappear in the same order. Re-entrant or competing acquires have defined, tested semantics (queue or reject). Failure modes: widgets visible behind fullscreen, lost widgets after release, dangling lease after holder dies.

Verifier: command
Command: cd /Users/blaz/Programming_local/Projects/pi-extensions/pi-extension-utils && npm test
RequireFreshEvidence: true
RequireReviewSubagent: false

## m3-logger Logger

### VAL-LOGGER-ROTATION createLogger(ns) writes namespaced logs with rotation
createLogger("ns") appends timestamped lines to ~/.pi/logs/ns.log (path configurable for tests), creates parent directories, and rotates when the file exceeds the size cap instead of growing unbounded. Failure modes: rotation losing the active file handle, interleaved writes corrupting lines, path traversal via ns. Evidence: unit tests with a temp dir.

Verifier: command
Command: cd /Users/blaz/Programming_local/Projects/pi-extensions/pi-extension-utils && npm test
RequireFreshEvidence: true
RequireReviewSubagent: false

## m4-consumer pi-subagents migration

### VAL-SUBAGENTS-WIDGET-VIA-COORDINATOR pi-subagents async widget goes through the coordinator with fallback intact
pi-subagents registers its async-run widget through the vendored client (widgets.set) instead of calling ctx.ui.setWidget directly; with the host extension absent the widget still renders via fallback. The interim rowsBelow/containsComponent/computeBodyHeight height hack in src/surfaces/subagents-status.ts is removed. Failure modes: widget missing without host, height hack still present.

Verifier: command
Command: cd /Users/blaz/Programming_local/Projects/pi-extensions/pi-subagents && npm run test:unit
RequireFreshEvidence: true
RequireReviewSubagent: false

### VAL-SUBAGENTS-DASHBOARD-FULLSCREEN The subagents dashboard opens under a fullscreen lease and restores widgets on close
openSubagentsStatus acquires fullscreen before showing the dashboard via the non-overlay ui.custom editor-slot path and releases on close, including on error/cancel paths, so coordinated widgets (e.g. pi-bar) are hidden while the dashboard is open and restored afterward. Failure modes: lease leaked on exception, widgets visible behind dashboard, dashboard broken when host absent.

Verifier: manual
Because: Live TUI behavior (widget blanking/restore with pi-bar installed) cannot be asserted by unit tests alone; requires a live /subagents-status session check plus code-path review for release-on-error.
RequireFreshEvidence: true
RequireReviewSubagent: true

### VAL-SUBAGENTS-GATES-GREEN All pi-subagents quality gates pass after migration
npm run test:unit passes (~769 tests), scripts/charter-tsc-no-new-errors.sh reports 0 new errors vs the 275 baseline, and npm run check:source-vocabulary passes, on the migrated working tree. Failure modes: regression hidden by the known flaky tests (rerun before judging), new tsc errors introduced by vendored imports.

Verifier: command
Command: cd /Users/blaz/Programming_local/Projects/pi-extensions/pi-subagents && npm run test:unit && bash scripts/charter-tsc-no-new-errors.sh && npm run check:source-vocabulary
RequireFreshEvidence: true
RequireReviewSubagent: false

## m5-quality Independent review

### VAL-INDEPENDENT-REVIEW Independent review finds no correctness or protocol-design blockers
A read-only reviewer (not the implementer) inspects the pi-extension-utils diff and the pi-subagents migration diff against this charter's scope: handshake correctness under both load orders, fullscreen lease lifecycle (no leak on dispose/error), version tolerance, and cooperative-only widget semantics. Blocking findings are fixed and re-reviewed before this VAL passes.

Verifier: subagent
Agent: review
Because: Review quality requires an independent reader; evidence is the review notes recorded by the review subagent.
RequireFreshEvidence: true
RequireReviewSubagent: true
