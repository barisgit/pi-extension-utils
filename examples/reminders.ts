import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { connect } from "pi-extension-utils";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    const client = connect(pi, { ctx, clientId: "example-reminders" });

    client.reminders.upsert({
      source: "example-reminders",
      id: "status",
      label: "Example",
      text: "Use the example project conventions.",
      ttl: "session",
      repeatEveryTurns: 10,
    });
  });

  pi.registerCommand("example-clear-reminder", {
    description: "Clear the example reminder",
    handler: async (_args, ctx) => {
      const client = connect(pi, { ctx, clientId: "example-reminders" });
      client.reminders.remove("example-reminders", "status");
    },
  });
}
