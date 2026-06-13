# Client APIs

Import from the package root:

```ts
import { connect, createLogger, paneOverlay } from "pi-extension-utils";
```

## Connect

```ts
const client = connect(pi, { ctx, clientId: "my-extension" });
```

| Option | Notes |
|---|---|
| `pi` | Extension API from your extension factory |
| `ctx` | Current command/session context |
| `clientId` | Stable ID used on the shared event bus |

Call `client.dispose()` when a long-lived extension instance is shutting down.

## Widgets

```ts
client.widgets.set("aboveEditor", "status", (tui, theme) => component, { order: 10 });
client.widgets.remove("aboveEditor", "status");
```

| Placement | Meaning |
|---|---|
| `aboveEditor` | Widget above the editor |
| `belowEditor` | Widget below the editor |

The host composes widgets by `(order, insertion)`.

## Fullscreen

```ts
await client.ui.fullscreen((tui, theme, keybindings, done) => new MyComponent(tui, theme, done));
```

`ui.fullscreen()`:

- acquires a fullscreen lease
- blanks coordinated widgets
- calls `ctx.ui.custom()`
- releases the lease in `finally`

Use `client.fullscreen.acquire()` only when you need manual lease control.

## Pane overlay

```ts
await client.ui.fullscreen(paneOverlay({ primary, detail }));
```

See [pane-overlay.md](pane-overlay.md).

## Reminders

```ts
client.reminders.upsert({ source: "my-extension", id: "state", text: "Remember this." });
client.reminders.remove("my-extension", "state");
client.reminders.clearSource("my-extension");
const snapshot = await client.reminders.list("my-extension");
```

See [reminders.md](reminders.md).

## Logger

```ts
const log = createLogger("my-extension");
log.info("started");
log.warn("slow path");
log.error("failed", { reason: "..." });
```
