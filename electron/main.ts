import { execFileSync } from 'child_process';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import * as fs from 'fs';
import * as pty from 'node-pty';
import * as os from 'os';
import * as path from 'path';

import type { AgentSeatMeta, ResumableSession, WebviewToHostMessage } from '../shared/protocol.js';
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
import { type ChatSession, startChatSession } from './chatAgent.js';
import { addTodo, deleteTodo, getAllTodoPaths, getTodos, toggleTodo } from './todos.js';
import { recordTurnUsage, summarizeUsage } from './usage.js';
import {
  loadWorkspaces,
  removeWorkspace as removeWorkspaceEntry,
  touchWorkspace,
} from './workspaces.js';

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
// Agents exist ONLY for sessions this app spawned (internal sessions):
// terminal agents own a PTY running claude; chat agents own an Agent SDK
// session. External Claude sessions (iTerm, VS Code, ...) are not tracked.
interface AgentState extends CoreAgentState {
  kind: 'terminal' | 'chat';
  /** Set for terminal agents only. */
  ptyId?: string;
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

// Chat (Agent SDK) state
const chatSessions = new Map<number, ChatSession>(); // agentId → session

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
    fs.mkdirSync(path.dirname(file), { recursive: true });
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

/** Per-workspace office layout file (~/.pixel-agents/layouts/<sanitized>.json). */
function getWorkspaceLayoutFile(workspacePath: string): string {
  return path.join(DATA_DIR, 'layouts', `${workspacePath.replace(/[^a-zA-Z0-9-]/g, '-')}.json`);
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

    // The agent's lifecycle IS its terminal's lifecycle: when the PTY exits
    // (tab closed, `exit` typed, claude finished), the character goes too.
    const agentId = ptyToAgent.get(ptyId);
    if (agentId !== undefined) {
      removeAgent(agentId);
      ctx.send({ type: 'agentClosed', id: agentId });
    }
    // Close the tab on a clean exit; keep it visible after a crash so the
    // error output can be read (the tab shows an exited marker and can be
    // closed manually).
    if (exitCode === 0) {
      ctx.send({ type: 'pty-close-tab', ptyId });
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

// ── Agent lifecycle (internal sessions only) ─────────────────
/** Registers the office character + transcript watching shared by both agent kinds. */
function registerAgent(
  kind: 'terminal' | 'chat',
  cwd: string,
  sessionId: string,
  skipToEnd = false,
): AgentState {
  const projectDir = getProjectDirPath(cwd);
  const expectedFile = path.join(projectDir, `${sessionId}.jsonl`);
  // Pre-register so the /clear scan won't treat this session's own file as new
  knownJsonlFiles.add(expectedFile);

  const id = nextAgentId++;
  const agent: AgentState = {
    ...createCoreAgentState(id, projectDir, expectedFile),
    kind,
    sessionId,
    cwd,
  };
  ctx.agents.set(id, agent);
  pollForJsonlFile(id, skipToEnd);
  return agent;
}

function launchAgent(cwd: string): void {
  const sessionId = crypto.randomUUID();
  const label = `Agent ${nextTerminalIndex++}`;
  const ptyId = spawnPty({
    cwd,
    command: `claude --session-id ${sessionId}`,
    sessionId,
    label,
  });

  const agent = registerAgent('terminal', cwd, sessionId);
  agent.ptyId = ptyId;
  agentToPty.set(agent.id, ptyId);
  ptyToAgent.set(ptyId, agent.id);

  console.log(`Agent ${agent.id}: launched terminal session ${sessionId} in ${cwd}`);
  ctx.send({ type: 'pty-created', ptyId, label });
  ctx.send({
    type: 'agentCreated',
    id: agent.id,
    ptyId,
    agentKind: 'terminal',
    folderName: path.basename(cwd),
    workspacePath: cwd,
  });
  ctx.send({ type: 'workspacesLoaded', workspaces: touchWorkspace(cwd) });
  ensureProjectScan(agent.projectDir);
}

function launchChatAgent(cwd: string, resumeSessionId?: string, initialPrompt?: string): void {
  const sessionId = resumeSessionId ?? crypto.randomUUID();
  const agent = registerAgent('chat', cwd, sessionId, !!resumeSessionId);
  const label = `Agent ${nextTerminalIndex++}`;

  const session = startChatSession({
    agentId: agent.id,
    sessionId,
    cwd,
    label,
    resume: !!resumeSessionId,
    send: ctx.send,
    onTurnComplete: (costUsd, durationMs) => {
      recordTurnUsage(cwd, costUsd, durationMs);
    },
    onExit: () => {
      // The SDK loop ended on its own (error or shutdown) — retire the
      // character but leave the tab so any error output stays readable.
      chatSessions.delete(agent.id);
      if (ctx.agents.has(agent.id)) {
        removeAgent(agent.id);
        ctx.send({ type: 'agentClosed', id: agent.id });
      }
    },
  });
  chatSessions.set(agent.id, session);

  ctx.send({ type: 'chat-created', agentId: agent.id, label });
  ctx.send({
    type: 'agentCreated',
    id: agent.id,
    agentKind: 'chat',
    folderName: path.basename(cwd),
    workspacePath: cwd,
  });
  ctx.send({ type: 'workspacesLoaded', workspaces: touchWorkspace(cwd) });
  if (initialPrompt) {
    session.send(initialPrompt);
  }
}

/** Poll until the agent's JSONL file appears, then start watching it. */
function pollForJsonlFile(agentId: number, skipToEnd = false): void {
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
        if (skipToEnd) {
          // Resumed session — don't replay the whole history into the office
          agent.fileOffset = fs.statSync(agent.jsonlFile).size;
        }
        startFileWatching(ctx, agentId, agent.jsonlFile);
        if (!skipToEnd) {
          readNewLines(ctx, agentId);
        }
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
    const t =
      agent.kind === 'terminal'
        ? agent.ptyId
          ? (ptys.get(agent.ptyId)?.lastInputAt ?? 0)
          : 0
        : (chatSessions.get(agent.id)?.lastInputAt ?? 0);
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
  if (agent.ptyId) {
    ptySessionIds.delete(agent.sessionId);
    ptySessionIds.set(newSessionId, agent.ptyId);
    const record = ptys.get(agent.ptyId);
    if (record) record.sessionId = newSessionId;
  }

  agent.sessionId = newSessionId;
  agent.jsonlFile = newFilePath;
  agent.fileOffset = 0;
  agent.lineBuffer = Buffer.alloc(0);

  startFileWatching(ctx, agent.id, newFilePath);
  readNewLines(ctx, agent.id);
}

// ── Session resume ───────────────────────────────────────────
const RESUME_LIST_MAX = 20;
const PREVIEW_READ_BYTES = 65536;
const PREVIEW_MAX_CHARS = 120;

/**
 * True for synthetic user records Claude Code writes into transcripts:
 * slash-command bookkeeping (<command-name>…), local command output
 * (<local-command-stdout>…), the local-command caveat, system reminders,
 * and interrupt markers. None of these are what the human actually asked.
 */
function isSyntheticUserText(text: string): boolean {
  return text.startsWith('<') || text.startsWith('[Request interrupted');
}

/** Reads the first real user prompt from a transcript for the resume picker. */
function readSessionPreview(jsonlFile: string): string {
  try {
    const fd = fs.openSync(jsonlFile, 'r');
    const buf = Buffer.alloc(PREVIEW_READ_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    for (const line of buf.toString('utf-8', 0, bytesRead).split('\n')) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as {
          type?: string;
          isMeta?: boolean;
          message?: { content?: unknown };
        };
        if (record.type !== 'user' || record.isMeta) continue;
        const content = record.message?.content;
        const candidates: string[] = [];
        if (typeof content === 'string') {
          candidates.push(content);
        } else if (Array.isArray(content)) {
          for (const b of content as Array<{ type?: string; text?: string }>) {
            if (b?.type === 'text' && b.text) candidates.push(b.text);
          }
        }
        for (const candidate of candidates) {
          const text = candidate.trim().replace(/\s+/g, ' ');
          if (text && !isSyntheticUserText(text)) {
            return text.length > PREVIEW_MAX_CHARS ? text.slice(0, PREVIEW_MAX_CHARS) + '…' : text;
          }
        }
      } catch {
        /* partial line */
      }
    }
  } catch {
    /* unreadable */
  }
  return '(no prompt)';
}

function listResumableSessions(cwd: string): ResumableSession[] {
  const projectDir = getProjectDirPath(cwd);
  const activeSessionIds = new Set([...ctx.agents.values()].map((a) => a.sessionId));
  let files: Array<{ file: string; mtimeMs: number }>;
  try {
    files = fs
      .readdirSync(projectDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const file = path.join(projectDir, f);
        return { file, mtimeMs: fs.statSync(file).mtimeMs };
      });
  } catch {
    return [];
  }
  return files
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .filter(({ file }) => !activeSessionIds.has(path.basename(file, '.jsonl')))
    .slice(0, RESUME_LIST_MAX)
    .map(({ file, mtimeMs }) => ({
      sessionId: path.basename(file, '.jsonl'),
      mtimeMs,
      preview: readSessionPreview(file),
    }));
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

/** Resolves the working directory for a new agent, showing a picker when needed. */
async function resolveAgentCwd(folderPath: string | undefined): Promise<string | null> {
  if (folderPath) return folderPath;
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a project folder for this agent',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: os.homedir(),
  });
  return result.filePaths[0] ?? null;
}

