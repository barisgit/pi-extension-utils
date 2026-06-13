# Pane Overlay

`paneOverlay()` builds an opinionated fullscreen master/detail UI.

Use it when you want:

- left/right panes
- built-in focus, resize, cursor, scroll keys
- derived key legend
- custom actions that appear in the legend

## Quick Start

```ts
await client.ui.fullscreen(
  paneOverlay<void, Run>({
    primary: {
      title: "Runs",
      mode: "cursor",
      rows: () => runs,
      selectionKey: (run) => run.id,
      renderRow: (run) => run.label,
    },
    detail: {
      title: (ctx) => ctx.selectedRow?.label ?? "Details",
      rows: (ctx) => renderDetails(ctx.selectedRow),
    },
    customActions: [
      {
        keys: ["enter", "o"],
        label: "collapse",
        run: (ctx) => toggleCollapse(ctx.selectedKey),
      },
    ],
  }),
);
```

## Standard keys

| Keys | Action |
|---|---|
| `esc`, `ctrl+c`, `q` | Close (`q` is configurable) |
| `tab`, `←`, `→` | Switch focus |
| `j/k`, arrows | Move cursor or scroll focused pane |
| `u/d` | Half-page up/down |
| `g/G`, `home/end` | Top/bottom |
| `[/]` | Resize split |

`PageUp/PageDown` are intentionally not part of this helper. Use `u/d`.

## Options

| Option | Purpose |
|---|---|
| `primary` | Left pane: list or scroll content |
| `detail` | Right pane: content derived from selected primary row |
| `split` | Widths, min/max, resize step |
| `legendPlacement` | `footer` or `primary` |
| `customActions` | Extra keys with labels and handlers |
| `closeKeys` | Override close keys, e.g. omit `q` |
| `collapse` | Optional primary/sidebar collapse key |
| `perSelectionScroll` | Keep separate detail scroll per selected key |
| `stickyBottom` | Detail starts/follows at bottom until user scrolls |

## Custom actions

```ts
customActions: [
  {
    keys: "a",
    label: "all sessions",
    run: (ctx) => toggleAllSessions(),
  },
  {
    keys: "y",
    label: "copy id",
    when: (ctx) => ctx.detailFocus,
    run: (ctx) => copy(ctx.selectedKey),
  },
]
```

Custom actions run before standard movement keys and are included in the legend by default.

## Examples

- [examples/pane-overlay.ts](../examples/pane-overlay.ts)
