import { contextBridge, ipcRenderer, webUtils } from 'electron';

// Deliberately minimal surface: the renderer can pass messages, keystrokes,
// and terminal geometry — it can never specify a command to execute.
contextBridge.exposeInMainWorld('electronAPI', {
  postMessage: (msg: unknown) => ipcRenderer.send('webview-message', msg),
  onMessage: (callback: (data: unknown) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on('main-message', listener);
    return () => ipcRenderer.removeListener('main-message', listener);
  },
  // PTY channels
  ptyInput: (id: string, data: string) => ipcRenderer.send('pty-input', { id, data }),
  ptyResize: (id: string, cols: number, rows: number) =>
    ipcRenderer.send('pty-resize', { id, cols, rows }),
  ptyKill: (id: string) => ipcRenderer.send('pty-kill', { id }),
  ptyReady: (id: string) => ipcRenderer.send('pty-ready', { id }),
  /** Absolute filesystem path of a dropped/selected File (for @-mentions). */
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
});
