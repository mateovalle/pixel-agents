import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PNG } from 'pngjs';
import * as pty from 'node-pty';

// ── Constants ────────────────────────────────────────────────
const POLL_INTERVAL_MS = 2000;
const TOOL_DONE_DELAY_MS = 300;
const PERMISSION_TIMER_DELAY_MS = 7000;
const TEXT_IDLE_DELAY_MS = 5000;
const PNG_ALPHA_THRESHOLD = 128;
const SCAN_INTERVAL_MS = 3000;
const SESSION_STALE_MS = 24 * 60 * 60 * 1000; // 24h

const CHAR_COUNT = 6;
const CHAR_FRAME_W = 16;
const CHAR_FRAME_H = 32;
const CHAR_FRAMES_PER_ROW = 7;
const CHARACTER_DIRECTIONS = ['down', 'up', 'right'] as const;
const FLOOR_PATTERN_COUNT = 7;
const FLOOR_TILE_SIZE = 16;
const WALL_BITMASK_COUNT = 16;
const WALL_GRID_COLS = 4;
const WALL_PIECE_WIDTH = 16;
const WALL_PIECE_HEIGHT = 32;
const BASH_COMMAND_DISPLAY_MAX_LENGTH = 30;
const TASK_DESCRIPTION_DISPLAY_MAX_LENGTH = 40;

const LAYOUT_DIR = path.join(os.homedir(), '.pixel-agents');
const LAYOUT_FILE = path.join(LAYOUT_DIR, 'layout.json');
const DISMISSED_SESSIONS_FILE = path.join(LAYOUT_DIR, 'dismissed-sessions.json');
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const PERMISSION_EXEMPT_TOOLS = new Set(['Task', 'AskUserQuestion']);

// ── Types ────────────────────────────────────────────────────
interface AgentState {
  id: number;
  projectDir: string;
  jsonlFile: string;
  fileOffset: number;
  lineBuffer: string;
  activeToolIds: Set<string>;
  activeToolStatuses: Map<string, string>;
  activeToolNames: Map<string, string>;
  activeSubagentToolIds: Map<string, Set<string>>;
  activeSubagentToolNames: Map<string, Map<string, string>>;
  isWaiting: boolean;
  permissionSent: boolean;
  hadToolsInTurn: boolean;
  ptyId?: string;
  sessionId?: string;
  cwd?: string; // Workspace path extracted from JSONL
}

// ── Dismissed Sessions Persistence ───────────────────────────
function loadDismissedSessions(): string[] {
  try {
    if (fs.existsSync(DISMISSED_SESSIONS_FILE)) {
      return JSON.parse(fs.readFileSync(DISMISSED_SESSIONS_FILE, 'utf-8'));
    }
  } catch { /* ignore */ }
  return [];
}

function saveDismissedSessions(): void {
  try {
    if (!fs.existsSync(LAYOUT_DIR)) fs.mkdirSync(LAYOUT_DIR, { recursive: true });
    fs.writeFileSync(DISMISSED_SESSIONS_FILE, JSON.stringify([...dismissedJsonlFiles]), 'utf-8');
  } catch { /* ignore */ }
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
      } catch { /* partial line */ }
    }
  } catch { /* ignore */ }
  return undefined;
}

// ── State ────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;
const agents = new Map<number, AgentState>();
let nextAgentId = 1;
const knownJsonlFiles = new Set<string>();
const dismissedJsonlFiles = new Set<string>(loadDismissedSessions());
const fileWatchers = new Map<number, fs.FSWatcher>();
const pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
const waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
const permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();
let scanTimer: ReturnType<typeof setInterval> | null = null;

// PTY state
const ptyProcesses = new Map<string, pty.IPty>();
const ptySessionIds = new Map<string, string>(); // sessionId → ptyId
const agentToPty = new Map<number, string>();     // agentId → ptyId
const ptyToAgent = new Map<string, number>();      // ptyId → agentId

// ── Helpers ──────────────────────────────────────────────────
function send(msg: unknown): void {
  mainWindow?.webContents.send('main-message', msg);
}

function getAssetsRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets');
  }
  return path.join(__dirname, '..', 'webview-ui', 'public', 'assets');
}

