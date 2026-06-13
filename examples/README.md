# Examples

Copy an example into a Pi extension package and adjust names/state.

## Examples

| File | Shows |
|---|---|
| [widget-coordinator.ts](widget-coordinator.ts) | Ordered widgets via `client.widgets` |
| [config.ts](config.ts) | Extension-owned JSON/JSONC config |
| [pane-overlay.ts](pane-overlay.ts) | Fullscreen master/detail UI |
| [reminders.ts](reminders.ts) | Reminder producer calls |
| [logger.ts](logger.ts) | Namespaced logger |

## Local package testing

```bash
cd ../pi-extension-utils
npm run build

cd ../your-extension
npm install ../pi-extension-utils
```
