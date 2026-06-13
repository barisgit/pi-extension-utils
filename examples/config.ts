import { Type, type Static } from "typebox";
import { defineConfig } from "pi-extension-utils";

const schema = Type.Object({
  asyncByDefault: Type.Boolean({
    default: false,
    description: "Run jobs asynchronously unless the caller opts out.",
  }),
  maxDepth: Type.Number({
    default: 1,
    description: "Maximum nested job depth.",
  }),
});

type ExampleConfig = Static<typeof schema>;

const config = defineConfig({
  name: "example-extension",
  // Uses getAgentDir()/config/example-extension.jsonc by default.
  schema,
});

export function loadConfig(): ExampleConfig {
  return config.get();
}

export function enableAsyncByDefault(): ExampleConfig {
  return config.update((cfg) => {
    cfg.asyncByDefault = true;
  });
}
