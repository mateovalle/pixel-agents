import { execFileSync } from 'child_process';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import * as fs from 'fs';
import * as pty from 'node-pty';
import * as os from 'os';
import * as path from 'path';

import type { AgentSeatMeta, WebviewToHostMessage } from '../shared/protocol.js';
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
import {
  JSONL_POLL_INTERVAL_MS,
  LAYOUT_FILE_DIR,
  PROJECT_SCAN_INTERVAL_MS,
} from '../src/core/constants.js';
import { readNewLines, startFileWatching, stopFileWatching } from '../src/core/fileWatcher.js';
import type { LayoutWatcher } from '../src/core/layoutPersistence.js';
import {
  isValidLayout,
  readLayoutFromFile,
  watchLayoutFile,
  writeLayoutToFile,
} from '../src/core/layoutPersistence.js';
import {
  cancelPermissionTimer,
  cancelWaitingTimer,
  clearAgentActivity,
} from '../src/core/timerManager.js';
import {
  type CoreAgentState,
  createCoreAgentState,
  type TrackerContext,
} from '../src/core/types.js';

// ── Electron-specific constants ──────────────────────────────
const PTY_SCROLLBACK_MAX_CHARS = 200_000;
const WINDOW_WIDTH = 900;
const WINDOW_HEIGHT = 700;
const WINDOW_BACKGROUND = '#1e1e2e';

const DATA_DIR = path.join(os.homedir(), LAYOUT_FILE_DIR);
const AGENT_SEATS_FILE = path.join(DATA_DIR, 'agent-seats.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// ── Types ────────────────────────────────────────────────────
// Agents exist ONLY for terminals this app spawned (internal sessions).
// External Claude sessions (iTerm, VS Code, ...) are not tracked.
interface AgentState extends CoreAgentState {
  ptyId: string;
  sessionId: string;
  cwd: string;
}

interface PtyRecord {
  proc: pty.IPty;
  label: string;
  scrollback: string;
  sessionId?: string;
  /** Last time the user typed into this terminal — used for /clear attribution */
  lastInputAt: number;
}

// ── State ────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;
let nextAgentId = 1;
let nextTerminalIndex = 1;
const knownJsonlFiles = new Set<string>();
const jsonlPollTimers = new Map<number, ReturnType<typeof setInterval>>();
const projectScanTimers = new Map<string, ReturnType<typeof setInterval>>();
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
  // Sessions live only as long as their PTYs — nothing to persist
  persistAgents: () => {},
};

// PTY state
const ptys = new Map<string, PtyRecord>();
const ptySessionIds = new Map<string, string>(); // sessionId → ptyId
const agentToPty = new Map<number, string>(); // agentId → ptyId
const ptyToAgent = new Map<string, number>(); // ptyId → agentId

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

// Seat/palette metadata is keyed by SESSION id, not agent id — agent ids are
// assigned in creation order and are not stable across window reloads.
function loadSeatMetaBySession(): Record<string, AgentSeatMeta> {
  return (
    loadJsonFile<{ bySession?: Record<string, AgentSeatMeta> }>(AGENT_SEATS_FILE)?.bySession ?? {}
  );
}

function loadSettings(): { soundEnabled: boolean } {
  return { soundEnabled: true, ...loadJsonFile<{ soundEnabled?: boolean }>(SETTINGS_FILE) };
}

/** Same transcript-directory mapping Claude Code uses: cwd → ~/.claude/projects/<sanitized>. */
function getProjectDirPath(cwd: string): string {
  return path.join(CLAUDE_PROJECTS_DIR, cwd.replace(/[^a-zA-Z0-9-]/g, '-'));
}