// ── PNG Parsing ──────────────────────────────────────────────
function pngToSpriteData(pngBuffer: Buffer, width: number, height: number): string[][] {
  try {
    const png = PNG.sync.read(pngBuffer);
    const sprite: string[][] = [];
    for (let y = 0; y < height; y++) {
      const row: string[] = [];
      for (let x = 0; x < width; x++) {
        const idx = (y * png.width + x) * 4;
        const r = png.data[idx];
        const g = png.data[idx + 1];
        const b = png.data[idx + 2];
        const a = png.data[idx + 3];
        if (a < PNG_ALPHA_THRESHOLD) {
          row.push('');
        } else {
          row.push(
            `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase(),
          );
        }
      }
      sprite.push(row);
    }
    return sprite;
  } catch {
    return Array.from({ length: height }, () => new Array(width).fill(''));
  }
}

// ── Asset Loading ────────────────────────────────────────────
function loadCharacterSprites(assetsRoot: string): void {
  try {
    const charDir = path.join(assetsRoot, 'characters');
    const characters: Array<{ down: string[][][]; up: string[][][]; right: string[][][] }> = [];

    for (let ci = 0; ci < CHAR_COUNT; ci++) {
      const filePath = path.join(charDir, `char_${ci}.png`);
      if (!fs.existsSync(filePath)) return;
      const png = PNG.sync.read(fs.readFileSync(filePath));
      const charData: { down: string[][][]; up: string[][][]; right: string[][][] } = {
        down: [],
        up: [],
        right: [],
      };
      for (let dirIdx = 0; dirIdx < CHARACTER_DIRECTIONS.length; dirIdx++) {
        const dir = CHARACTER_DIRECTIONS[dirIdx];
        const rowY = dirIdx * CHAR_FRAME_H;
        const frames: string[][][] = [];
        for (let f = 0; f < CHAR_FRAMES_PER_ROW; f++) {
          const sprite: string[][] = [];
          const frameX = f * CHAR_FRAME_W;
          for (let y = 0; y < CHAR_FRAME_H; y++) {
            const row: string[] = [];
            for (let x = 0; x < CHAR_FRAME_W; x++) {
              const idx = ((rowY + y) * png.width + (frameX + x)) * 4;
              const r = png.data[idx];
              const g = png.data[idx + 1];
              const b = png.data[idx + 2];
              const a = png.data[idx + 3];
              row.push(
                a < PNG_ALPHA_THRESHOLD
                  ? ''
                  : `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase(),
              );
            }
            sprite.push(row);
          }
          frames.push(sprite);
        }
        charData[dir] = frames;
      }
      characters.push(charData);
    }
    send({ type: 'characterSpritesLoaded', characters });
  } catch (err) {
    console.error('Failed to load character sprites:', err);
  }
}

function loadFloorTiles(assetsRoot: string): void {
  try {
    const floorPath = path.join(assetsRoot, 'floors.png');
    if (!fs.existsSync(floorPath)) return;
    const png = PNG.sync.read(fs.readFileSync(floorPath));
    const sprites: string[][][] = [];
    for (let t = 0; t < FLOOR_PATTERN_COUNT; t++) {
      const sprite: string[][] = [];
      for (let y = 0; y < FLOOR_TILE_SIZE; y++) {
        const row: string[] = [];
        for (let x = 0; x < FLOOR_TILE_SIZE; x++) {
          const px = t * FLOOR_TILE_SIZE + x;
          const idx = (y * png.width + px) * 4;
          const r = png.data[idx];
          const g = png.data[idx + 1];
          const b = png.data[idx + 2];
          const a = png.data[idx + 3];
          row.push(
            a < PNG_ALPHA_THRESHOLD
              ? ''
              : `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase(),
          );
        }
        sprite.push(row);
      }
      sprites.push(sprite);
    }
    send({ type: 'floorTilesLoaded', sprites });
  } catch (err) {
    console.error('Failed to load floor tiles:', err);
  }
}

function loadWallTiles(assetsRoot: string): void {
  try {
    const wallPath = path.join(assetsRoot, 'walls.png');
    if (!fs.existsSync(wallPath)) return;
    const png = PNG.sync.read(fs.readFileSync(wallPath));
    const sprites: string[][][] = [];
    for (let mask = 0; mask < WALL_BITMASK_COUNT; mask++) {
      const ox = (mask % WALL_GRID_COLS) * WALL_PIECE_WIDTH;
      const oy = Math.floor(mask / WALL_GRID_COLS) * WALL_PIECE_HEIGHT;
      const sprite: string[][] = [];
      for (let r = 0; r < WALL_PIECE_HEIGHT; r++) {
        const row: string[] = [];
        for (let c = 0; c < WALL_PIECE_WIDTH; c++) {
          const idx = ((oy + r) * png.width + (ox + c)) * 4;
          const rv = png.data[idx];
          const gv = png.data[idx + 1];
          const bv = png.data[idx + 2];
          const av = png.data[idx + 3];
          row.push(
            av < PNG_ALPHA_THRESHOLD
              ? ''
              : `#${rv.toString(16).padStart(2, '0')}${gv.toString(16).padStart(2, '0')}${bv.toString(16).padStart(2, '0')}`.toUpperCase(),
          );
        }
        sprite.push(row);
      }
      sprites.push(sprite);
    }
    send({ type: 'wallTilesLoaded', sprites });
  } catch (err) {
    console.error('Failed to load wall tiles:', err);
  }
}

