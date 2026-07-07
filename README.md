# grapplehook-ui

Desktop GUI for **grapplehook**, built with Electron on top of
[`grapplehook-core`](../grapplehook-core). Paste a URL, pick a quality, and
download - with a live progress bar (download *and* transcode stages),
cancellation, and a tool-availability readout for `yt-dlp` / `ffmpeg` / `aria2c`.

> Downloading YouTube content is governed by YouTube's Terms of Service and by
> copyright law. Use this only for videos you have the right to download.

## Layout

```
grapplehook-ui/
├── package.json
├── tsconfig.json            # compiles src/main + src/preload → dist (CJS)
├── scripts/
│   └── copy-renderer.mjs    # copies src/renderer → dist/renderer
└── src/
    ├── main/main.ts         # window + IPC handlers wrapping grapplehook-core
    ├── preload/preload.ts   # contextBridge: window.grapplehook API
    └── renderer/            # static UI (index.html / style.css / renderer.js)
```

Everything that spawns subprocesses runs in the **main process** (that's where
`grapplehook-core` lives). The renderer is fully sandboxed
(`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`) and talks
to main only through the small API the preload exposes:

| Renderer call | IPC channel | Core function |
| --- | --- | --- |
| `grapplehook.checkTools()` | `gh:checkTools` | `checkTools()` |
| `grapplehook.getInfo(url)` | `gh:getInfo` | `getVideoInfo(url)` |
| `grapplehook.start(opts)` → `taskId` | `gh:start` | `download(opts)` |
| `grapplehook.cancel(taskId)` | `gh:cancel` | `task.cancel()` |
| `grapplehook.onProgress/onLog/onDone(cb)` | `gh:progress` / `gh:log` / `gh:done` | task events |

Multiple downloads can run at once; each is identified by a `taskId` so the
progress stream and cancel button target the right one. `before-quit` cancels
any running tasks so no orphaned yt-dlp/ffmpeg processes are left behind.

## Requirements

Same external tools as the CLI - they are **not** bundled by default:

- Node.js 18+
- `yt-dlp` on `PATH` (or `YTDLP_PATH`)
- `ffmpeg` / `ffprobe` on `PATH` (or `FFMPEG_PATH` / `FFPROBE_PATH`)
- `aria2c` recommended (or `ARIA2C_PATH`) - auto-used when present

The header pills show live availability at launch.

## Develop

`grapplehook-core` is consumed as a local file dependency, so build it first:

```bash
cd ../grapplehook-core && npm install && npm run build
cd ../grapplehook-ui  && npm install
npm start        # build + launch
npm run dev      # build + launch with DevTools open
```

## Package

```bash
npm run dist     # electron-builder → ./release (dmg / nsis / AppImage)
```

### Bundling the binaries (optional)

To ship yt-dlp/ffmpeg inside the app instead of requiring them on `PATH`:

1. Add the binaries under `resources/bin/` and list them in the
   `build.extraResources` field of `package.json`.
2. In `main.ts`, pass explicit paths to every core call:

```ts
import { app } from "electron";
import path from "node:path";

const bin = (name: string) =>
  path.join(process.resourcesPath, "bin", process.platform === "win32" ? `${name}.exe` : name);

const config = app.isPackaged
  ? { tools: { ytDlp: bin("yt-dlp"), ffmpeg: bin("ffmpeg"), ffprobe: bin("ffprobe"), aria2c: bin("aria2c") } }
  : {};

// then: getVideoInfo(url, config) / download(opts, config) / checkTools(config)
```

## Notes

- The renderer's CSP allows `img-src https:` only so video thumbnails can load;
  no remote scripts or styles are permitted.
- External links open in the system browser via `setWindowOpenHandler`.
- Progress semantics match the core: `percent` may be `null` (indeterminate -
  the hook sweeps the cable), and the `transcode` stage reports a real percent
  and ETA derived from ffmpeg's `-progress` output.