// The core asset loaders append 'assets/' themselves, so this returns the
// PARENT of the assets directory (resources/ in packaged builds, which
// electron-builder populates via extraResources → assets).
function getAssetsRoot(): string {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  // __dirname is dist-electron/electron in dev builds
  return path.join(__dirname, '..', '..', 'webview-ui', 'public');
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

  const record: PtyRecord = {
    proc,
    label: opts.label,
    scrollback: '',
    sessionId: opts.sessionId,
    lastInputAt: Date.now(),
  };
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
    // agentToPty/ptyToAgent are kept so clicking the character still focuses
    // the (exited) terminal tab; they're cleaned up in removeAgent.
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

// ── Agent lifecycle (internal sessions only) ─────────────────
function launchAgent(cwd: string): void {
  const sessionId = crypto.randomUUID();
  const projectDir = getProjectDirPath(cwd);
  const expectedFile = path.join(projectDir, `${sessionId}.jsonl`);
  // Pre-register so the /clear scan won't treat this session's own file as new
  knownJsonlFiles.add(expectedFile);

  const label = `Agent ${nextTerminalIndex++}`;
  const ptyId = spawnPty({
    cwd,
    command: `claude --session-id ${sessionId}`,
    sessionId,
    label,
  });

  const id = nextAgentId++;
  const agent: AgentState = {
    ...createCoreAgentState(id, projectDir, expectedFile),
    ptyId,
    sessionId,
    cwd,
  };
  ctx.agents.set(id, agent);
  agentToPty.set(id, ptyId);
  ptyToAgent.set(ptyId, id);

  console.log(`Agent ${id}: launched session ${sessionId} in ${cwd}`);
  ctx.send({ type: 'pty-created', ptyId, label });
  ctx.send({ type: 'agentCreated', id, ptyId, folderName: path.basename(cwd) });

  ensureProjectScan(projectDir);
  pollForJsonlFile(id);
}

/** Poll until the agent's JSONL file appears, then start watching it. */
function pollForJsonlFile(agentId: number): void {
  const timer = setInterval(() => {
    const agent = ctx.agents.get(agentId);
    if (!agent) {
      clearInterval(timer);
      jsonlPollTimers.delete(agentId);
      return;
    }
    try {
      if (fs.existsSync(agent.jsonlFile)) {
        console.log(`Agent ${agentId}: found JSONL ${path.basename(agent.jsonlFile)}`);
        clearInterval(timer);
        jsonlPollTimers.delete(agentId);
        startFileWatching(ctx, agentId, agent.jsonlFile);
        readNewLines(ctx, agentId);
      }
    } catch {
      /* file may not exist yet */
    }
  }, JSONL_POLL_INTERVAL_MS);
  jsonlPollTimers.set(agentId, timer);
}

function removeAgent(agentId: number): void {
  const agent = ctx.agents.get(agentId);
  if (!agent) return;

  const jp = jsonlPollTimers.get(agentId);
  if (jp) clearInterval(jp);
  jsonlPollTimers.delete(agentId);

  stopFileWatching(ctx, agentId, agent.jsonlFile);
  cancelWaitingTimer(ctx, agentId);
  cancelPermissionTimer(ctx, agentId);

  const ptyId = agentToPty.get(agentId);
  if (ptyId) {
    agentToPty.delete(agentId);
    ptyToAgent.delete(ptyId);
  }
  ctx.agents.delete(agentId);

  // Stop scanning project dirs no other agent uses
  let dirStillUsed = false;
  for (const a of ctx.agents.values()) {
    if (a.projectDir === agent.projectDir) {
      dirStillUsed = true;
      break;
    }
  }
  if (!dirStillUsed) {
    const st = projectScanTimers.get(agent.projectDir);
    if (st) clearInterval(st);
    projectScanTimers.delete(agent.projectDir);
  }
}

// ── /clear detection ─────────────────────────────────────────
// `/clear` makes claude start a NEW transcript file in the same project dir.
// We scan each internal agent's project dir; a new file is reassigned to the
// agent there whose terminal most recently received input (the /clear was
// typed into some terminal — that one had the last keystrokes).
function ensureProjectScan(projectDir: string): void {
  if (projectScanTimers.has(projectDir)) return;
  try {
    for (const f of fs.readdirSync(projectDir)) {
      if (f.endsWith('.jsonl')) knownJsonlFiles.add(path.join(projectDir, f));
    }
  } catch {
    /* dir may not exist yet */
  }

  const timer = setInterval(() => {
    scanForNewJsonlFiles(projectDir);
  }, PROJECT_SCAN_INTERVAL_MS);
  projectScanTimers.set(projectDir, timer);
}

function scanForNewJsonlFiles(projectDir: string): void {
  let files: string[];
  try {
    files = fs
      .readdirSync(projectDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(projectDir, f));
  } catch {
    return;
  }

  // Prune deleted files so the known set doesn't grow forever
  const current = new Set(files);
  for (const known of knownJsonlFiles) {
    if (known.startsWith(projectDir + path.sep) && !current.has(known)) {
      knownJsonlFiles.delete(known);
    }
  }

  for (const file of files) {
    if (knownJsonlFiles.has(file)) continue;
    knownJsonlFiles.add(file);

    const target = mostRecentlyTypedAgentIn(projectDir);
    if (!target) continue; // no internal agent here — external activity, ignore
    console.log(
      `[Pixel Agents] New JSONL ${path.basename(file)} → reassigning agent ${target.id} (/clear)`,
    );
    reassignAgentToFile(target, file);
  }
}

function mostRecentlyTypedAgentIn(projectDir: string): AgentState | null {
  let best: AgentState | null = null;
  let bestTime = -1;
  for (const agent of ctx.agents.values()) {
    if (agent.projectDir !== projectDir) continue;
    const t = ptys.get(agent.ptyId)?.lastInputAt ?? 0;
    if (t > bestTime) {
      bestTime = t;
      best = agent;
    }
  }
  return best;
}

function reassignAgentToFile(agent: AgentState, newFilePath: string): void {
  stopFileWatching(ctx, agent.id, agent.jsonlFile);
  cancelWaitingTimer(ctx, agent.id);
  cancelPermissionTimer(ctx, agent.id);
  clearAgentActivity(ctx, agent.id);

  const newSessionId = path.basename(newFilePath, '.jsonl');
  ptySessionIds.delete(agent.sessionId);
  ptySessionIds.set(newSessionId, agent.ptyId);
  const record = ptys.get(agent.ptyId);
  if (record) record.sessionId = newSessionId;

  agent.sessionId = newSessionId;
  agent.jsonlFile = newFilePath;
  agent.fileOffset = 0;
  agent.lineBuffer = Buffer.alloc(0);

  startFileWatching(ctx, agent.id, newFilePath);
  readNewLines(ctx, agent.id);
}

// ── Renderer message handling ────────────────────────────────
function isTrustedSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  return mainWindow !== null && event.sender === mainWindow.webContents;
}

