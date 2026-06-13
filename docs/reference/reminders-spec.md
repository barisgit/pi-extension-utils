# SPEC: Pi Reminders

## 1. Purpose

`pi-extension-utils` now contains the shared reminder host for Pi.

It centralizes dynamic guidance that producer extensions need to show the model. Packages such as `pi-dag-tasks`, `pi-dynamic-context-pruning`, and `pi-subagents` publish reminder intents over Pi's event bus. the reminders host aggregates those intents and writes compact `<system-reminder>` messages into conversation history when reminders are created, changed, forced, or due for a configured repeat interval.

The core goals are:

- producers publish intent instead of mutating transcript/tool-result content directly
- reminders are visible and durable like normal conversation context
- reminders are not repeated every provider request
- prompt-cache stability is preserved because old checkpointed messages are not rewritten

## 2. Problem

Several Pi extensions need to remind the agent about transient state:

- task status and ready work from `pi-dag-tasks`
- compression nudges, protected-tail hints, and safe ranges from `pi-dynamic-context-pruning`
- async subagent attention/status hints from `pi-subagents`

The unsafe old pattern was to append reminder text directly into existing message content, tool results, or rendered compression blocks. That mutates prompt text that may already be inside a cached checkpoint. With Anthropic prompt caching, a later `cache_control: { type: "ephemeral" }` marker is a cache breakpoint/write marker, not an instruction to exclude volatile text from the cache key.

A provider-only volatile trailer avoids rewriting history, but repeating the same side-channel every request can confuse the model and is brittle for custom providers that bypass provider-payload hooks. The v2 model therefore writes reminders as durable history messages only when they are due.

## 3. Product direction

Desired flow:

```text
pi-dag-tasks / DCP / subagents / future extensions
  -> pi.events.emit("reminder:upsert", reminderIntent)
    -> src/reminders/reminders manager stores, groups, sorts, and tracks announcement state
      -> before_agent_start returns or context queues one durable <system-reminder> custom message only when due
        -> provider receives normal conversation history
```

Only the reminders host should write model-facing reminder text. Producer packages should publish intent, not mutate prompt history.

## 4. Goals

- Provide a neutral event-bus contract for extensions to publish reminder intents.
- Write reminders as durable conversation-history messages, not provider-only tails.
- Announce reminder changes, not reminder state every turn.
- Support one-shot, session, and persistent reminders with optional repeat intervals.
- Ensure equivalent reminder sets render byte-stably through deterministic ordering and formatting.
- Keep `source`, `id`, `priority`, `ttl`, `repeatEveryTurns`, and `metadata` internal to normal model-facing output.
- Avoid adding `cache_control` to reminders.
- Provide a migration path for existing task reminders, DCP nudges, and subagent attention messages.

## 5. Non-goals

the reminders host must not become:

- a task manager or replacement for `pi-dag-tasks`
- a DCP compression policy engine
- a subagent scheduler
- a generic notification/UI system
- a prompt-cache router for all provider content
- a package that adds `cache_control` to reminders

## 6. Cache and history invariants

These invariants are mandatory:

1. **Do not mutate existing transcript messages.**
   Reminder handling must not append text to prior user, assistant, tool result, bash execution, or compressed-block messages.

2. **Do not mutate tool results.**
   Tool outputs are often checkpointed. Reminder text must not be appended to `tool_result` content.

3. **Do not mutate DCP compression blocks.**
   Compression blocks represent stable summaries/checkpoints. Reminders and nudges must be rendered separately.

4. **Write new history messages only when due.**
   Do not repeat the entire active reminder set on every request. Write when created, changed, forced, or when a configured repeat interval elapses.

5. **Do not put `cache_control` on reminders.**
   Anthropic `cache_control: { type: "ephemeral" }` is a cache breakpoint/write marker. Reminder messages are normal history and should not create cache markers.

6. **Render deterministically.**
   For the same due reminder set, output order and formatting must be byte-stable.

## 7. Event namespace

Event names:

- `reminder:upsert`
- `reminder:remove`
- `reminder:clear-source`
- `reminder:list`
- `reminder:announce-now`

Shared constants should be exported by the package so producer extensions do not duplicate string literals.

## 8. Reminder intent contract

Initial TypeScript shape:

