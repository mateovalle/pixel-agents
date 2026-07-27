/**
 * The message protocol between the backend host (VS Code extension or
 * Electron main process) and the webview UI, as discriminated unions.
 *
 * This file is the single source of truth, imported by all three targets:
 *   - src/       (VS Code extension host)
 *   - electron/  (Electron main process)
 *   - webview-ui (React UI)
 *
 * It must stay dependency-free and types-only (no runtime exports).
 */

/** 2D pixel grid: '' = transparent, '#RRGGBB' = opaque color. */
export type SpriteData = string[][];

export interface CharacterDirectionSprites {
  down: SpriteData[];
  up: SpriteData[];
  right: SpriteData[];
}

export interface FurnitureAsset {
  id: string;
  name: string;
  label: string;
  category: string;
  file: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  isDesk: boolean;
  canPlaceOnWalls: boolean;
  partOfGroup?: boolean;
  groupId?: string;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
  orientation?: string;
  state?: string;
}

/** Per-agent presentation metadata persisted by the host. */
export interface AgentSeatMeta {
  palette?: number;
  seatId?: string | null;
  hueShift?: number;
}

export type AgentStatus = 'active' | 'waiting';

/** Serialized office layout (validated structurally, not deeply typed). */
export type LayoutData = Record<string, unknown>;

// ── Chat sessions (Electron only) ────────────────────────────

/**
 * Simplified rendering stream for SDK-driven chat sessions. The main
 * process reduces Agent SDK messages to these events; the webview renders
 * them without knowing SDK internals.
 */
export type ChatEvent =
  /** Echo of a prompt the user sent (also used for replay after reload). */
  | { kind: 'user-text'; text: string; imageCount?: number }
  /** Streaming assistant text (append to the in-progress text block). */
  | { kind: 'text-delta'; text: string }
  /** A completed content block — replaces accumulated deltas for 'text'. */
  | { kind: 'block-final'; block: 'text' | 'thinking'; text: string }
  | { kind: 'tool-start'; toolId: string; name: string; input: Record<string, unknown> }
  | { kind: 'tool-result'; toolId: string; isError: boolean; summary: string }
  | { kind: 'turn-complete'; costUsd: number; durationMs: number; isError: boolean }
  /** Informational status line (compaction, retries, …). */
  | { kind: 'status'; text: string }
  | { kind: 'error'; message: string };

/** A registered workspace (project folder) — rendered as an office. */
export interface WorkspaceInfo {
  path: string;
  /** basename(path) unless renamed. */
  name: string;
  addedAt: number;
  lastUsedAt: number;
}

/** An image attached to a chat prompt (base64, no data: prefix). */
export interface ChatImageAttachment {
  /** 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' */
  mediaType: string;
  data: string;
}

/** Permission modes exposed in the chat UI (subset of Claude Code's modes). */
export type ChatPermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';

/** A past session that can be resumed as a chat agent. */
export interface ResumableSession {
  sessionId: string;
  /** Last-modified time of the transcript (epoch ms). */
  mtimeMs: number;
  /** First user prompt (truncated) for identification. */
  preview: string;
}

// ── Todos ────────────────────────────────────────────────────

/** A human todo item scoped to a workspace. */
export interface TodoItem {
  id: string;
  text: string;
  status: 'open' | 'done';
  createdAt: number;
}