function loadFurnitureAssets(assetsRoot: string): void {
  try {
    const catalogPath = path.join(assetsRoot, 'furniture', 'furniture-catalog.json');
    if (!fs.existsSync(catalogPath)) return;
    const catalogData = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
    const catalog = catalogData.assets || [];
    const sprites: Record<string, string[][]> = {};

    for (const asset of catalog) {
      try {
        let filePath = asset.file;
        if (!filePath.startsWith('assets/')) filePath = `assets/${filePath}`;
        // Resolve relative to parent of assetsRoot (since assetsRoot IS the assets dir)
        const assetPath = path.join(assetsRoot, '..', filePath);
        if (!fs.existsSync(assetPath)) {
          // Try directly in assetsRoot
          const altPath = path.join(assetsRoot, filePath.replace(/^assets\//, ''));
          if (fs.existsSync(altPath)) {
            sprites[asset.id] = pngToSpriteData(fs.readFileSync(altPath), asset.width, asset.height);
          }
          continue;
        }
        sprites[asset.id] = pngToSpriteData(fs.readFileSync(assetPath), asset.width, asset.height);
      } catch {
        // skip
      }
    }
    send({ type: 'furnitureAssetsLoaded', catalog, sprites });
  } catch (err) {
    console.error('Failed to load furniture assets:', err);
  }
}

function loadDefaultLayout(assetsRoot: string): Record<string, unknown> | null {
  try {
    const layoutPath = path.join(assetsRoot, 'default-layout.json');
    if (!fs.existsSync(layoutPath)) return null;
    return JSON.parse(fs.readFileSync(layoutPath, 'utf-8'));
  } catch {
    return null;
  }
}

// ── Layout Persistence ───────────────────────────────────────
function readLayout(): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(LAYOUT_FILE)) return null;
    return JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function writeLayout(layout: Record<string, unknown>): void {
  try {
    if (!fs.existsSync(LAYOUT_DIR)) fs.mkdirSync(LAYOUT_DIR, { recursive: true });
    const tmp = LAYOUT_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(layout, null, 2), 'utf-8');
    fs.renameSync(tmp, LAYOUT_FILE);
  } catch (err) {
    console.error('Failed to write layout:', err);
  }
}

