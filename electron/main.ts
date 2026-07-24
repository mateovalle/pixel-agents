import { execFileSync } from 'child_process';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import * as fs from 'fs';
import * as pty from 'node-pty';
import * as os from 'os';
import * as path from 'path';

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
} from '../src/core/assetLoader.js';
import { LAYOUT_FILE_DIR } from '../src/core/constants.js';
import { readNewLines, startFileWatching } from '../src/core/fileWatcher.js';
import type { LayoutWatcher } from '../src/core/layoutPersistence.js';
import {
  isValidLayout,
  readLayoutFromFile,
  watchLayoutFile,
  writeLayoutToFile,
} from '../src/core/layoutPersistence.js';
import {
  type CoreAgentState,
  createCoreAgentState,
  type TrackerContext,
} from '../src/core/types.js';

// ── Electron-specific constants ──────────────────────────────
const SESSION_SCAN_INTERVAL_MS = 3000;
const SESSION_STALE_MS = 24 * 60 * 60 * 1000; // 24h
const SESSION_TAIL_BYTES = 4096; // catch-up window when adopting a session
const PTY_SCROLLBACK_MAX_CHARS = 200_000;
const WINDOW_WIDTH = 900;
const WINDOW_HEIGHT = 700;
const WINDOW_BACKGROUND = '#1e1e2e';

const DATA_DIR = path.join(os.homedir(), LAYOUT_FILE_DIR);
const DISMISSED_SESSIONS_FILE = path.join(DATA_DIR, 'dismissed-sessions.json');
const AGENT_SEATS_FILE = path.join(DATA_DIR, 'agent-seats.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// ── Types ────────────────────────────────────────────────────
interface AgentState extends CoreAgentState {
  ptyId?: string;
  sessionId?: string;
  cwd?: string; // Workspace path extracted from JSONL
}

interface PtyRecord {
  proc: pty.IPty;
  label: string;
  scrollback: string;
  sessionId?: string;
}

interface AgentSeatMeta {
  palette?: number;
  seatId?: string;
  hueShift?: number;
}

// ── State ────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;
let nextAgentId = 1;
let nextTerminalIndex = 1;
const knownJsonlFiles = new Set<string>();
let scanTimer: ReturnType<typeof setInterval> | null = null;
let layoutWatcher: LayoutWatcher | null = null;

const ctx: TrackerContext<AgentState> = {
  agents: new Map(),
  fileWatchers: new Map(),
  pollingTimers: new Map(),
  waitingTimers: new Map(),
  permissionTimers: new Map(),
  // Resolved at call time so a recreated window keeps receiving messages
  send: (message) => {
    mainWindow?.webContents.send('main-message', message);
  },
  // Electron does not persist the agent list — sessions are rediscovered by scan
  persistAgents: () => {},
};

// PTY state
const ptys = new Map<string, PtyRecord>();
const ptySessionIds = new Map<string, string>(); // sessionId → ptyId
const agentToPty = new Map<number, string>(); // agentId → ptyId
const ptyToAgent = new Map<string, number>(); // ptyId → agentId

const dismissedJsonlFiles = new Set<string>(loadJsonFile<string[]>(DISMISSED_SESSIONS_FILE) ?? []);

// ── Small JSON persistence helpers ───────────────────────────
function loadJsonFile<T>(file: string): T | null {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
    }
  } catch (err) {
    console.error(`[Pixel Agents] Failed to read ${path.basename(file)}:`, err);
  }
  return null;
}

function saveJsonFile(file: string, value: unknown): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf-8');
  } catch (err) {
    console.error(`[Pixel Agents] Failed to write ${path.basename(file)}:`, err);
  }
}

function saveDismissedSessions(): void {
  saveJsonFile(DISMISSED_SESSIONS_FILE, [...dismissedJsonlFiles]);
}

function cleanupDismissedSessions(): void {
  let changed = false;
  for (const file of dismissedJsonlFiles) {
    if (!fs.existsSync(file)) {
      dismissedJsonlFiles.delete(file);
      changed = true;
    }
  }
  if (changed) saveDismissedSessions();
}

// Seat/palette metadata is keyed by SESSION id, not agent id — agent ids are
// assigned in discovery order and are not stable across app restarts.
function loadSeatMetaBySession(): Record<string, AgentSeatMeta> {
  return (
    loadJsonFile<{ bySession?: Record<string, AgentSeatMeta> }>(AGENT_SEATS_FILE)?.bySession ?? {}
  );
}

