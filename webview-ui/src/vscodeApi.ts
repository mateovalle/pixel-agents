interface VsCodeApi {
  postMessage(msg: unknown): void;
}

export interface ElectronAPI {
  postMessage(msg: unknown): void;
  onMessage(callback: (data: unknown) => void): void;
  ptySpawn?(opts: { id: string; cmd: string; args: string[]; cwd: string }): Promise<{ pid: number }>;
  ptyInput?(id: string, data: string): void;
  ptyResize?(id: string, cols: number, rows: number): void;
  ptyKill?(id: string): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

function getApi(): VsCodeApi {
  const electronAPI = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;

  if (electronAPI) {
    electronAPI.onMessage((data: unknown) => {
      window.dispatchEvent(new MessageEvent('message', { data }));
    });

    return {
      postMessage: (msg: unknown) => electronAPI.postMessage(msg),
    };
  }

  return acquireVsCodeApi();
}

export function getElectronAPI(): ElectronAPI | undefined {
  return (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;
}

export const vscode = getApi();