// ── Transcript Parsing ───────────────────────────────────────
function formatToolStatus(toolName: string, input: Record<string, unknown>): string {
  const base = (p: unknown) => (typeof p === 'string' ? path.basename(p) : '');
  switch (toolName) {
    case 'Read':
      return `Reading ${base(input.file_path)}`;
    case 'Edit':
      return `Editing ${base(input.file_path)}`;
    case 'Write':
      return `Writing ${base(input.file_path)}`;
    case 'Bash': {
      const cmd = (input.command as string) || '';
      return `Running: ${cmd.length > BASH_COMMAND_DISPLAY_MAX_LENGTH ? cmd.slice(0, BASH_COMMAND_DISPLAY_MAX_LENGTH) + '\u2026' : cmd}`;
    }
    case 'Glob':
      return 'Searching files';
    case 'Grep':
      return 'Searching code';
    case 'WebFetch':
      return 'Fetching web content';
    case 'WebSearch':
      return 'Searching the web';
    case 'Task': {
      const desc = typeof input.description === 'string' ? input.description : '';
      return desc
        ? `Subtask: ${desc.length > TASK_DESCRIPTION_DISPLAY_MAX_LENGTH ? desc.slice(0, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH) + '\u2026' : desc}`
        : 'Running subtask';
    }
    case 'AskUserQuestion':
      return 'Waiting for your answer';
    case 'EnterPlanMode':
      return 'Planning';
    case 'NotebookEdit':
      return 'Editing notebook';
    default:
      return `Using ${toolName}`;
  }
}

function cancelWaitingTimer(agentId: number): void {
  const timer = waitingTimers.get(agentId);
  if (timer) {
    clearTimeout(timer);
    waitingTimers.delete(agentId);
  }
}

function startWaitingTimer(agentId: number, delayMs: number): void {
  cancelWaitingTimer(agentId);
  const timer = setTimeout(() => {
    waitingTimers.delete(agentId);
    const agent = agents.get(agentId);
    if (agent) agent.isWaiting = true;
    send({ type: 'agentStatus', id: agentId, status: 'waiting' });
  }, delayMs);
  waitingTimers.set(agentId, timer);
}

function cancelPermissionTimer(agentId: number): void {
  const timer = permissionTimers.get(agentId);
  if (timer) {
    clearTimeout(timer);
    permissionTimers.delete(agentId);
  }
}

function startPermissionTimer(agentId: number): void {
  cancelPermissionTimer(agentId);
  const timer = setTimeout(() => {
    permissionTimers.delete(agentId);
    const agent = agents.get(agentId);
    if (!agent) return;

    let hasNonExempt = false;
    for (const toolId of agent.activeToolIds) {
      if (!PERMISSION_EXEMPT_TOOLS.has(agent.activeToolNames.get(toolId) || '')) {
        hasNonExempt = true;
        break;
      }
    }

    const stuckSubagentParentToolIds: string[] = [];
    for (const [parentToolId, subToolNames] of agent.activeSubagentToolNames) {
      for (const [, toolName] of subToolNames) {
        if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
          stuckSubagentParentToolIds.push(parentToolId);
          hasNonExempt = true;
          break;
        }
      }
    }

    if (hasNonExempt) {
      agent.permissionSent = true;
      send({ type: 'agentToolPermission', id: agentId });
      for (const parentToolId of stuckSubagentParentToolIds) {
        send({ type: 'subagentToolPermission', id: agentId, parentToolId });
      }
    }
  }, PERMISSION_TIMER_DELAY_MS);
  permissionTimers.set(agentId, timer);
}

function clearAgentActivity(agent: AgentState): void {
  agent.activeToolIds.clear();
  agent.activeToolStatuses.clear();
  agent.activeToolNames.clear();
  agent.activeSubagentToolIds.clear();
  agent.activeSubagentToolNames.clear();
  agent.isWaiting = false;
  agent.permissionSent = false;
  cancelPermissionTimer(agent.id);
  send({ type: 'agentToolsClear', id: agent.id });
  send({ type: 'agentStatus', id: agent.id, status: 'active' });
}