function loadSettings(): { soundEnabled: boolean } {
  return { soundEnabled: true, ...loadJsonFile<{ soundEnabled?: boolean }>(SETTINGS_FILE) };
}

/** Read the first user message from a JSONL file to extract the workspace cwd. */
function extractCwdFromJsonl(jsonlFile: string): string | undefined {
  try {
    const fd = fs.openSync(jsonlFile, 'r');
    // Read first 8KB — cwd is in one of the first few lines
    const buf = Buffer.alloc(8192);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const text = buf.toString('utf-8', 0, bytesRead);
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (record.cwd) return record.cwd;
      } catch {
        /* partial line */
      }
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

function getAssetsRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets');
  }
  // __dirname is dist-electron/electron in dev builds
  return path.join(__dirname, '..', '..', 'webview-ui', 'public', 'assets');
}

/**
 * Apps launched from Finder/Dock get launchd's minimal PATH, so `claude`
 * (typically installed via a shell profile) would not be found. Resolve the
 * user's login-shell PATH once at startup and merge it into process.env.
 */
function fixPathEnv(): void {
  if (process.platform === 'win32') return;
  try {
    const userShell = process.env.SHELL || '/bin/zsh';
    const loginPath = execFileSync(userShell, ['-l', '-c', 'echo -n "$PATH"'], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    if (loginPath && loginPath.length > (process.env.PATH?.length ?? 0)) {
      process.env.PATH = loginPath;
    }
  } catch (err) {
    console.error('[Pixel Agents] Could not resolve login-shell PATH:', err);
  }
}

// ── PTY management ───────────────────────────────────────────
// The main process constructs and spawns all commands itself — the renderer
// never supplies a command line (it only carries user keystrokes/resizes).
function spawnPty(opts: {
  cwd?: string;
  command?: string;
  sessionId?: string;
  label: string;
}): string {
  const ptyId = crypto.randomUUID();
  const isWin = process.platform === 'win32';
  const userShell = isWin ? 'powershell.exe' : process.env.SHELL || '/bin/zsh';
  // Login shell so the user's profile PATH applies inside the terminal too
  const args = opts.command
    ? isWin
      ? ['-NoLogo', '-Command', opts.command]
      : ['-l', '-c', opts.command]
    : isWin
      ? []
      : ['-l'];

  const proc = pty.spawn(userShell, args, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: opts.cwd || os.homedir(),
    env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
  });

  const record: PtyRecord = { proc, label: opts.label, scrollback: '', sessionId: opts.sessionId };
  ptys.set(ptyId, record);
  if (opts.sessionId) {
    ptySessionIds.set(opts.sessionId, ptyId);
  }

  proc.onData((data) => {
    // Scrollback is replayed to (re)mounted terminal tabs — see 'pty-ready'
    record.scrollback = (record.scrollback + data).slice(-PTY_SCROLLBACK_MAX_CHARS);
    ctx.send({ type: 'pty-output', ptyId, data });
  });

  proc.onExit(({ exitCode }) => {
    ctx.send({ type: 'pty-exit', ptyId, exitCode });
    ptys.delete(ptyId);
    if (record.sessionId && ptySessionIds.get(record.sessionId) === ptyId) {
      ptySessionIds.delete(record.sessionId);
    }
    const agentId = ptyToAgent.get(ptyId);
    if (agentId !== undefined) {
      agentToPty.delete(agentId);
      ptyToAgent.delete(ptyId);
      const agent = ctx.agents.get(agentId);
      if (agent && agent.ptyId === ptyId) {
        agent.ptyId = undefined;
      }
    }
  });

  return ptyId;
}

function killPty(ptyId: string): void {
  try {
    ptys.get(ptyId)?.proc.kill();
  } catch {
    /* already dead */
  }
}