```ts
export type ReminderTtl = "once" | "session" | "persistent";

export interface ReminderIntent {
  /** Stable unique ID within the producer source. */
  id: string;

  /** Producer namespace, e.g. "pi-dag-tasks", "dcp", "pi-subagents". */
  source: string;

  /** Compact model-facing reminder text. Source/id are not rendered by default. */
  text: string;

  /** Optional compact display label, e.g. "Tasks", "DCP", "Subagents". */
  label?: string;

  /** Higher values render earlier. Default: 0. */
  priority?: number;

  /** Whether this reminder should be shown in chat. Default: true. */
  display?: boolean;

  /** Lifecycle policy. Default: "once". */
  ttl?: ReminderTtl;

  /** Optional repeat interval for persistent reminders. */
  repeatEveryTurns?: number;

  /** Optional structured metadata for debugging; not rendered. */
  metadata?: Record<string, unknown>;
}
```

Upsert semantics:

- key: `(source, id)`
- a later upsert with the same key replaces the previous reminder
- `source`, `id`, `priority`, `display`, `ttl`, `repeatEveryTurns`, and `metadata` are internal manager fields for replacement, sorting, lifecycle, and debugging; they are not rendered by default
- `text` must be short, already summarized, and safe to render as one compact line when possible
- `display: false` keeps the reminder model-visible in history but omits it from the chat renderer; mixed announcements display only the reminders whose `display` is not false
- empty or whitespace-only text removes the reminder
- create/change marks the reminder due for the next history announcement

TTL semantics:

- `once`: default; announce once into history, then remove
- `session`: announce on create/change; keep until explicit removal, `clear-source`, or session end
- `persistent`: announce on create/change; optionally repeat every `repeatEveryTurns`; keep until explicit removal, `clear-source`, or session end

Force semantics:

```ts
export interface ReminderAnnounceNowRequest {
  source?: string;
  id?: string;
}
```

- no payload: force all active reminders
- `source`: force reminders from one source
- `source` + `id`: force one reminder

Removal/list semantics:

```ts
export interface ReminderRemoveRequest {
  source: string;
  id: string;
}

export interface ReminderClearSourceRequest {
  source: string;
}

export interface ReminderListRequest {
  source?: string;
  resolve: (snapshot: ReminderSnapshot) => void;
  reject?: (error: unknown) => void;
}
```

## 9. Rendering model

The manager renders due reminders into a single compact `<system-reminder>` message. It must not render one XML block per reminder, and it must not expose internal `source`, `id`, `priority`, `ttl`, `repeatEveryTurns`, or `metadata` unless an explicit debug surface asks for it.

Recommended model-facing shape:

```text
<system-reminder>
Tasks: 3 open / 1 active / 2 ready. Active #7 Draft SPEC. Next: review injection boundary.
DCP: compress older closed ranges; do not end in protected tail >= m0184. Safe: m0041-m0097.
Subagents: 5de6cc9f needs attention; check status before interrupting.
</system-reminder>
```

For token efficiency, render one line per source/group where possible. Multiple reminders from the same source should be merged into that source's line, ordered internally by priority and id.

Rendering order:

1. groups by descending max `priority`
2. ascending compact group label/source
3. reminders within a group by descending `priority`, then ascending `id`

Formatting requirements:

- stable newline convention
- no timestamps unless supplied by the producer as stable text
- no random IDs
- no object key order leakage from metadata
- no `cache_control` on reminder messages
- no per-reminder XML attributes or wrappers in normal model-facing output
- escape or normalize wrapper-breaking text: producer text must not be able to close `</system-reminder>` early or create malformed reminder structure

Sanitization rules:

- trim leading/trailing whitespace from each reminder text
- collapse internal runs of whitespace/newlines to compact spaces unless a future API supports preformatted text
- replace literal `</system-reminder>` and other wrapper-breaking sequences in reminder text with safe escaped text
- derive labels from a small allowlist or sanitize to short alphanumeric labels plus `-`/`_`
- never render arbitrary metadata values in the reminder message

V2 intentionally does not support cross-source semantic deduplication. Replacement is by `(source, id)` only. Cross-source dedupe can hide important guidance and should require a separate design.

## 10. Pi integration points

the reminders host is a normal Pi extension package.

Expected entrypoint:

```ts
export default function (pi: ExtensionAPI): void {
  // register event listeners
  // write due reminder history messages
  // clean up per-session state
}
```

Initial implementation scope:

