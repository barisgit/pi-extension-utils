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
      initialSelectionKey: currentRunId,
      renderRow: (run, ctx, width) => width > 40 ? `${run.label} ${run.status}` : run.label,
      infoTitle: "selected",
      info: (ctx) => ctx.selectedRow ? [`status: ${ctx.selectedRow.status}`] : [],
    },
    detail: {
      title: (ctx) => ({ label: ctx.selectedRow?.label ?? "Details", tail: "VAL" }),
      rows: (ctx) => renderDetails(ctx.selectedRow),
    },
    onRender: (ctx) => tickFlashMessage(),
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
| `onRender` | Per-frame hook for external transient UI state |

## Primary pane extras

The primary pane can render more than a flat selectable list:

- `renderRow(row, ctx, width)` receives the current primary pane width. The same value is also exposed as `ctx.primary.width`; `ctx.detail.width` exposes the detail pane width.
- `primary.info` renders a selected-row-derived block below the list and above a primary-placed legend. Use `primary.infoTitle` to label its divider.
- `rows` may include `{ kind: "separator", label: "done" }`. Separator rows render as inline rules and are skipped by cursor movement and selection keys.
- `initialSelectionKey` or `initialIndex` controls the first selected row when the overlay opens. `initialSelectionKey` applies on the first frame where that key is present, including async-arriving rows.

Pane titles may be strings or structured objects forwarded to `titledTopSegment`:

```ts
detail: {
  title: (ctx) => ({
    label: ctx.selectedRow?.name ?? "Details",
    tailRendered: renderStatusTail(ctx.selectedRow),
    tailPlain: plainStatusTail(ctx.selectedRow),
  }),
  rows: renderDetailRows,
}
```

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