// ── Session Auto-Detection ───────────────────────────────────
function scanForSessions(): void {
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) return;

  try {
    const projectDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR);
    const now = Date.now();

    for (const dir of projectDirs) {
      const projectPath = path.join(CLAUDE_PROJECTS_DIR, dir);
      try {
        if (!fs.statSync(projectPath).isDirectory()) continue;
      } catch {
        continue;
      }

      let jsonlFiles: string[];
      try {
        jsonlFiles = fs
          .readdirSync(projectPath)
          .filter((f) => f.endsWith('.jsonl'))
          .map((f) => path.join(projectPath, f));
      } catch {
        continue;
      }

      for (const file of jsonlFiles) {
        if (knownJsonlFiles.has(file)) continue;
        if (dismissedJsonlFiles.has(file)) continue;

        // Only pick up recently active sessions
        try {
          const stat = fs.statSync(file);
          if (now - stat.mtimeMs > SESSION_STALE_MS) continue;
        } catch {
          continue;
        }

        knownJsonlFiles.add(file);
        createAgentForFile(file, projectPath);
      }
    }
  } catch (err) {
    console.error('Error scanning sessions:', err);
  }
}

function createAgentForFile(jsonlFile: string, projectDir: string): void {
  const id = nextAgentId++;
  const agent: AgentState = createCoreAgentState(id, projectDir, jsonlFile);

  // Skip to near end of file — only show recent activity
  try {
    const stat = fs.statSync(jsonlFile);
    agent.fileOffset = Math.max(0, stat.size - SESSION_TAIL_BYTES);
  } catch {
    // Start from beginning if stat fails
  }

  // Extract workspace cwd from JSONL file
  agent.cwd = extractCwdFromJsonl(jsonlFile);
  agent.sessionId = path.basename(jsonlFile, '.jsonl');

  // Link to PTY if this is a session we spawned
  const linkedPtyId = ptySessionIds.get(agent.sessionId);
  if (linkedPtyId) {
    agent.ptyId = linkedPtyId;
    agentToPty.set(id, linkedPtyId);
    ptyToAgent.set(linkedPtyId, id);
  }

  ctx.agents.set(id, agent);
  console.log(
    `Agent ${id}: tracking ${path.basename(jsonlFile)} in ${agent.cwd || path.basename(projectDir)}`,
  );
  const folderName = agent.cwd ? path.basename(agent.cwd) : undefined;
  ctx.send({ type: 'agentCreated', id, ptyId: linkedPtyId, folderName });

  startFileWatching(ctx, id, jsonlFile);
  readNewLines(ctx, id);
}

function removeAgent(agentId: number): void {
  const agent = ctx.agents.get(agentId);
  if (!agent) return;

  ctx.fileWatchers.get(agentId)?.close();
  ctx.fileWatchers.delete(agentId);
  const pt = ctx.pollingTimers.get(agentId);
  if (pt) clearInterval(pt);
  ctx.pollingTimers.delete(agentId);
  try {
    fs.unwatchFile(agent.jsonlFile);
  } catch {
    /* ignore */
  }
  const wt = ctx.waitingTimers.get(agentId);
  if (wt) clearTimeout(wt);
  ctx.waitingTimers.delete(agentId);
  const permT = ctx.permissionTimers.get(agentId);
  if (permT) clearTimeout(permT);
  ctx.permissionTimers.delete(agentId);
  ctx.agents.delete(agentId);
}

// ── Renderer message handling ────────────────────────────────
function isTrustedSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  return mainWindow !== null && event.sender === mainWindow.webContents;
}

function setupIpcHandlers(): void {
  // PTY I/O — keystrokes and geometry only; commands are built in main.
  ipcMain.on('pty-input', (event, opts: { id: string; data: string }) => {
    if (!isTrustedSender(event)) return;
    ptys.get(opts.id)?.proc.write(opts.data);
  });

  ipcMain.on('pty-resize', (event, opts: { id: string; cols: number; rows: number }) => {
    if (!isTrustedSender(event)) return;
    try {
      ptys.get(opts.id)?.proc.resize(opts.cols, opts.rows);
    } catch {
      // Resize can fail if process already exited
    }
  });

  ipcMain.on('pty-kill', (event, opts: { id: string }) => {
    if (!isTrustedSender(event)) return;
    killPty(opts.id);
  });

  // A terminal tab's xterm instance mounted — replay its scrollback so
  // output produced before mount (or before a renderer reload) is shown.
  ipcMain.on('pty-ready', (event, opts: { id: string }) => {
    if (!isTrustedSender(event)) return;
    const record = ptys.get(opts.id);
    if (record) {
      ctx.send({ type: 'pty-replay', ptyId: opts.id, data: record.scrollback });
    }
  });

  ipcMain.on('webview-message', (event, msg) => {
    if (!isTrustedSender(event)) return;
    handleWebviewMessage(msg as Record<string, unknown>);
  });
}

