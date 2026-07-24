import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  postMessage: (msg: unknown) => ipcRenderer.send('webview-message', msg),
  onMessage: (callback: (data: unknown) => void) => {
    ipcRenderer.on('main-message', (_event, data) => callback(data));
  },
  // PTY channels
  ptySpawn: (opts: { id: string; cmd: string; args: string[]; cwd: string }) =>
    ipcRenderer.invoke('pty-spawn', opts),
  ptyInput: (id: string, data: string) =>
    ipcRenderer.send('pty-input', { id, data }),
  ptyResize: (id: string, cols: number, rows: number) =>
    ipcRenderer.send('pty-resize', { id, cols, rows }),
  ptyKill: (id: string) =>
    ipcRenderer.send('pty-kill', { id }),
});
