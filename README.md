# pi-extension-utils

Shared utilities for Pi extensions that need coordinated UI, fullscreen overlays, reminders, and logging.

Two faces:

- **Host extension** — `package.json` loads `./dist/index.js` once per Pi session.
- **Client library** — other extensions import from `pi-extension-utils`.

## Quick Start

```bash
npm install pi-extension-utils
```

Add the package to Pi settings so the host extension loads:

```json
{
  "packages": ["npm:pi-extension-utils"]
}
```

Use the client from another extension:

```ts
import { connect } from "pi-extension-utils";

const client = connect(pi, { ctx, clientId: "my-extension" });
```

## What you get

| Feature | Use when |
|---|---|
| Widget coordinator | Multiple extensions need ordered widgets above/below the editor |
| `ui.fullscreen()` | A command opens a custom full-screen UI and should hide widgets while open |
| `paneOverlay()` | You want a master/detail fullscreen dashboard with built-in keys and legend |
| Reminders | An extension needs durable model-visible guidance without mutating prompts |
| Logger | You need namespaced rotating logs |

## Small Example

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { connect, createLogger, paneOverlay } from "pi-extension-utils";

const log = createLogger("my-extension");

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    const client = connect(pi, { ctx, clientId: "my-extension" });

    client.widgets.set("belowEditor", "status", () => ({
      render: () => ["my-extension: ready"],
      invalidate: () => {},
    }), { order: 10 });

    client.reminders.upsert({
      source: "my-extension",
      id: "state",
      text: "Remember the current extension state.",
    });
  });

  pi.registerCommand("my-dashboard", {
    description: "Open my extension dashboard",
    handler: async (_args, ctx) => {
      const client = connect(pi, { ctx, clientId: "my-extension" });
      await client.ui.fullscreen(paneOverlay({
        primary: { title: "Items", mode: "cursor", rows: ["alpha", "beta"] },
        detail: { title: "Details", rows: (o) => [`selected: ${o.selectedRow}`] },
      }));
    },
  });

  log.info("registered");
}
```

## Docs

| Topic | Link |
|---|---|
| Client APIs | [docs/client.md](docs/client.md) |
| Config files | [docs/config.md](docs/config.md) |
| Widget coordinator | [docs/widgets.md](docs/widgets.md) |
| Pane overlays | [docs/pane-overlay.md](docs/pane-overlay.md) |
| Reminders | [docs/reminders.md](docs/reminders.md) |

## Examples

See [examples/](examples/).

| Example | Shows |
|---|---|
| [`widget-coordinator.ts`](examples/widget-coordinator.ts) | Ordered widgets through the coordinator |
| [`config.ts`](examples/config.ts) | Extension-owned JSON/JSONC config |
| [`pane-overlay.ts`](examples/pane-overlay.ts) | Fullscreen master/detail dashboard |
| [`reminders.ts`](examples/reminders.ts) | Upsert/list/clear reminders |
| [`logger.ts`](examples/logger.ts) | Namespaced logger |

## Development

```bash
npm run typecheck
npm test
npm run build
```