/** An agent's own plan item (mirrored from Claude Code's TodoWrite). */
export interface AgentTodo {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

// ── Usage tracking (Electron only) ───────────────────────────

export interface ProjectUsage {
  /** Absolute project path. */
  path: string;
  /** basename(path) for display. */
  folder: string;
  monthUsd: number;
  allTimeUsd: number;
}

export interface UsageSummary {
  todayUsd: number;
  monthUsd: number;
  allTimeUsd: number;
  /** Sorted by monthUsd desc; capped by the host. */
  perProject: ProjectUsage[];
  turnCount: number;
}

// ── Host → Webview ───────────────────────────────────────────

export type HostToWebviewMessage =
  // Agent lifecycle
  | {
      type: 'agentCreated';
      id: number;
      folderName?: string;
      ptyId?: string;
      agentKind?: 'terminal' | 'chat';
      /** Absolute project folder this agent works in (its workspace/office). */
      workspacePath?: string;
    }
  | { type: 'agentClosed'; id: number }
  | { type: 'agentSelected'; id: number }
  | {
      type: 'existingAgents';
      agents: number[];
      agentMeta: Record<number, AgentSeatMeta>;
      folderNames: Record<number, string>;
    }
  // Tool activity
  | { type: 'agentToolStart'; id: number; toolId: string; status: string }
  | { type: 'agentToolDone'; id: number; toolId: string }
  | { type: 'agentToolsClear'; id: number }
  | { type: 'agentToolPermission'; id: number }
  | { type: 'agentToolPermissionClear'; id: number }
  | { type: 'agentStatus'; id: number; status: AgentStatus }
  // Sub-agent activity
  | { type: 'subagentToolStart'; id: number; parentToolId: string; toolId: string; status: string }
  | { type: 'subagentToolDone'; id: number; parentToolId: string; toolId: string }
  | { type: 'subagentToolPermission'; id: number; parentToolId: string }
  | { type: 'subagentClear'; id: number; parentToolId: string }
  // Assets & layout
  // workspacePath absent = the global default layout; present = that office's own layout
  | { type: 'layoutLoaded'; layout: LayoutData | null; workspacePath?: string }
  | { type: 'characterSpritesLoaded'; characters: CharacterDirectionSprites[] }
  | { type: 'floorTilesLoaded'; sprites: SpriteData[] }
  | { type: 'wallTilesLoaded'; sprites: SpriteData[] }
  | {
      type: 'furnitureAssetsLoaded';
      catalog: FurnitureAsset[];
      sprites: Record<string, SpriteData>;
    }
  // Settings & workspace
  | { type: 'settingsLoaded'; soundEnabled: boolean }
  | { type: 'workspaceFolders'; folders: Array<{ name: string; path: string }> }
  // Terminal tabs (Electron only)
  | { type: 'pty-created'; ptyId: string; label: string }
  | { type: 'pty-focus'; ptyId: string; agentId: number }
  | { type: 'pty-close-tab'; ptyId: string }
  | { type: 'pty-output'; ptyId: string; data: string }
  | { type: 'pty-replay'; ptyId: string; data: string }
  | { type: 'pty-exit'; ptyId: string; exitCode: number }
  // Chat tabs (Electron only, SDK-driven sessions)
  | { type: 'chat-created'; agentId: number; label: string }
  | { type: 'chat-focus'; agentId: number }
  | { type: 'chat-close-tab'; agentId: number }
  | { type: 'chat-event'; agentId: number; event: ChatEvent }
  | { type: 'chat-replay'; agentId: number; events: ChatEvent[] }
  /** The agent is mid-turn (composer should show Stop instead of Send). */
  | { type: 'chat-busy'; agentId: number; busy: boolean }
  | {
      type: 'chat-permission-request';
      agentId: number;
      requestId: string;
      toolName: string;
      /** Full prompt sentence, e.g. "Claude wants to read foo.txt". */
      title?: string;
      /** Human-readable subtitle with extra context. */
      description?: string;
      input: Record<string, unknown>;
    }
  /** The request was resolved elsewhere (abort/turn end) — remove the card. */
  | { type: 'chat-permission-resolved'; agentId: number; requestId: string }
  /** An agent updated its internal plan (TodoWrite) — live activity feed. */
  | { type: 'agent-todos'; agentId: number; todos: AgentTodo[] }
  /** Human todos for a workspace (sent on ready and after any change). */
  | { type: 'workspaceTodos'; path: string; todos: TodoItem[] }
  /** Registered workspaces (sent on ready and after add/remove/use). */
  | { type: 'workspacesLoaded'; workspaces: WorkspaceInfo[] }
  /** Current permission mode of a chat session (sent on init and change). */
  | { type: 'chat-mode'; agentId: number; mode: ChatPermissionMode }
  /** Resumable sessions for a folder the user picked (reply to listResumableSessions). */
  | { type: 'sessionList'; folderPath: string; sessions: ResumableSession[] }
  // Usage
  | { type: 'usageSummary'; summary: UsageSummary };

// ── Webview → Host ───────────────────────────────────────────

export type WebviewToHostMessage =
  | { type: 'webviewReady' }
  /** Opens a TERMINAL agent (PTY). No folderPath → host shows a folder picker. */
  | { type: 'openClaude'; folderPath?: string }
  /** Opens a CHAT agent (Agent SDK). No folderPath → host shows a folder picker. */
  | { type: 'openChatAgent'; folderPath?: string }
  | { type: 'chatSend'; id: number; text: string; images?: ChatImageAttachment[] }
  | { type: 'chatInterrupt'; id: number }
  /** ChatView for this agent mounted — host replays its event history. */
  | { type: 'chatReady'; id: number }
  | {
      type: 'chatPermissionResponse';
      id: number;
      requestId: string;
      allow: boolean;
      /** Optional feedback delivered to Claude on deny. */
      message?: string;
    }
  | { type: 'focusAgent'; id: number }
  | { type: 'closeAgent'; id: number }
  | { type: 'saveAgentSeats'; seats: Record<number, AgentSeatMeta> }
  // Sent as the webview's own OfficeLayout shape; hosts validate structurally
  // with isValidLayout() before persisting.
  // workspacePath present = save as that office's own layout (Electron campus)
  | { type: 'saveLayout'; layout: unknown; workspacePath?: string }
  | { type: 'setSoundEnabled'; enabled: boolean }
  | { type: 'openSessionsFolder' }
  | { type: 'exportLayout' }
  | { type: 'importLayout' }
  /** Request an up-to-date UsageSummary (host replies with 'usageSummary'). */
  | { type: 'getUsageSummary' }
  /** Switch a chat session's permission mode (host echoes 'chat-mode'). */
  | { type: 'chatSetPermissionMode'; id: number; mode: ChatPermissionMode }
  /** List resumable sessions (host replies 'sessionList'); shows a folder picker when folderPath is omitted. */
  | { type: 'listResumableSessions'; folderPath?: string }
  /** Register a new workspace via folder picker (host replies 'workspacesLoaded'). */
  | { type: 'addWorkspace' }
  | { type: 'removeWorkspace'; path: string }
  | { type: 'addTodo'; path: string; text: string }
  | { type: 'toggleTodo'; path: string; id: string }
  | { type: 'deleteTodo'; path: string; id: string }
  /** Open (or focus) the global Assistant chat session. */
  | { type: 'openAssistant' }
  /** Spawn a chat agent in the workspace with the todo's text as first prompt. */
  | { type: 'assignTodo'; path: string; id: string }
  /** Resume a past session as a new chat agent. */
  | { type: 'resumeChatAgent'; folderPath: string; sessionId: string };