function handleWebviewMessage(msg: WebviewToHostMessage): void {
  if (msg.type === 'webviewReady') {
    onWebviewReady();
  } else if (msg.type === 'openClaude') {
    void resolveAgentCwd(msg.folderPath).then((cwd) => {
      if (cwd) launchAgent(cwd);
    });
  } else if (msg.type === 'openChatAgent') {
    void resolveAgentCwd(msg.folderPath).then((cwd) => {
      if (cwd) launchChatAgent(cwd);
    });
  } else if (msg.type === 'chatSend') {
    chatSessions.get(msg.id)?.send(msg.text, msg.images);
  } else if (msg.type === 'chatInterrupt') {
    chatSessions.get(msg.id)?.interrupt();
  } else if (msg.type === 'chatReady') {
    const session = chatSessions.get(msg.id);
    if (session) {
      ctx.send({ type: 'chat-replay', agentId: msg.id, events: session.history });
      ctx.send({ type: 'chat-busy', agentId: msg.id, busy: session.busy });
    }
  } else if (msg.type === 'chatPermissionResponse') {
    chatSessions.get(msg.id)?.respondPermission(msg.requestId, msg.allow, msg.message);
  } else if (msg.type === 'chatSetPermissionMode') {
    chatSessions.get(msg.id)?.setMode(msg.mode);
  } else if (msg.type === 'listResumableSessions') {
    void (async () => {
      const cwd = await resolveAgentCwd(msg.folderPath);
      if (cwd) {
        ctx.send({ type: 'sessionList', folderPath: cwd, sessions: listResumableSessions(cwd) });
      }
    })();
  } else if (msg.type === 'addWorkspace') {
    void (async () => {
      const cwd = await resolveAgentCwd(undefined);
      if (cwd) {
        ctx.send({ type: 'workspacesLoaded', workspaces: touchWorkspace(cwd) });
      }
    })();
  } else if (msg.type === 'addTodo') {
    ctx.send({ type: 'workspaceTodos', path: msg.path, todos: addTodo(msg.path, msg.text) });
  } else if (msg.type === 'toggleTodo') {
    ctx.send({ type: 'workspaceTodos', path: msg.path, todos: toggleTodo(msg.path, msg.id) });
  } else if (msg.type === 'deleteTodo') {
    ctx.send({ type: 'workspaceTodos', path: msg.path, todos: deleteTodo(msg.path, msg.id) });
  } else if (msg.type === 'assignTodo') {
    const todo = getTodos(msg.path).find((t) => t.id === msg.id);
    if (todo) {
      launchChatAgent(msg.path, undefined, todo.text);
    }
  } else if (msg.type === 'removeWorkspace') {
    ctx.send({ type: 'workspacesLoaded', workspaces: removeWorkspaceEntry(msg.path) });
  } else if (msg.type === 'resumeChatAgent') {
    launchChatAgent(msg.folderPath, msg.sessionId);
  } else if (msg.type === 'saveLayout') {
    if (isValidLayout(msg.layout)) {
      if (msg.workspacePath) {
        saveJsonFile(getWorkspaceLayoutFile(msg.workspacePath), msg.layout);
      } else {
        layoutWatcher?.markOwnWrite();
        writeLayoutToFile(msg.layout);
      }
    }
  } else if (msg.type === 'saveAgentSeats') {
    saveAgentSeats(msg.seats);
  } else if (msg.type === 'setSoundEnabled') {
    saveJsonFile(SETTINGS_FILE, { soundEnabled: !!msg.enabled });
  } else if (msg.type === 'closeAgent') {
    const id = msg.id;
    const chat = chatSessions.get(id);
    const ptyId = agentToPty.get(id);
    if (chat) {
      chatSessions.delete(id);
      chat.dispose();
      ctx.send({ type: 'chat-close-tab', agentId: id });
      removeAgent(id);
      ctx.send({ type: 'agentClosed', id });
    } else if (ptyId && ptys.has(ptyId)) {
      // Killing the PTY triggers onExit, which removes the agent and
      // announces agentClosed — one path for all terminal deaths.
      ctx.send({ type: 'pty-close-tab', ptyId });
      killPty(ptyId);
    } else {
      removeAgent(id);
      ctx.send({ type: 'agentClosed', id });
    }
  } else if (msg.type === 'focusAgent') {
    const agent = ctx.agents.get(msg.id);
    if (agent?.kind === 'chat') {
      ctx.send({ type: 'chat-focus', agentId: msg.id });
    } else if (agent?.ptyId) {
      ctx.send({ type: 'pty-focus', ptyId: agent.ptyId, agentId: msg.id });
    }
  } else if (msg.type === 'getUsageSummary') {
    ctx.send({ type: 'usageSummary', summary: summarizeUsage() });
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
  // Same for chat tabs — each ChatView requests its history via 'chatReady'.
  for (const [agentId, session] of chatSessions) {
    ctx.send({ type: 'chat-created', agentId, label: session.label });
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

    // Per-workspace layout overrides (offices with their own saved design)
    for (const ws of loadWorkspaces()) {
      const wsLayout = loadJsonFile<Record<string, unknown>>(getWorkspaceLayoutFile(ws.path));
      if (wsLayout && isValidLayout(wsLayout)) {
        ctx.send({ type: 'layoutLoaded', layout: wsLayout, workspacePath: ws.path });
      }
    }
  })();

  // Send settings
  ctx.send({ type: 'settingsLoaded', soundEnabled: loadSettings().soundEnabled });

  // Send registered workspaces (offices)
  ctx.send({ type: 'workspacesLoaded', workspaces: loadWorkspaces() });

  // Send human todos + live agent plans
  for (const p of getAllTodoPaths()) {
    ctx.send({ type: 'workspaceTodos', path: p, todos: getTodos(p) });
  }
  for (const [agentId, session] of chatSessions) {
    if (session.latestTodos.length > 0) {
      ctx.send({ type: 'agent-todos', agentId, todos: session.latestTodos });
    }
  }

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
  for (const session of chatSessions.values()) session.dispose();
  chatSessions.clear();
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
