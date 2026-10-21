# dsh-screen-saver

English | [简体中文](README.md)

A **keep-screen-on** plugin for [DeepSeek Harness](https://github.com/deepseek-ai) (DSH / DSHM). It adds a dedicated section in Settings and a compact pill in the conversation composer dock, so you can hold the screen awake with a single tap.

Built on the web standard [Screen Wake Lock API](https://w3c.github.io/screen-wake-lock/) (`navigator.wakeLock`). No native code, no extra system permissions, no upstream patches.

## Features

- **Dedicated settings section**: Settings → "Keep screen on" in the left nav — one switch card showing the current state and, when something fails, the exact reason.
- **Composer dock entry**: a compact pill in the row above the message input:
  - Off: a single grey bulb icon, fully transparent background;
  - On: green icon, dark solid background, green 「常」 glyph.
- **Automatic re-acquire**: the system releases the lock when the page is hidden; the plugin requests a fresh one when the page becomes visible again (three triggers — `visibilitychange`, `pageshow`, `focus` — and it always swaps in a new lock, never trusting the old one).
- **Persistent state**: the toggle intent lives in `localStorage`, so it is restored after a reload or an app restart.
- **Bilingual**: Chinese and English, following the host's active locale.

## Known limitations

**Only effective while the page is visible.** Wake Lock is a browser capability: when the page goes to the background, the screen locks, or the app exits, the system always takes the lock back. This plugin re-requests it on return to the foreground, but **it cannot keep the screen on while the app is in the background** — that requires a system-level long-running-task API, which the DSHM ArkTS bridge does not currently expose, and for which the app holds no permission.

Other constraints:

- Requires a WebView that implements Screen Wake Lock (verified on HarmonyOS ArkWeb 7.0). When the API is missing, the plugin reports it explicitly instead of failing silently.
- Aggressive system power saving or low-battery mode may refuse the request; the section then shows the concrete reason.

## Installation

### Option 1: from the plugins page (recommended)

In DSHM, open **Settings → Plugins → Install plugin** and enter:

```
github.com/mmls2007/dsh-screen-saver
```

Then **restart the DSHM app** — the host only composes plugin rows at startup. "Keep screen on" will then appear in the Settings left nav.

### Option 2: manual placement

Copy this repository into the profile's `node_modules/dsh-screen-saver/`:

```
<DSH_HOME>/profiles/<profile>/node_modules/dsh-screen-saver/
├── package.json
├── cordis.patch.yml
├── lib/index.js
├── lib/client.js
└── locale/{zh,en}.json
```

Then register it in that profile's `package.json`:

```json
{
  "dependencies": { "dsh-screen-saver": "1.0.0" },
  "dsh": { "profile": { "bundles": ["…", "dsh-screen-saver"] } }
}
```

Restart the app to load it.

## Layout

This is a standard two-sided DSH plugin:

| File | Purpose |
| --- | --- |
| `lib/index.js` | Host half. An empty `apply()` — all logic lives in the browser, the host half exists only so the package enters the cordis Loader. |
| `lib/client.js` | Browser half. Registers the `settings.section` and `conversation.composer.dock` slots and owns the wake-lock state source. |
| `cordis.patch.yml` | Bundle layer; a single `insert` row mounts the plugin into the profile. |
| `locale/*.json` | Localized section name (in-UI copy is inlined in `client.js`). |

The `dsh.client` declaration:

```json
{
  "platform": "web",
  "immediately": true,
  "inject": ["@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-client-locale"]
}
```

## Implementation notes

- **A snapshot source must return a referentially stable object.** `getSnapshot()` caches one object per `revision`; otherwise `useSyncExternalStore` sees a changing snapshot on every call and re-renders forever.
- **`label` must be safe to call with no arguments.** The settings nav resolves it through `resolveSlotLabel`, which invokes `f()`. If it throws, the entire settings panel goes blank — so this implementation wraps it in try/catch with a literal fallback.
- **Re-acquiring on return must force a new lock, not "acquire only if absent".** After a WebView is suspended, the old sentinel often neither flips `released` nor fires its `release` event, so `get()` keeps returning `true` and a naive "re-acquire if needed" check silently skips the request.
- **The off state must have no hover background.** Mobile `:hover` sticks: after a tap the browser keeps the hover style until you tap elsewhere, leaving a pale rounded block that looks like a sporadic outline. The off state therefore only darkens the icon on hover, and uses `:focus-visible` for the keyboard focus ring.

## License

MIT