function handleWebviewMessage(msg: Record<string, unknown>): void {
  if (msg.type === 'webviewReady') {
    onWebviewReady();
  } else if (msg.type === 'openClaude') {
    const sessionId = crypto.randomUUID();
    const cwd = (msg.folderPath as string) || os.homedir();
    const label = `Agent ${nextTerminalIndex++}`;
    const ptyId = spawnPty({
      cwd,
      command: `claude --session-id ${sessionId}`,
      sessionId,
      label,
    });
    ctx.send({ type: 'pty-created', ptyId, label });
  } else if (msg.type === 'saveLayout') {
    if (isValidLayout(msg.layout)) {
      layoutWatcher?.markOwnWrite();
      writeLayoutToFile(msg.layout);
    }
  } else if (msg.type === 'saveAgentSeats') {
    saveAgentSeats(msg.seats as Record<string, AgentSeatMeta> | undefined);
  } else if (msg.type === 'setSoundEnabled') {
    saveJsonFile(SETTINGS_FILE, { soundEnabled: !!msg.enabled });
  } else if (msg.type === 'closeAgent') {
    const id = msg.id as number;
    const agent = ctx.agents.get(id);
    // Remember this session so it doesn't reappear on restart
    if (agent) {
      dismissedJsonlFiles.add(agent.jsonlFile);
      saveDismissedSessions();
    }
    // Kill associated PTY and close its terminal tab
    const ptyId = agentToPty.get(id);
    if (ptyId) {
      ctx.send({ type: 'pty-close-tab', ptyId });
      killPty(ptyId);
    }
    removeAgent(id);
    ctx.send({ type: 'agentClosed', id });
  } else if (msg.type === 'focusAgent') {
    focusAgent(msg.id as number);
  } else if (msg.type === 'openSessionsFolder') {
    if (fs.existsSync(CLAUDE_PROJECTS_DIR)) {
      shell.openPath(CLAUDE_PROJECTS_DIR);
    }
  } else if (msg.type === 'exportLayout') {
    void exportLayout();
  } else if (msg.type === 'importLayout') {
    void importLayout();
  }
}

function onWebviewReady(): void {
  const assetsRoot = getAssetsRoot();

  // Rebuild terminal tabs for PTYs that survived a renderer reload; each
  // tab's TerminalInstance requests a scrollback replay via 'pty-ready'.
  for (const [ptyId, record] of ptys) {
    ctx.send({ type: 'pty-created', ptyId, label: record.label });
  }

  // Send existing agents with session-keyed seat/palette metadata
  const agentIds = [...ctx.agents.keys()].sort((a, b) => a - b);
  const metaBySession = loadSeatMetaBySession();
  const agentMeta: Record<number, AgentSeatMeta> = {};
  const folderNames: Record<number, string> = {};
  for (const [id, agent] of ctx.agents) {
    if (agent.sessionId && metaBySession[agent.sessionId]) {
      agentMeta[id] = metaBySession[agent.sessionId];
    }
    if (agent.cwd) {
      folderNames[id] = path.basename(agent.cwd);
    }
  }
  ctx.send({ type: 'existingAgents', agents: agentIds, agentMeta, folderNames });

  // Load and send assets (fire-and-forget; loaders log their own errors)
  void (async () => {
    const charSprites = await loadCharacterSprites(assetsRoot);
    if (charSprites) sendCharacterSprites(ctx.send, charSprites);
    const floorTiles = await loadFloorTiles(assetsRoot);
    if (floorTiles) sendFloorTiles(ctx.send, floorTiles);
    const wallTiles = await loadWallTiles(assetsRoot);
    if (wallTiles) sendWallTiles(ctx.send, wallTiles);
    const assets = await loadFurnitureAssets(assetsRoot);
    if (assets) sendAssets(ctx.send, assets);

    // Send layout AFTER assets (webview buffers agents until layoutLoaded)
    let layout = readLayoutFromFile();
    if (!layout) {
      layout = loadDefaultLayout(assetsRoot);
      if (layout) writeLayoutToFile(layout);
    }
    ctx.send({ type: 'layoutLoaded', layout });
  })();

  // Send settings
  ctx.send({ type: 'settingsLoaded', soundEnabled: loadSettings().soundEnabled });

  // Re-send current agent statuses
  for (const [agentId, agent] of ctx.agents) {
    for (const [toolId, status] of agent.activeToolStatuses) {
      ctx.send({ type: 'agentToolStart', id: agentId, toolId, status });
    }
    if (agent.isWaiting) {
      ctx.send({ type: 'agentStatus', id: agentId, status: 'waiting' });
    }
  }
}