function setupIpcHandlers(): void {
  // PTY I/O — keystrokes and geometry only; commands are built in main.
  ipcMain.on('pty-input', (event, opts: { id: string; data: string }) => {
    if (!isTrustedSender(event)) return;
    const record = ptys.get(opts.id);
    if (record) {
      record.lastInputAt = Date.now();
      record.proc.write(opts.data);
    }
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
    handleWebviewMessage(msg as WebviewToHostMessage);
  });
}

function handleWebviewMessage(msg: WebviewToHostMessage): void {
  if (msg.type === 'webviewReady') {
    onWebviewReady();
  } else if (msg.type === 'openClaude') {
    launchAgent(msg.folderPath || os.homedir());
  } else if (msg.type === 'saveLayout') {
    if (isValidLayout(msg.layout)) {
      layoutWatcher?.markOwnWrite();
      writeLayoutToFile(msg.layout);
    }
  } else if (msg.type === 'saveAgentSeats') {
    saveAgentSeats(msg.seats);
  } else if (msg.type === 'setSoundEnabled') {
    saveJsonFile(SETTINGS_FILE, { soundEnabled: !!msg.enabled });
  } else if (msg.type === 'closeAgent') {
    const id = msg.id;
    const ptyId = agentToPty.get(id);
    if (ptyId) {
      ctx.send({ type: 'pty-close-tab', ptyId });
      killPty(ptyId);
    }
    removeAgent(id);
    ctx.send({ type: 'agentClosed', id });
  } else if (msg.type === 'focusAgent') {
    const agent = ctx.agents.get(msg.id);
    if (agent) {
      ctx.send({ type: 'pty-focus', ptyId: agent.ptyId, agentId: msg.id });
    }
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
    if (metaBySession[agent.sessionId]) {
      agentMeta[id] = metaBySession[agent.sessionId];
    }
    folderNames[id] = path.basename(agent.cwd);
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
  // Re-key by session id so the metadata survives window reloads (agent ids don't)
  const bySession = loadSeatMetaBySession();
  for (const [idStr, meta] of Object.entries(seatsById)) {
    const agent = ctx.agents.get(Number(idStr));
    if (agent) {
      bySession[agent.sessionId] = meta;
    }
  }
  saveJsonFile(AGENT_SEATS_FILE, { bySession });
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
  layoutWatcher?.dispose();
  layoutWatcher = null;
  for (const timer of projectScanTimers.values()) clearInterval(timer);
  projectScanTimers.clear();
  for (const id of [...ctx.agents.keys()]) removeAgent(id);
  for (const ptyId of [...ptys.keys()]) killPty(ptyId);
  ptys.clear();
}

app.whenReady().then(() => {
  fixPathEnv();
  setupIpcHandlers();

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
  // On macOS the app keeps running (dock icon) — agents and PTYs must
  // survive so reopening the window restores everything.
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
