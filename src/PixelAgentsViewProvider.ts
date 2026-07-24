import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import type { WebviewToHostMessage } from '../shared/protocol.js';
import {
  getProjectDirPath,
  launchNewTerminal,
  persistAgents,
  removeAgent,
  restoreAgents,
  sendExistingAgents,
  sendLayout,
} from './agentManager.js';
import { GLOBAL_KEY_SOUND_ENABLED, WORKSPACE_KEY_AGENT_SEATS } from './constants.js';
import {
  loadCharacterSprites,
  loadDefaultLayout,
  loadFloorTiles,
  loadFurnitureAssets,
  loadWallTiles,
  sendAssets,
  sendCharacterSprites,
  sendFloorTiles,
  sendWallTiles,
} from './core/assetLoader.js';
import { ensureProjectScan, stopAllProjectScans } from './fileWatcher.js';
import type { LayoutWatcher } from './layoutPersistence.js';
import {
  isValidLayout,
  readLayoutFromFile,
  watchLayoutFile,
  writeLayoutToFile,
} from './layoutPersistence.js';
import type { AgentState, HostContext } from './types.js';

export class PixelAgentsViewProvider implements vscode.WebviewViewProvider {
  webviewView: vscode.WebviewView | undefined;

  /** All agent-tracking state, threaded through the core/host functions. */
  readonly ctx: HostContext;

  // Bundled default layout (loaded from assets/default-layout.json)
  defaultLayout: Record<string, unknown> | null = null;

  // Cross-window layout sync
  layoutWatcher: LayoutWatcher | null = null;

  // Grace-period matcher from restoreAgents (dispose cancels pending matching)
  private restoreDisposable: vscode.Disposable | null = null;

  // Listeners owned by this provider (registered once, disposed in dispose())
  private readonly listeners: vscode.Disposable[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    this.ctx = {
      agents: new Map<number, AgentState>(),
      fileWatchers: new Map(),
      pollingTimers: new Map(),
      waitingTimers: new Map(),
      permissionTimers: new Map(),
      jsonlPollTimers: new Map(),
      knownJsonlFiles: new Set(),
      activeAgentId: { current: null },
      nextAgentId: { current: 1 },
      nextTerminalIndex: { current: 1 },
      projectScanTimers: new Map(),
      // Resolved at call time so recreated webviews keep receiving messages;
      // rejections from a disposed webview are expected and ignored.
      send: (message) => {
        this.webview?.postMessage(message).then(undefined, () => {});
      },
      persistAgents: () => persistAgents(this.ctx.agents, this.context),
    };

    // Terminal listeners are global, not per-webview — register exactly once.
    this.listeners.push(
      vscode.window.onDidChangeActiveTerminal((terminal) => {
        this.ctx.activeAgentId.current = null;
        if (!terminal) return;
        for (const [id, agent] of this.ctx.agents) {
          if (agent.terminalRef === terminal) {
            this.ctx.activeAgentId.current = id;
            this.ctx.send({ type: 'agentSelected', id });
            break;
          }
        }
      }),
      vscode.window.onDidCloseTerminal((closed) => {
        for (const [id, agent] of this.ctx.agents) {
          if (agent.terminalRef === closed) {
            if (this.ctx.activeAgentId.current === id) {
              this.ctx.activeAgentId.current = null;
            }
            removeAgent(this.ctx, id);
            this.ctx.send({ type: 'agentClosed', id });
          }
        }
      }),
    );
  }

  private get extensionUri(): vscode.Uri {
    return this.context.extensionUri;
  }

  private get webview(): vscode.Webview | undefined {
    return this.webviewView?.webview;
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.webviewView = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);