function saveAgentSeats(seatsById: Record<string, AgentSeatMeta> | undefined): void {
  if (!seatsById) return;
  // Re-key by session id so the metadata survives restarts (agent ids don't)
  const bySession = loadSeatMetaBySession();
  for (const [idStr, meta] of Object.entries(seatsById)) {
    const agent = ctx.agents.get(Number(idStr));
    if (agent?.sessionId) {
      bySession[agent.sessionId] = meta;
    }
  }
  saveJsonFile(AGENT_SEATS_FILE, { bySession });
}

function focusAgent(id: number): void {
  let ptyId = agentToPty.get(id);

  if (!ptyId) {
    // Agent adopted from an external session — open a plain shell in its
    // workspace (resuming the session here could conflict with the external
    // claude process that owns it).
    const agent = ctx.agents.get(id);
    if (!agent) return;
    const label = agent.cwd ? `Shell: ${path.basename(agent.cwd)}` : `Agent ${nextTerminalIndex++}`;
    ptyId = spawnPty({ cwd: agent.cwd, label });
    agent.ptyId = ptyId;
    agentToPty.set(id, ptyId);
    ptyToAgent.set(ptyId, id);
    ctx.send({ type: 'pty-created', ptyId, label });
    return;
  }

  ctx.send({ type: 'pty-focus', ptyId, agentId: id });
}

async function exportLayout(): Promise<void> {
  if (!mainWindow) return;
  const layout = readLayoutFromFile();
  if (!layout) return;
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
    defaultPath: path.join(os.homedir(), 'pixel-agents-layout.json'),
  });
  if (result.filePath) {
    try {
      fs.writeFileSync(result.filePath, JSON.stringify(layout, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Pixel Agents] Failed to export layout:', err);
    }
  }
}

async function importLayout(): Promise<void> {
  if (!mainWindow) return;
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (result.filePaths.length === 0) return;
  try {
    const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
    const imported = JSON.parse(raw) as Record<string, unknown>;
    if (!isValidLayout(imported)) return;
    layoutWatcher?.markOwnWrite();
    writeLayoutToFile(imported);
    ctx.send({ type: 'layoutLoaded', layout: imported });
  } catch (err) {
    console.error('[Pixel Agents] Failed to import layout:', err);
  }
}

// ── Window Creation ──────────────────────────────────────────
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    title: 'Pixel Agents',
    backgroundColor: WINDOW_BACKGROUND,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The app only ever shows local content — block navigation and new windows.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devServer = process.env.VITE_DEV_SERVER_URL;
    if (!(devServer && url.startsWith(devServer)) && !url.startsWith('file://')) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // In development, load from Vite dev server; in production, load built files
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'webview', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── App Lifecycle ────────────────────────────────────────────
function cleanupAndQuit(): void {
  if (scanTimer) clearInterval(scanTimer);
  scanTimer = null;
  layoutWatcher?.dispose();
  layoutWatcher = null;
  for (const id of [...ctx.agents.keys()]) removeAgent(id);
  for (const ptyId of [...ptys.keys()]) killPty(ptyId);
  ptys.clear();
}

app.whenReady().then(() => {
  fixPathEnv();
  setupIpcHandlers();

  // Clean up stale dismissed sessions on startup
  cleanupDismissedSessions();

  // Initial scan for active sessions
  scanForSessions();

  // Periodic scan for new sessions
  scanTimer = setInterval(scanForSessions, SESSION_SCAN_INTERVAL_MS);

  // Cross-window layout sync (e.g. edits made from a VS Code window)
  layoutWatcher = watchLayoutFile((layout) => {
    ctx.send({ type: 'layoutLoaded', layout });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // On macOS the app keeps running (dock icon) — agents, PTYs, and the
  // session scan must survive so reopening the window restores everything.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  cleanupAndQuit();
});

// Handle abrupt termination — kill PTY processes to prevent orphans
process.on('SIGINT', () => {
  cleanupAndQuit();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanupAndQuit();
  process.exit(0);
});