- event constants and shared TypeScript types
- in-memory reminder manager with announcement state
- compact deterministic renderer
- `before_agent_start` custom-message insertion for reminders due before a run
- `context` detection for reminders that become due during long-running agent loops, queued with `pi.sendMessage(..., { deliverAs: "steer" })`
- `/remind` debug command
- `reminder:list` debug event
- tests for lifecycle, repeat behavior, forced announcements, context insertion, rendering stability, and no provider-payload injection

Primary hooks:

- `pi.on("before_agent_start", ...)`: if reminders are already due before a run starts, return one custom message with `customType: "src/reminders/reminders"`, `display: true`, and `<system-reminder>` model-visible content.
- `pi.on("context", ...)`: if reminders become due during an agent loop, queue one persisted custom message with `pi.sendMessage(..., { deliverAs: "steer" })` so long-running agents can receive reminders before the next LLM call without transient context mutation.
- `pi.registerMessageRenderer("src/reminders/reminders", ...)`: render persisted reminder messages in chat without XML wrapper tags.

Lifecycle hooks:

- `session_start` / `session_shutdown`: clear in-memory reminders
- `turn_start`: advance the manager's turn counter for `repeatEveryTurns`

Provider payload hooks are not the primary injection path in v2. Provider-specific payload rewriting should not be used for reminders unless a separate design explicitly reintroduces it.

Deferred until after v2:

- custom renderers
- cross-source semantic dedupe
- subagent migration unless a specific volatile model-only path requires it

## 11. Producer integration plan

### `pi-dag-tasks`

Current task reminders should move from direct injection into last user/tool-result content to `reminder:upsert`.

Recommended intent:

```ts
{ source: "pi-dag-tasks", id: "state", label: "Tasks", text, ttl: "persistent", repeatEveryTurns: 10 }
```

Task state should announce on create/change and, for the current v2 policy, repeat every 10 Pi turns. This can be tuned later.

### `pi-dynamic-context-pruning`

DCP nudges should become one-shot reminder intents.

Recommended intent:

```ts
{ source: "dcp", id: "nudge", label: "DCP", text, ttl: "once", priority: 30 }
```

DCP must stop appending nudge text to the latest visible user/assistant message. Compression block materialization remains separate from reminder rendering.

### `pi-subagents`

Async attention/status hints should become reminder intents when they are guidance rather than durable transcript events.

Recommended internal IDs:

- `async-attention:<runId>`
- `async-complete:<runId>`

Subagent summaries that are intended as durable conversation content are not reminders and should not use this path.

## 12. Failure behavior

Reminder handling is best-effort and must not block agent requests.

- Invalid reminder payloads should be logged/debuggable without breaking the session.
- Producer exceptions should not affect other reminders.
- If rendering fails, skip the reminder message and optionally emit a debug log.
- If no reminders are due, do not add an empty history message.

## 13. Testing requirements

Initial tests should cover:

- upsert replaces by `(source, id)`
- remove and clear-source behavior
- `once`, `session`, and `persistent` lifecycle behavior
- `persistent` repeat behavior via `repeatEveryTurns`
- `reminder:announce-now` for one reminder and all reminders
- deterministic ordering by priority/source/id
- compact grouped rendering with one line per source/group where possible
- internal source/id/priority/ttl/repeatEveryTurns metadata is not rendered in normal output
- wrapper-breaking text such as `</system-reminder>`, `<`, and `&` cannot break the message
- no reminder output when store is empty or nothing is due
- rendered reminder contains no `cache_control`
- equivalent reminder sets render byte-identically
- provider/context hooks do not duplicate reminder injection

## 14. Open questions

- Should `persistent` reminders ever survive session reload via persisted extension state, or remain in-memory only with producers responsible for republishing?
- Should `/remind` grow flags for persistent/debug reminders, or stay a simple one-shot debug command?
- What repeat interval should task-state reminders use, if any?
- Should compact labels be producer-supplied, manager-derived, or configurable?
- How should duplicate semantic reminders from multiple packages be resolved without hiding important guidance?

## 15. Success criteria

The first useful v2 is complete when:

- the reminders host exposes stable event names and shared types.
- Producer packages can publish, replace, remove, clear, list, and force reminder intents.
- The manager writes deterministic compact `<system-reminder>` history messages only when reminders are due.
- No `cache_control` is attached to reminder messages.
- Provider/context hooks do not inject duplicate reminder tails.
- `/remind <text>` creates a one-shot debug reminder.
- `pi-dag-tasks` and DCP can migrate their reminders/nudges away from direct message mutation.
