# Config

`defineConfig()` manages extension-owned config files without touching Pi `settings.json`.

## Basic use

```ts
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { defineConfig } from "pi-extension-utils";

const schema = Type.Object({
  asyncByDefault: Type.Boolean({
    default: false,
    description: "Run jobs asynchronously unless the caller opts out.",
  }),
});

type MyConfig = Static<typeof schema>;

const config = defineConfig({
  name: "my-extension",
  schema,
});

const cfg: MyConfig = config.get();
```

Default path:

```txt
getAgentDir()/config/<name>.jsonc
```

Use `dir` when an extension owns a different config directory:

```ts
const config = defineConfig({
  name: "subagent",
  dir: getAgentDir(),
  schema,
});
```

That resolves either:

```txt
<dir>/subagent.jsonc
<dir>/subagent.json
```

## JSON and JSONC

Resolution is automatic:

- if only `.jsonc` exists, JSONC comments and trailing commas are allowed
- if only `.json` exists, strict JSON is used
- if neither exists, `.jsonc` is created
- if both exist, loading throws an ambiguity error

## Defaults and comments

Put defaults and comments on the TypeBox schema:

```ts
Type.Boolean({
  default: false,
  description: "Show hidden reminders in the transcript UI for debugging.",
})
```

`get()` creates the file when missing, applies schema defaults, validates, caches, and returns a typed value.

Generated JSONC uses `description` as comments. `update()` patches existing files through `jsonc-parser`, so existing comments and formatting are preserved where possible.

## Reload and update

```ts
config.reload();

config.update((cfg) => {
  cfg.asyncByDefault = true;
});
```

`get()` returns cached clones. Use `reload()` after external edits, such as on extension reload/session start.
