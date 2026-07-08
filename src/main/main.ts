import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { CancelledError, checkTools, download, getVideoInfo, type DownloadOptions, type DownloadTask, type ProgressEvent } from 'grapplehook-core';
import fs from 'node:fs';
import path from 'node:path';
import { checkForUpdate, RELEASES_URL } from './update-check';

// ---------------------------------------------------------------------------
// Task registry: the renderer refers to running downloads by id.
// ---------------------------------------------------------------------------
let nextTaskId = 1;

const tasks = new Map<number, DownloadTask>();

// Serializable payloads sent to the renderer.
export interface ProgressPayload extends ProgressEvent {
  taskId: number;
}
export interface DonePayload {
  taskId: number;
  ok: boolean;
  cancelled: boolean;
  outputPath?: string;
  error?: string;
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 760,
    height: 640,
    minWidth: 560,
    minHeight: 480,
    backgroundColor: '#14171c',
    title: 'Grapplehook',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    icon: path.join(__dirname, '..', 'renderer', 'icon.png'), // ship a copy in dist
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  if (process.argv.includes('--dev')) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  // Open target="_blank" / external links in the system browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) {
      void shell.openExternal(url);
    }

    return { action: 'deny' };
  });

  return win;
}

function fixPath(): void {
  if (process.platform === 'win32') {
    return;
  }

  // GUI apps on macOS (and some Linux launchers) get launchd's minimal PATH,
  // not the user's shell PATH — so Homebrew/pipx installs aren't found.
  const extra = [
    '/opt/homebrew/bin', // Homebrew (Apple Silicon)
    '/usr/local/bin', // Homebrew (Intel), many installers
    '/opt/local/bin', // MacPorts
    `${process.env.HOME}/.local/bin`, // pipx
  ].filter((p) => fs.existsSync(p));
  const current = (process.env.PATH ?? '').split(':');

  process.env.PATH = [...new Set([...current, ...extra])].join(':');
}

fixPath();

// ---------------------------------------------------------------------------
// IPC handlers - thin wrappers around grapplehook-core.
// ---------------------------------------------------------------------------
function registerIpc(): void {
  ipcMain.handle('gh:checkTools', () => checkTools());

  ipcMain.handle('gh:checkUpdate', () => checkForUpdate());
  ipcMain.handle('gh:openReleases', () => shell.openExternal(RELEASES_URL));

  ipcMain.handle('gh:getAppInfo', () => ({
    version: app.getVersion(),
    downloadsDir: app.getPath('downloads'),
  }));

  ipcMain.handle('gh:getInfo', async (_e, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
      throw new Error('Enter a valid http(s) URL.');
    }

    return getVideoInfo(url.trim());
  });

  ipcMain.handle('gh:chooseDir', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = await dialog.showOpenDialog(win ?? BrowserWindow.getAllWindows()[0], {
      properties: ['openDirectory', 'createDirectory'],
    });

    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('gh:openPath', (_e, p: string) => {
    if (typeof p === 'string' && p) {
      shell.showItemInFolder(p);
    }
  });

  // Starts a download and streams progress/log/done events back to the sender.
  ipcMain.handle('gh:start', (e, opts: DownloadOptions) => {
    if (!opts || typeof opts.url !== 'string' || typeof opts.outputDir !== 'string') {
      throw new Error('url and outputDir are required.');
    }

    const taskId = nextTaskId++;
    const task = download(opts);

    tasks.set(taskId, task);

    const wc = e.sender;
    const send = (channel: string, payload: unknown): void => {
      if (!wc.isDestroyed()) {
        wc.send(channel, payload);
      }
    };

    task.on('progress', (p) => send('gh:progress', { taskId, ...p } satisfies ProgressPayload));
    task.on('log', (line) => send('gh:log', { taskId, line }));

    task.done
      .then(({ outputPath }) => send('gh:done', { taskId, ok: true, cancelled: false, outputPath } satisfies DonePayload))
      .catch((err: unknown) => {
        const cancelled = err instanceof CancelledError;

        send('gh:done', {
          taskId,
          ok: false,
          cancelled,
          error: err instanceof Error ? err.message : String(err),
        } satisfies DonePayload);
      })
      .finally(() => tasks.delete(taskId));

    return taskId;
  });

  ipcMain.handle('gh:cancel', (_e, taskId: number) => {
    tasks.get(taskId)?.cancel();
  });
}

// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Kill any running subprocesses before the app exits.
app.on('before-quit', () => {
  for (const task of tasks.values()) {
    task.cancel();
  }
});
