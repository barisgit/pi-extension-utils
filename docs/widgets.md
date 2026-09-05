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

## Component ownership

A widget factory transfers ownership of its returned component to the mount. Pi disposes the old mount before calling a replacement factory. Return a fresh component on each mount; do not reuse a disposed component or share one across placements or independent mounts.

The host remounts a placement when its registrations or fullscreen visibility change. It disposes each owned child once on replacement, removal, hiding, or Pi UI teardown. A child whose render throws is detached and disposed immediately; a throwing disposer does not prevent sibling cleanup. If a factory throws before returning a component, it must clean up any resources it already created.

## Fallback

If the host is not ready yet, each logical widget registers one stable proxy through the extension's own `ctx.ui.setWidget`. Its internal raw key includes the client ID, placement, and logical key, so separate clients and placements can use the same logical key. Later `widgets.set` calls replace the proxy's delegated component and request a redraw without re-registering the raw widget, preserving cross-extension insertion order on Pi versions that delete before setting. Set and fullscreen-acquire activity also retry the hello handshake without a polling timer. When the host announces readiness, the client clears the fallback widget and re-registers through the coordinator.

## Example

See [examples/widget-coordinator.ts](../examples/widget-coordinator.ts).
