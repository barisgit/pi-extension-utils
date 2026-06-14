import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { connect, paneOverlay } from "pi-extension-utils";

interface RunRow {
  id: string;
  label: string;
  status: string;
  lines: string[];
}

const runs: RunRow[] = [
  { id: "a", label: "explorer", status: "running", lines: ["status: running", "task: inspect files"] },
  { id: "b", label: "qa", status: "done", lines: ["status: done", "tests: passed"] },
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
            initialSelectionKey: "b",
            renderRow: (run, _overlay, width) => width > 28 ? `${run.label} ${run.status}` : run.label,
            infoTitle: "selected",
            info: (overlay) => overlay.selectedRow ? [`status: ${overlay.selectedRow.status}`] : [],
          },
          detail: {
            title: (overlay) => ({ label: overlay.selectedRow?.label ?? "Details", tail: overlay.selectedRow?.status }),
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
