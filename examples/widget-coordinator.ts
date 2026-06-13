import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { connect } from "pi-extension-utils";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    const client = connect(pi, { ctx, clientId: "example-widget" });

    client.widgets.set(
      "belowEditor",
      "example-status",
      () => ({
        render: () => ["example widget: ready"],
        invalidate: () => {},
      }),
      { order: 10 },
    );
  });
}
