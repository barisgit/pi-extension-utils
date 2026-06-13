# Widget Coordinator

Use the coordinator when more than one extension wants to render above or below the editor.

Raw `ctx.ui.setWidget()` calls from separate extensions do not give you a deterministic cross-extension order. Load timing can change which widget appears first. The coordinator gives every extension one shared ordered slot per placement, so widget order is stable.

## Register

```ts
client.widgets.set("belowEditor", "status", () => ({
  render: () => ["my-extension: ready"],
  invalidate: () => {},
}), { order: 10 });
```

## Remove

```ts
client.widgets.remove("belowEditor", "status");
```

## Placements

| Placement | Slot |
|---|---|
| `aboveEditor` | Above the editor |
| `belowEditor` | Below the editor |

## Ordering

Widgets in the same placement are sorted by:

1. `order`
2. insertion order

Use wide gaps so other extensions can fit between yours:

```ts
{ order: 10 }  // primary status
{ order: 50 }  // secondary details
```

## Fullscreen behavior

When any client holds a fullscreen lease, coordinated widgets are hidden and restored afterwards.

```ts
await client.ui.fullscreen((tui, theme, keybindings, done) => new MyComponent(tui, theme, done));
```

## Fallback

If the host is not ready yet, widget calls use the extension's own `ctx.ui.setWidget`. When the host announces readiness, the client clears the fallback widget and re-registers through the coordinator.

## Example

See [examples/widget-coordinator.ts](../examples/widget-coordinator.ts).
