import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

type Unsubscribe = () => void;

function on<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload);

  ipcRenderer.on(channel, listener);

  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  checkTools: () => ipcRenderer.invoke('gh:checkTools'),
  getInfo: (url: string) => ipcRenderer.invoke('gh:getInfo', url),
  chooseDir: (): Promise<string | null> => ipcRenderer.invoke('gh:chooseDir'),
  openPath: (p: string) => ipcRenderer.invoke('gh:openPath', p),
  start: (opts: unknown): Promise<number> => ipcRenderer.invoke('gh:start', opts),
  cancel: (taskId: number) => ipcRenderer.invoke('gh:cancel', taskId),
  onProgress: (cb: (p: never) => void): Unsubscribe => on('gh:progress', cb),
  onLog: (cb: (p: { taskId: number; line: string }) => void): Unsubscribe => on('gh:log', cb),
  onDone: (cb: (p: never) => void): Unsubscribe => on('gh:done', cb),
  checkUpdate: () => ipcRenderer.invoke('gh:checkUpdate'),
  openReleases: () => ipcRenderer.invoke('gh:openReleases'),
  getAppInfo: (): Promise<{ version: string; downloadsDir: string }> => ipcRenderer.invoke('gh:getAppInfo'),
};

export type GrapplehookApi = typeof api;

contextBridge.exposeInMainWorld('grapplehook', api);
