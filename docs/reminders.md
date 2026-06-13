# Reminders

Reminders let producer extensions publish compact model-visible guidance.

Use reminders instead of appending text to prompts, transcript messages, or tool results.

## Producer API

```ts
client.reminders.upsert({
  source: "my-extension",
  id: "state",
  label: "MyExt",
  text: "One short reminder for the model.",
  ttl: "session",
  repeatEveryTurns: 10,
});
```

## Operations

| Call | Effect |
|---|---|
| `upsert(intent)` | Create or replace `(source, id)` |
| `remove(source, id)` | Remove one reminder |
| `clearSource(source)` | Remove all reminders for a source |
| `list(source?)` | Read current snapshot |
| `announceNow(payload?)` | Force due reminders to announce |

## TTL

| TTL | Meaning |
|---|---|
| `once` | Announce once, then expire |
| `session` | Survives until session reset/shutdown |
| `persistent` | Survives across sessions |

## Host config

The bundled reminder host stores package config in:

```txt
getAgentDir()/config/utils.jsonc
```

```jsonc
{
  "logging": {
    "level": "info",
    "maxFiles": 3,
    "maxBytes": 1048576
  },
  "reminders": {
    // Show reminders with display:false in the transcript UI for debugging.
    "debugShowAllInTui": false
  }
}
```

Use `/reminders` to toggle the debug display setting from Pi.

## Rules

- Keep `text` short.
- Use stable `(source, id)` keys.
- Prefer replacing one reminder over creating many.
- Do not put secrets in reminders.

