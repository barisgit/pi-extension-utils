import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createLogger } from "pi-extension-utils";

const log = createLogger("example-extension", {
  level: "info",
  maxFiles: 5,
});

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    log.info(`session started cwd=${ctx.cwd}`);
  });

  pi.registerCommand("example-log", {
    description: "Write one example log line",
    handler: async () => {
      log.info("command ran");
    },
  });
}
