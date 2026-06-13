import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { connect, paneOverlay } from "pi-extension-utils";

interface RunRow {
  id: string;
  label: string;
  lines: string[];
}

const runs: RunRow[] = [
  { id: "a", label: "explorer", lines: ["status: running", "task: inspect files"] },
  { id: "b", label: "qa", lines: ["status: done", "tests: passed"] },
];

export default function (pi: ExtensionAPI) {
  pi.registerCommand("example-dashboard", {
    description: "Open an example pane overlay",
    handler: async (_args, ctx) => {
      const client = connect(pi, { ctx, clientId: "example-dashboard" });

      await client.ui.fullscreen(
        paneOverlay<void, RunRow>({
          primary: {
            title: "Runs",
            mode: "cursor",
            rows: runs,
            selectionKey: (run) => run.id,
            renderRow: (run) => run.label,
          },
          detail: {
            title: (overlay) => overlay.selectedRow?.label ?? "Details",
            rows: (overlay) => overlay.selectedRow?.lines ?? ["No selection"],
          },
          split: { initialFraction: 0.35, minPrimaryWidth: 20, minDetailWidth: 30 },
          legendPlacement: "footer",
          customActions: [
            {
              keys: "enter",
              label: "select",
              run: (overlay) => overlay.close(),
            },
          ],
        }),
      );
    },
  });
}