function processTranscriptLine(agentId: number, line: string): void {
  const agent = agents.get(agentId);
  if (!agent) return;
  try {
    const record = JSON.parse(line);

    if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
      const blocks = record.message.content as Array<{
        type: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;
      const hasToolUse = blocks.some((b) => b.type === 'tool_use');

      if (hasToolUse) {
        cancelWaitingTimer(agentId);
        agent.isWaiting = false;
        agent.hadToolsInTurn = true;
        send({ type: 'agentStatus', id: agentId, status: 'active' });
        let hasNonExemptTool = false;
        for (const block of blocks) {
          if (block.type === 'tool_use' && block.id) {
            const toolName = block.name || '';
            const status = formatToolStatus(toolName, block.input || {});
            agent.activeToolIds.add(block.id);
            agent.activeToolStatuses.set(block.id, status);
            agent.activeToolNames.set(block.id, toolName);
            if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) hasNonExemptTool = true;
            send({ type: 'agentToolStart', id: agentId, toolId: block.id, status });
          }
        }
        if (hasNonExemptTool) startPermissionTimer(agentId);
      } else if (blocks.some((b) => b.type === 'text') && !agent.hadToolsInTurn) {
        startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS);
      }
    } else if (record.type === 'progress') {
      processProgressRecord(agentId, record);
    } else if (record.type === 'user') {
      const content = record.message?.content;
      if (Array.isArray(content)) {
        const hasToolResult = content.some((b: { type: string }) => b.type === 'tool_result');
        if (hasToolResult) {
          for (const block of content) {
            if (block.type === 'tool_result' && block.tool_use_id) {
              const completedToolId = block.tool_use_id;
              if (agent.activeToolNames.get(completedToolId) === 'Task') {
                agent.activeSubagentToolIds.delete(completedToolId);
                agent.activeSubagentToolNames.delete(completedToolId);
                send({ type: 'subagentClear', id: agentId, parentToolId: completedToolId });
              }
              agent.activeToolIds.delete(completedToolId);
              agent.activeToolStatuses.delete(completedToolId);
              agent.activeToolNames.delete(completedToolId);
              const toolId = completedToolId;
              setTimeout(() => send({ type: 'agentToolDone', id: agentId, toolId }), TOOL_DONE_DELAY_MS);
            }
          }
          if (agent.activeToolIds.size === 0) agent.hadToolsInTurn = false;
        } else {
          cancelWaitingTimer(agentId);
          clearAgentActivity(agent);
          agent.hadToolsInTurn = false;
        }
      } else if (typeof content === 'string' && content.trim()) {
        cancelWaitingTimer(agentId);
        clearAgentActivity(agent);
        agent.hadToolsInTurn = false;
      }
    } else if (record.type === 'system' && record.subtype === 'turn_duration') {
      cancelWaitingTimer(agentId);
      cancelPermissionTimer(agentId);
      if (agent.activeToolIds.size > 0) {
        agent.activeToolIds.clear();
        agent.activeToolStatuses.clear();
        agent.activeToolNames.clear();
        agent.activeSubagentToolIds.clear();
        agent.activeSubagentToolNames.clear();
        send({ type: 'agentToolsClear', id: agentId });
      }
      agent.isWaiting = true;
      agent.permissionSent = false;
      agent.hadToolsInTurn = false;
      send({ type: 'agentStatus', id: agentId, status: 'waiting' });
    }
  } catch {
    // Ignore malformed lines
  }
}

function processProgressRecord(agentId: number, record: Record<string, unknown>): void {
  const agent = agents.get(agentId);
  if (!agent) return;

  const parentToolId = record.parentToolUseID as string | undefined;
  if (!parentToolId) return;
  const data = record.data as Record<string, unknown> | undefined;
  if (!data) return;

  const dataType = data.type as string | undefined;
  if (dataType === 'bash_progress' || dataType === 'mcp_progress') {
    if (agent.activeToolIds.has(parentToolId)) startPermissionTimer(agentId);
    return;
  }

  if (agent.activeToolNames.get(parentToolId) !== 'Task') return;
  const msg = data.message as Record<string, unknown> | undefined;
  if (!msg) return;

  const msgType = msg.type as string;
  const innerMsg = msg.message as Record<string, unknown> | undefined;
  const content = innerMsg?.content;
  if (!Array.isArray(content)) return;

  if (msgType === 'assistant') {
    let hasNonExemptSubTool = false;
    for (const block of content) {
      if (block.type === 'tool_use' && block.id) {
        const toolName = block.name || '';
        const status = formatToolStatus(toolName, block.input || {});
        let subTools = agent.activeSubagentToolIds.get(parentToolId);
        if (!subTools) {
          subTools = new Set();
          agent.activeSubagentToolIds.set(parentToolId, subTools);
        }
        subTools.add(block.id);
        let subNames = agent.activeSubagentToolNames.get(parentToolId);
        if (!subNames) {
          subNames = new Map();
          agent.activeSubagentToolNames.set(parentToolId, subNames);
        }
        subNames.set(block.id, toolName);
        if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) hasNonExemptSubTool = true;
        send({ type: 'subagentToolStart', id: agentId, parentToolId, toolId: block.id, status });
      }
    }
    if (hasNonExemptSubTool) startPermissionTimer(agentId);
  } else if (msgType === 'user') {
    for (const block of content) {
      if (block.type === 'tool_result' && block.tool_use_id) {
        const subTools = agent.activeSubagentToolIds.get(parentToolId);
        if (subTools) subTools.delete(block.tool_use_id);
        const subNames = agent.activeSubagentToolNames.get(parentToolId);
        if (subNames) subNames.delete(block.tool_use_id);
        const toolId = block.tool_use_id;
        setTimeout(() => {
          send({ type: 'subagentToolDone', id: agentId, parentToolId, toolId });
        }, 300);
      }
    }
    let stillHasNonExempt = false;
    for (const [, subNames] of agent.activeSubagentToolNames) {
      for (const [, toolName] of subNames) {
        if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
          stillHasNonExempt = true;
          break;
        }
      }
      if (stillHasNonExempt) break;
    }
    if (stillHasNonExempt) startPermissionTimer(agentId);
  }
}

