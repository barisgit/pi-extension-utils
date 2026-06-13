# pi-extension-utils

Shared utilities for Pi extensions. This package has two faces:

- `index.ts` is the Pi host extension registered through `package.json` `pi.extensions`.
- `src/index.ts` is the client library surface that other extensions can vendor and import.

## Architecture

The host and clients communicate over Pi's shared in-process `pi.events` bus. Protocol events are namespaced as `pi-extension-utils:*` and every payload carries `protocolVersion` and `clientId`. Payloads may carry live function references because they never leave the process.

Clients emit `hello` and listen for `ready`. Before a host is ready, widget calls fall back to the consumer extension's own `ctx.ui.setWidget`. If a host arrives later, fallback widgets are cleared and re-registered through the coordinator.

The host owns one real widget per placement and composes registered sub-widgets sorted by `(order, insertion)`. Fullscreen leases blank coordinated widgets until all leases are released or the owning client disposes.

## API sketch

```ts
import { connect, createLogger, paneOverlay } from "pi-extension-utils";

const client = connect(pi, { ctx, clientId: "my-extension" });
client.widgets.set("belowEditor", "status", (tui, theme) => component, { order: 10 });
client.widgets.remove("belowEditor", "status");

// Run a custom fullscreen UI: widgets are blanked before mount and
// restored afterwards, even if the component throws.
const result = await client.ui.fullscreen<string | null>(
  (tui, theme, keybindings, done) => new MyOverlayComponent(tui, theme, done),
);

// Opinionated master/detail pane overlay helper with built-in key handling.
const result = await client.ui.fullscreen(
  paneOverlay<string, string>({
    primary: {
      mode: "cursor",
      rows: ["one", "two", "three"],
      renderRow: (row) => row,
      onSelectionChange: (row) => console.log("selected", row),
    },
    detail: {
      title: "Details",
      rows: (ctx) => [`Selected: ${ctx.selectedRow}`],
    },
    legendPlacement: "footer",
  }),
);

// Lower-level lease, for manual control over the blank/restore window.
const lease = client.fullscreen.acquire();
lease.release();

// Reminders (host absorbed from pi-reminders): fire-and-forget emits;
// list() resolves { reminders: [], count: 0 } when no host is present.
client.reminders.upsert({ id: "my-reminder", text: "...", source: "my-extension" });
client.reminders.remove("my-reminder");
client.reminders.clearSource("my-extension");
const { reminders } = await client.reminders.list();

client.dispose();

const log = createLogger("my-extension");
log.info("started");
```
