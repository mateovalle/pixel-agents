import type { WebviewToHostMessage } from '../../shared/protocol.js';

interface VsCodeApi {
  postMessage(msg: WebviewToHostMessage): void;
}

export interface ElectronAPI {
  postMessage(msg: WebviewToHostMessage): void;
  onMessage(callback: (data: unknown) => void): () => void;
  ptyInput?(id: string, data: string): void;
  ptyResize?(id: string, cols: number, rows: number): void;
  ptyKill?(id: string): void;
  ptyReady?(id: string): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// Guard against duplicate IPC subscriptions if this module is re-evaluated
// (e.g. Vite HMR) — the bridge listener lives for the page lifetime.
const BRIDGE_FLAG = '__pixelAgentsBridgeActive';

function getApi(): VsCodeApi {
  const electronAPI = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;

  if (electronAPI) {
    const flags = window as unknown as Record<string, boolean>;
    if (!flags[BRIDGE_FLAG]) {
      flags[BRIDGE_FLAG] = true;
      electronAPI.onMessage((data: unknown) => {
        window.dispatchEvent(new MessageEvent('message', { data }));
      });
    }

    return {
      postMessage: (msg: WebviewToHostMessage) => electronAPI.postMessage(msg),
    };
  }

  return acquireVsCodeApi();
}

export function getElectronAPI(): ElectronAPI | undefined {
  return (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;
}

export const vscode = getApi();
