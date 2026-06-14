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
const log = createLogger("my-extension", {
  level: "info",
  maxFiles: 5,
});

log.debug("hidden at info level");
log.info("started");
log.warn("slow path");
log.error("failed");
```

`createLogger(name)` writes JSONL to `getAgentDir()/log/<name>.jsonl` by default. Each line is `{"ts":"...","level":"info","message":"started"}`. `level` is typed as `"debug" | "info" | "warn" | "error" | "silent"`; `maxFiles` controls retained rotations (`.1`, `.2`, ...). If `level`, `maxFiles`, or `maxBytes` are omitted, the value comes from `getAgentDir()/config/utils.jsonc` `logging` defaults. Explicit options always win.

Override when needed:

```ts
createLogger("my-extension", { dir: "/tmp/my-extension-logs", maxBytes: 256 * 1024 });
```
