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
  | { kind: 'user-text'; text: string }
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
  | { type: 'layoutLoaded'; layout: LayoutData | null }
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
  // Usage
  | { type: 'usageSummary'; summary: UsageSummary };

// ── Webview → Host ───────────────────────────────────────────

export type WebviewToHostMessage =
  | { type: 'webviewReady' }
  /** Opens a TERMINAL agent (PTY). No folderPath → host shows a folder picker. */
  | { type: 'openClaude'; folderPath?: string }
  /** Opens a CHAT agent (Agent SDK). No folderPath → host shows a folder picker. */
  | { type: 'openChatAgent'; folderPath?: string }
  | { type: 'chatSend'; id: number; text: string }
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
  | { type: 'saveLayout'; layout: unknown }
  | { type: 'setSoundEnabled'; enabled: boolean }
  | { type: 'openSessionsFolder' }
  | { type: 'exportLayout' }
  | { type: 'importLayout' }
  /** Request an up-to-date UsageSummary (host replies with 'usageSummary'). */
  | { type: 'getUsageSummary' };