// ── File Watching ────────────────────────────────────────────
function readNewLines(agentId: number): void {
  const agent = agents.get(agentId);
  if (!agent) return;
  try {
    const stat = fs.statSync(agent.jsonlFile);
    if (stat.size <= agent.fileOffset) return;

    const buf = Buffer.alloc(stat.size - agent.fileOffset);
    const fd = fs.openSync(agent.jsonlFile, 'r');
    fs.readSync(fd, buf, 0, buf.length, agent.fileOffset);
    fs.closeSync(fd);
    agent.fileOffset = stat.size;

    const text = agent.lineBuffer + buf.toString('utf-8');
    const lines = text.split('\n');
    agent.lineBuffer = lines.pop() || '';

    const hasLines = lines.some((l) => l.trim());
    if (hasLines) {
      cancelWaitingTimer(agentId);
      cancelPermissionTimer(agentId);
      if (agent.permissionSent) {
        agent.permissionSent = false;
        send({ type: 'agentToolPermissionClear', id: agentId });
      }
    }

    for (const line of lines) {
      if (!line.trim()) continue;
      processTranscriptLine(agentId, line);
    }
  } catch {
    // File may have been removed
  }
}

function startFileWatching(agentId: number, filePath: string): void {
  try {
    const watcher = fs.watch(filePath, () => readNewLines(agentId));
    fileWatchers.set(agentId, watcher);
  } catch {
    // fs.watch may fail
  }

  try {
    fs.watchFile(filePath, { interval: POLL_INTERVAL_MS }, () => readNewLines(agentId));
  } catch {
    // watchFile may fail
  }

  const interval = setInterval(() => {
    if (!agents.has(agentId)) {
      clearInterval(interval);
      try {
        fs.unwatchFile(filePath);
      } catch {
        /* ignore */
      }
      return;
    }
    readNewLines(agentId);
  }, POLL_INTERVAL_MS);
  pollingTimers.set(agentId, interval);
}

function removeAgent(agentId: number): void {
  const agent = agents.get(agentId);
  if (!agent) return;

  fileWatchers.get(agentId)?.close();
  fileWatchers.delete(agentId);
  const pt = pollingTimers.get(agentId);
  if (pt) clearInterval(pt);
  pollingTimers.delete(agentId);
  try {
    fs.unwatchFile(agent.jsonlFile);
  } catch {
    /* ignore */
  }
  cancelWaitingTimer(agentId);
  cancelPermissionTimer(agentId);
  agents.delete(agentId);
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
  const agent: AgentState = {
    id,
    projectDir,
    jsonlFile,
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
  };

  // Skip to near end of file — only show recent activity
  try {
    const stat = fs.statSync(jsonlFile);
    // Read last 4KB to catch recent state
    const readBack = Math.min(stat.size, 4096);
    agent.fileOffset = stat.size - readBack;
  } catch {
    // Start from beginning if stat fails
  }

  // Extract workspace cwd from JSONL file
  agent.cwd = extractCwdFromJsonl(jsonlFile);

  // Link to PTY if this is a session we spawned
  const sessionId = path.basename(jsonlFile, '.jsonl');
  const linkedPtyId = ptySessionIds.get(sessionId);
  if (linkedPtyId) {
    agent.ptyId = linkedPtyId;
    agent.sessionId = sessionId;
    agentToPty.set(id, linkedPtyId);
    ptyToAgent.set(linkedPtyId, id);
  }

  agents.set(id, agent);
  console.log(`Agent ${id}: tracking ${path.basename(jsonlFile)} in ${agent.cwd || path.basename(projectDir)}`);
  send({ type: 'agentCreated', id, ptyId: linkedPtyId });

  startFileWatching(id, jsonlFile);
  readNewLines(id);
}