    const messageListener = webviewView.webview.onDidReceiveMessage(async (message) => {
      await this.handleMessage(message as WebviewToHostMessage);
    });
    webviewView.onDidDispose(() => {
      messageListener.dispose();
      if (this.webviewView === webviewView) {
        this.webviewView = undefined;
      }
    });
  }

  private async handleMessage(message: WebviewToHostMessage): Promise<void> {
    if (message.type === 'openClaude') {
      await launchNewTerminal(this.ctx, message.folderPath);
    } else if (message.type === 'focusAgent') {
      const agent = this.ctx.agents.get(message.id);
      if (agent) {
        agent.terminalRef.show();
      }
    } else if (message.type === 'closeAgent') {
      const agent = this.ctx.agents.get(message.id);
      if (agent) {
        agent.terminalRef.dispose();
      }
    } else if (message.type === 'saveAgentSeats') {
      // Store seat assignments in a separate key (never touched by persistAgents)
      console.log(`[Pixel Agents] saveAgentSeats:`, JSON.stringify(message.seats));
      this.context.workspaceState.update(WORKSPACE_KEY_AGENT_SEATS, message.seats);
    } else if (message.type === 'saveLayout') {
      if (isValidLayout(message.layout)) {
        this.layoutWatcher?.markOwnWrite();
        writeLayoutToFile(message.layout);
      }
    } else if (message.type === 'setSoundEnabled') {
      this.context.globalState.update(GLOBAL_KEY_SOUND_ENABLED, message.enabled);
    } else if (message.type === 'webviewReady') {
      this.onWebviewReady();
    } else if (message.type === 'openSessionsFolder') {
      const projectDir = getProjectDirPath();
      if (projectDir && fs.existsSync(projectDir)) {
        vscode.env.openExternal(vscode.Uri.file(projectDir));
      }
    } else if (message.type === 'exportLayout') {
      await this.exportLayout();
    } else if (message.type === 'importLayout') {
      await this.importLayout();
    }
  }

  private onWebviewReady(): void {
    this.restoreDisposable?.dispose();
    this.restoreDisposable = restoreAgents(this.ctx, this.context);

    // Send persisted settings to webview
    const soundEnabled = this.context.globalState.get<boolean>(GLOBAL_KEY_SOUND_ENABLED, true);
    this.ctx.send({ type: 'settingsLoaded', soundEnabled });

    // Send workspace folders to webview (only when multi-root)
    const wsFolders = vscode.workspace.workspaceFolders;
    if (wsFolders && wsFolders.length > 1) {
      this.ctx.send({
        type: 'workspaceFolders',
        folders: wsFolders.map((f) => ({ name: f.name, path: f.uri.fsPath })),
      });
    }

    // Ensure project scans run even with no restored agents (to adopt
    // external terminals) — one per workspace folder in multi-root setups.
    for (const folder of wsFolders ?? []) {
      const dir = getProjectDirPath(folder.uri.fsPath);
      if (dir) {
        ensureProjectScan(this.ctx, dir);
      }
    }

    void this.loadAndSendAssets();
    sendExistingAgents(this.ctx, this.context);
  }

  /** Load assets (bundled dist/assets first, workspace fallback), send them, then the layout. */
  private async loadAndSendAssets(): Promise<void> {
    try {
      const extensionPath = this.extensionUri.fsPath;
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

      // Check bundled location first: extensionPath/dist/assets/
      const bundledAssetsDir = path.join(extensionPath, 'dist', 'assets');
      let assetsRoot: string | null = null;
      if (fs.existsSync(bundledAssetsDir)) {
        assetsRoot = path.join(extensionPath, 'dist');
      } else if (workspaceRoot) {
        // Fall back to workspace root (development or external assets)
        assetsRoot = workspaceRoot;
      }

      if (assetsRoot) {
        console.log('[Extension] Using assetsRoot:', assetsRoot);
        this.defaultLayout = loadDefaultLayout(assetsRoot);

        const charSprites = await loadCharacterSprites(assetsRoot);
        if (charSprites) {
          sendCharacterSprites(this.ctx.send, charSprites);
        }
        const floorTiles = await loadFloorTiles(assetsRoot);
        if (floorTiles) {
          sendFloorTiles(this.ctx.send, floorTiles);
        }
        const wallTiles = await loadWallTiles(assetsRoot);
        if (wallTiles) {
          sendWallTiles(this.ctx.send, wallTiles);
        }
        const assets = await loadFurnitureAssets(assetsRoot);
        if (assets) {
          sendAssets(this.ctx.send, assets);
        }
      } else {
        console.log('[Extension] ⚠️  No assets directory found');
      }
    } catch (err) {
      console.error('[Extension] ❌ Error loading assets:', err);
    }
    // Always send saved layout (or null for default) AFTER assets
    sendLayout(this.context, this.ctx.send, this.defaultLayout);
    this.startLayoutWatcher();
  }

  private async exportLayout(): Promise<void> {
    const layout = readLayoutFromFile();
    if (!layout) {
      vscode.window.showWarningMessage('Pixel Agents: No saved layout to export.');
      return;
    }
    const uri = await vscode.window.showSaveDialog({
      filters: { 'JSON Files': ['json'] },
      defaultUri: vscode.Uri.file(path.join(os.homedir(), 'pixel-agents-layout.json')),
    });
    if (uri) {
      try {
        fs.writeFileSync(uri.fsPath, JSON.stringify(layout, null, 2), 'utf-8');
        vscode.window.showInformationMessage('Pixel Agents: Layout exported successfully.');
      } catch (err) {
        vscode.window.showErrorMessage(`Pixel Agents: Failed to export layout: ${err}`);
      }
    }
  }

  private async importLayout(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      filters: { 'JSON Files': ['json'] },
      canSelectMany: false,
    });
    if (!uris || uris.length === 0) return;
    try {
      const raw = fs.readFileSync(uris[0].fsPath, 'utf-8');
      const imported = JSON.parse(raw) as Record<string, unknown>;
      if (!isValidLayout(imported)) {
        vscode.window.showErrorMessage('Pixel Agents: Invalid layout file.');
        return;
      }
      this.layoutWatcher?.markOwnWrite();
      writeLayoutToFile(imported);
      this.ctx.send({ type: 'layoutLoaded', layout: imported });
      vscode.window.showInformationMessage('Pixel Agents: Layout imported successfully.');
    } catch {
      vscode.window.showErrorMessage('Pixel Agents: Failed to read or parse layout file.');
    }
  }

  /** Export current saved layout to webview-ui/public/assets/default-layout.json (dev utility) */
  exportDefaultLayout(): void {
    const layout = readLayoutFromFile();
    if (!layout) {
      vscode.window.showWarningMessage('Pixel Agents: No saved layout found.');
      return;
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showErrorMessage('Pixel Agents: No workspace folder found.');
      return;
    }
    const targetPath = path.join(
      workspaceRoot,
      'webview-ui',
      'public',
      'assets',
      'default-layout.json',
    );
    try {
      const json = JSON.stringify(layout, null, 2);
      fs.writeFileSync(targetPath, json, 'utf-8');
      vscode.window.showInformationMessage(
        `Pixel Agents: Default layout exported to ${targetPath}`,
      );
    } catch (err) {
      vscode.window.showErrorMessage(`Pixel Agents: Failed to export default layout: ${err}`);
    }
  }

  private startLayoutWatcher(): void {
    if (this.layoutWatcher) return;
    this.layoutWatcher = watchLayoutFile((layout) => {
      console.log('[Pixel Agents] External layout change — pushing to webview');
      this.ctx.send({ type: 'layoutLoaded', layout });
    });
  }

  dispose() {
    this.restoreDisposable?.dispose();
    this.restoreDisposable = null;
    this.layoutWatcher?.dispose();
    this.layoutWatcher = null;
    for (const listener of this.listeners) {
      listener.dispose();
    }
    this.listeners.length = 0;
    for (const id of [...this.ctx.agents.keys()]) {
      removeAgent(this.ctx, id);
    }
    stopAllProjectScans(this.ctx);
  }
}

export function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const distPath = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
  const indexPath = vscode.Uri.joinPath(distPath, 'index.html').fsPath;

  let html: string;
  try {
    html = fs.readFileSync(indexPath, 'utf-8');
  } catch (err) {
    console.error('[Pixel Agents] Failed to read webview bundle:', err);
    return `<!DOCTYPE html><html><body><p>Pixel Agents: webview bundle missing — run the build first.</p></body></html>`;
  }

  html = html.replace(/(href|src)="\.\/([^"]+)"/g, (_match, attr, filePath) => {
    const fileUri = vscode.Uri.joinPath(distPath, filePath);
    const webviewUri = webview.asWebviewUri(fileUri);
    return `${attr}="${webviewUri}"`;
  });

  return html;
}
