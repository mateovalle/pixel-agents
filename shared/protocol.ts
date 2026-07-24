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

// ── Host → Webview ───────────────────────────────────────────

export type HostToWebviewMessage =
  // Agent lifecycle
  | { type: 'agentCreated'; id: number; folderName?: string; ptyId?: string }
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
  | { type: 'pty-exit'; ptyId: string; exitCode: number };

// ── Webview → Host ───────────────────────────────────────────

export type WebviewToHostMessage =
  | { type: 'webviewReady' }
  | { type: 'openClaude'; folderPath?: string }
  | { type: 'focusAgent'; id: number }
  | { type: 'closeAgent'; id: number }
  | { type: 'saveAgentSeats'; seats: Record<number, AgentSeatMeta> }
  // Sent as the webview's own OfficeLayout shape; hosts validate structurally
  // with isValidLayout() before persisting.
  | { type: 'saveLayout'; layout: unknown }
  | { type: 'setSoundEnabled'; enabled: boolean }
  | { type: 'openSessionsFolder' }
  | { type: 'exportLayout' }
  | { type: 'importLayout' };