// ── IPC Handlers ─────────────────────────────────────────────
function setupPtyHandlers(): void {
  ipcMain.handle('pty-spawn', (_event, opts: { id: string; cmd: string; args: string[]; cwd: string }) => {
    const shell = opts.cmd || (process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/zsh');
    const proc = pty.spawn(shell, opts.args || [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: opts.cwd || os.homedir(),
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
    });

    ptyProcesses.set(opts.id, proc);

    proc.onData((data) => {
      send({ type: 'pty-output', ptyId: opts.id, data });
    });

    proc.onExit(({ exitCode }) => {
      send({ type: 'pty-exit', ptyId: opts.id, exitCode });
      ptyProcesses.delete(opts.id);
      const agentId = ptyToAgent.get(opts.id);
      if (agentId !== undefined) {
        agentToPty.delete(agentId);
        ptyToAgent.delete(opts.id);
      }
    });

    return { pid: proc.pid };
  });

  ipcMain.on('pty-input', (_event, opts: { id: string; data: string }) => {
    ptyProcesses.get(opts.id)?.write(opts.data);
  });

  ipcMain.on('pty-resize', (_event, opts: { id: string; cols: number; rows: number }) => {
    try {
      ptyProcesses.get(opts.id)?.resize(opts.cols, opts.rows);
    } catch {
      // Resize can fail if process already exited
    }
  });

  ipcMain.on('pty-kill', (_event, opts: { id: string }) => {
    ptyProcesses.get(opts.id)?.kill();
  });
}

function setupIpcHandlers(): void {
  setupPtyHandlers();

  ipcMain.on('webview-message', (_event, msg) => {
    if (msg.type === 'webviewReady') {
      const assetsRoot = getAssetsRoot();

      // Send existing agents
      const agentIds = [...agents.keys()].sort((a, b) => a - b);
      send({ type: 'existingAgents', agents: agentIds, agentMeta: {}, folderNames: {} });

      // Load and send assets
      loadCharacterSprites(assetsRoot);
      loadFloorTiles(assetsRoot);
      loadWallTiles(assetsRoot);
      loadFurnitureAssets(assetsRoot);

      // Send layout
      const layout = readLayout() || loadDefaultLayout(assetsRoot);
      if (layout && !readLayout()) writeLayout(layout);
      send({ type: 'layoutLoaded', layout });

      // Send settings
      send({ type: 'settingsLoaded', soundEnabled: true });

      // Re-send current agent statuses
      for (const [agentId, agent] of agents) {
        for (const [toolId, status] of agent.activeToolStatuses) {
          send({ type: 'agentToolStart', id: agentId, toolId, status });
        }
        if (agent.isWaiting) {
          send({ type: 'agentStatus', id: agentId, status: 'waiting' });
        }
      }
    } else if (msg.type === 'openClaude') {
      const sessionId = crypto.randomUUID();
      const ptyId = crypto.randomUUID();
      const cwd = (msg.folderPath as string) || os.homedir();
      ptySessionIds.set(sessionId, ptyId);
      send({ type: 'pty-created', ptyId, sessionId, cwd });
    } else if (msg.type === 'saveLayout') {
      writeLayout(msg.layout);
    } else if (msg.type === 'saveAgentSeats') {
      // Store in a local file
      try {
        const seatsFile = path.join(LAYOUT_DIR, 'agent-seats.json');
        if (!fs.existsSync(LAYOUT_DIR)) fs.mkdirSync(LAYOUT_DIR, { recursive: true });
        fs.writeFileSync(seatsFile, JSON.stringify(msg.seats, null, 2), 'utf-8');
      } catch {
        /* ignore */
      }
    } else if (msg.type === 'setSoundEnabled') {
      // Could persist to settings file if desired
    } else if (msg.type === 'closeAgent') {
      const id = msg.id as number;
      const agent = agents.get(id);
      // Remember this session so it doesn't reappear on restart
      if (agent) {
        dismissedJsonlFiles.add(agent.jsonlFile);
        saveDismissedSessions();
      }
      // Kill associated PTY and close its terminal tab
      const ptyId = agentToPty.get(id);
      if (ptyId) {
        send({ type: 'pty-close-tab', ptyId });
        ptyProcesses.get(ptyId)?.kill();
        ptyProcesses.delete(ptyId);
        agentToPty.delete(id);
        ptyToAgent.delete(ptyId);
      }
      removeAgent(id);
      send({ type: 'agentClosed', id });
    } else if (msg.type === 'focusAgent') {
      const id = msg.id as number;
      let ptyId = agentToPty.get(id);

      if (!ptyId) {
        // Agent has no terminal yet — create one
        const agent = agents.get(id);
        if (agent) {
          ptyId = crypto.randomUUID();
          const sessionId = path.basename(agent.jsonlFile, '.jsonl');
          const cwd = agent.cwd || os.homedir();

          agent.ptyId = ptyId;
          agent.sessionId = sessionId;
          agentToPty.set(id, ptyId);
          ptyToAgent.set(ptyId, id);
          ptySessionIds.set(sessionId, ptyId);

          send({ type: 'pty-created', ptyId, sessionId, cwd, shellOnly: true });
          return;
        }
      }

      if (ptyId) {
        send({ type: 'pty-focus', ptyId, agentId: id });
      }
    } else if (msg.type === 'openSessionsFolder') {
      if (fs.existsSync(CLAUDE_PROJECTS_DIR)) {
        shell.openPath(CLAUDE_PROJECTS_DIR);
      }
    } else if (msg.type === 'exportLayout') {
      const layout = readLayout();
      if (!layout) return;
      dialog
        .showSaveDialog(mainWindow!, {
          filters: [{ name: 'JSON Files', extensions: ['json'] }],
          defaultPath: path.join(os.homedir(), 'pixel-agents-layout.json'),
        })
        .then((result) => {
          if (result.filePath) {
            fs.writeFileSync(result.filePath, JSON.stringify(layout, null, 2), 'utf-8');
          }
        });
    } else if (msg.type === 'importLayout') {
      dialog
        .showOpenDialog(mainWindow!, {
          filters: [{ name: 'JSON Files', extensions: ['json'] }],
          properties: ['openFile'],
        })
        .then((result) => {
          if (result.filePaths.length > 0) {
            try {
              const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
              const imported = JSON.parse(raw);
              if (imported.version !== 1 || !Array.isArray(imported.tiles)) return;
              writeLayout(imported);
              send({ type: 'layoutLoaded', layout: imported });
            } catch {
              /* ignore */
            }
          }
        });
    }
  });
}

// ── Window Creation ──────────────────────────────────────────
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    title: 'Pixel Agents',
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In development, load from Vite dev server; in production, load built files
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'webview', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── App Lifecycle ────────────────────────────────────────────
function cleanupAndQuit(): void {
  if (scanTimer) clearInterval(scanTimer);
  scanTimer = null;
  for (const id of [...agents.keys()]) removeAgent(id);
  for (const [, proc] of ptyProcesses) {
    try { proc.kill(); } catch { /* ignore */ }
  }
  ptyProcesses.clear();
}

app.whenReady().then(() => {
  setupIpcHandlers();

  // Clean up stale dismissed sessions on startup
  cleanupDismissedSessions();

  // Initial scan for active sessions
  scanForSessions();

  // Periodic scan for new sessions
  scanTimer = setInterval(scanForSessions, SCAN_INTERVAL_MS);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  cleanupAndQuit();
  if (process.platform !== 'darwin') app.quit();
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
