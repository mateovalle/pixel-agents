import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  AchievementInfo,
  AgentTodo,
  HostToWebviewMessage,
  TodoItem,
  UsageSummary,
  WorkspaceInfo,
} from '../../../shared/protocol.js';
import { playDoneSound, setSoundEnabled } from '../notificationSound.js';
import type { CampusState } from '../office/engine/campusState.js';
import { setFloorSprites } from '../office/floorTiles.js';
import { buildDynamicCatalog } from '../office/layout/furnitureCatalog.js';
import { migrateLayoutColors } from '../office/layout/layoutSerializer.js';
import { setCharacterTemplates } from '../office/sprites/spriteData.js';
import { extractToolName } from '../office/toolUtils.js';
import type { OfficeLayout, ToolActivity } from '../office/types.js';
import { setWallSprites } from '../office/wallTiles.js';
import { vscode } from '../vscodeApi.js';

export interface SubagentCharacter {
  id: number;
  parentAgentId: number;
  parentToolId: string;
  label: string;
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
}

export interface WorkspaceFolder {
  name: string;
  path: string;
}

export interface ExtensionMessageState {
  agents: number[];
  selectedAgent: number | null;
  agentTools: Record<number, ToolActivity[]>;
  agentStatuses: Record<number, string>;
  subagentTools: Record<number, Record<string, ToolActivity[]>>;
  subagentCharacters: SubagentCharacter[];
  layoutReady: boolean;
  loadedAssets?: { catalog: FurnitureAsset[]; sprites: Record<string, string[][]> };
  workspaceFolders: WorkspaceFolder[];
  workspaces: WorkspaceInfo[];
  /** Human todos per workspace path (replaced wholesale on each message). */
  workspaceTodos: Record<string, TodoItem[]>;
  /** Agent plan items (TodoWrite) per agent id (replaced wholesale on each message). */
  agentTodos: Record<number, AgentTodo[]>;
  /** Latest usage summary pushed by the host (webviewReady + after each chat turn). */
  usageSummary: UsageSummary | null;
  /** Full achievements list from the host ('achievementsLoaded' on ready). */
  achievements: AchievementInfo[];
  /** Transient queue of freshly unlocked achievements awaiting toast display. */
  unlockQueue: AchievementInfo[];
  /** Dismiss the currently displayed unlock toast (drops unlockQueue[0]). */
  dismissUnlock: () => void;
}

/** Aggregate seat assignments across every office on the campus and persist. */
export function saveAgentSeats(campus: CampusState): void {
  const seats: Record<number, { palette: number; hueShift: number; seatId: string | null }> = {};
  for (const office of campus.getAllOffices()) {
    for (const ch of office.characters.values()) {
      if (ch.isSubagent) continue;
      seats[ch.id] = { palette: ch.palette, hueShift: ch.hueShift, seatId: ch.seatId };
    }
  }
  vscode.postMessage({ type: 'saveAgentSeats', seats });
}

export function useExtensionMessages(
  campus: CampusState,
  onLayoutLoaded?: (layout: OfficeLayout) => void,
  isEditDirty?: () => boolean,
): ExtensionMessageState {
  const [agents, setAgents] = useState<number[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null);
  const [agentTools, setAgentTools] = useState<Record<number, ToolActivity[]>>({});
  const [agentStatuses, setAgentStatuses] = useState<Record<number, string>>({});
  const [subagentTools, setSubagentTools] = useState<
    Record<number, Record<string, ToolActivity[]>>
  >({});
  const [subagentCharacters, setSubagentCharacters] = useState<SubagentCharacter[]>([]);
  const [layoutReady, setLayoutReady] = useState(false);
  const [loadedAssets, setLoadedAssets] = useState<
    { catalog: FurnitureAsset[]; sprites: Record<string, string[][]> } | undefined
  >();
  const [workspaceFolders, setWorkspaceFolders] = useState<WorkspaceFolder[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [workspaceTodos, setWorkspaceTodos] = useState<Record<string, TodoItem[]>>({});
  const [agentTodos, setAgentTodos] = useState<Record<number, AgentTodo[]>>({});
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);
  const [achievements, setAchievements] = useState<AchievementInfo[]>([]);
  const [unlockQueue, setUnlockQueue] = useState<AchievementInfo[]>([]);

  const dismissUnlock = useCallback(() => {
    setUnlockQueue((prev) => prev.slice(1));
  }, []);

  // Track whether initial layout has been loaded (ref to avoid re-render)
  const layoutReadyRef = useRef(false);

  // Keep latest callbacks in refs so the message handler (subscribed once)
  // never closes over stale values (e.g., isEditDirty from the first render)
  const onLayoutLoadedRef = useRef(onLayoutLoaded);
  const isEditDirtyRef = useRef(isEditDirty);
  useEffect(() => {
    onLayoutLoadedRef.current = onLayoutLoaded;
    isEditDirtyRef.current = isEditDirty;
  });

  useEffect(() => {
    // Buffer agents until both the layout and the workspace list have loaded,
    // so each agent lands in its workspace's office with correct seats.
    let pendingAgents: Array<{
      id: number;
      palette?: number;
      hueShift?: number;
      seatId?: string;
      folderName?: string;
      workspacePath?: string;
    }> = [];
    let workspacesLoaded = false;

    const flushPendingAgents = () => {
      if (!layoutReadyRef.current || !workspacesLoaded || pendingAgents.length === 0) return;
      for (const p of pendingAgents) {
        const office = campus.routeOffice(p.workspacePath, p.folderName);
        office.addAgent(p.id, p.palette, p.hueShift, p.seatId, true, p.folderName);
      }
      pendingAgents = [];
      saveAgentSeats(campus);
    };

    const handler = (e: MessageEvent) => {
      const msg = e.data as HostToWebviewMessage;

      if (msg.type === 'layoutLoaded') {
        // Skip external layout updates while editor has unsaved changes
        if (layoutReadyRef.current && isEditDirtyRef.current?.()) {
          console.log('[Webview] Skipping external layout update — editor has unsaved changes');
          return;
        }
        const rawLayout = msg.layout as OfficeLayout | null;
        const layout = rawLayout && rawLayout.version === 1 ? migrateLayoutColors(rawLayout) : null;
        if (msg.workspacePath !== undefined) {
          // Per-workspace layout — override just that workspace's office
          if (layout) campus.setWorkspaceLayout(msg.workspacePath, layout);
          return;
        }
        if (layout) {
          campus.setDefaultLayout(layout);
          onLayoutLoadedRef.current?.(layout);
        } else {
          // No saved default — adopt whatever the active OfficeState built
          campus.setDefaultLayout(campus.getActiveOffice().getLayout());
          onLayoutLoadedRef.current?.(campus.getLayout());
        }
        layoutReadyRef.current = true;
        setLayoutReady(true);
        // Add buffered agents now that layout (and seats) are correct
        flushPendingAgents();
      } else if (msg.type === 'workspacesLoaded') {
        campus.syncWorkspaces(msg.workspaces);
        workspacesLoaded = true;
        setWorkspaces(msg.workspaces);
        flushPendingAgents();
      } else if (msg.type === 'agentCreated') {
        const id = msg.id;
        const folderName = msg.folderName;
        setAgents((prev) => (prev.includes(id) ? prev : [...prev, id]));
        setSelectedAgent(id);
        if (!layoutReadyRef.current || !workspacesLoaded) {
          pendingAgents.push({ id, folderName, workspacePath: msg.workspacePath });
        } else {
          const office = campus.routeOffice(msg.workspacePath, folderName);
          office.addAgent(id, undefined, undefined, undefined, undefined, folderName);
          saveAgentSeats(campus);
        }
      } else if (msg.type === 'agentClosed') {
        const id = msg.id;
        setAgents((prev) => prev.filter((a) => a !== id));
        setSelectedAgent((prev) => (prev === id ? null : prev));
        setAgentTools((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setAgentStatuses((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setSubagentTools((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setAgentTodos((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        pendingAgents = pendingAgents.filter((p) => p.id !== id);
        // Remove all sub-agent characters belonging to this agent
        const os = campus.getOfficeForAgent(id);
        os?.removeAllSubagents(id);
        setSubagentCharacters((prev) => prev.filter((s) => s.parentAgentId !== id));
        os?.removeAgent(id);
      } else if (msg.type === 'existingAgents') {
        const incoming = msg.agents;
        const meta = msg.agentMeta || {};
        const folderNames = msg.folderNames || {};
        // Buffer agents — they'll be routed once layout + workspaces are ready
        for (const id of incoming) {
          const m = meta[id];
          pendingAgents.push({
            id,
            palette: m?.palette,
            hueShift: m?.hueShift,
            seatId: m?.seatId ?? undefined,
            folderName: folderNames[id],
          });
        }
        setAgents((prev) => {
          const ids = new Set(prev);
          const merged = [...prev];
          for (const id of incoming) {
            if (!ids.has(id)) {
              merged.push(id);
            }
          }
          return merged.sort((a, b) => a - b);
        });
        flushPendingAgents();
      } else if (msg.type === 'agentToolStart') {
        const id = msg.id;
        const toolId = msg.toolId;
        const status = msg.status;
        setAgentTools((prev) => {
          const list = prev[id] || [];
          if (list.some((t) => t.toolId === toolId)) return prev;
          return { ...prev, [id]: [...list, { toolId, status, done: false }] };
        });
        const os = campus.getOfficeForAgent(id);
        if (os) {
          const toolName = extractToolName(status);
          os.setAgentTool(id, toolName);
          os.setAgentActive(id, true);
          os.clearPermissionBubble(id);
          // Create sub-agent character for Task tool subtasks
          if (status.startsWith('Subtask:')) {
            const label = status.slice('Subtask:'.length).trim();
            const subId = os.addSubagent(id, toolId);
            setSubagentCharacters((prev) => {
              if (prev.some((s) => s.id === subId)) return prev;
              return [...prev, { id: subId, parentAgentId: id, parentToolId: toolId, label }];
            });
          }
        }
      } else if (msg.type === 'agentToolDone') {
        const id = msg.id;
        const toolId = msg.toolId;
        setAgentTools((prev) => {
          const list = prev[id];
          if (!list) return prev;
          return {
            ...prev,
            [id]: list.map((t) => (t.toolId === toolId ? { ...t, done: true } : t)),
          };
        });
      } else if (msg.type === 'agentToolsClear') {
        const id = msg.id;
        setAgentTools((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setSubagentTools((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        // Remove all sub-agent characters belonging to this agent
        const os = campus.getOfficeForAgent(id);
        os?.removeAllSubagents(id);
        setSubagentCharacters((prev) => prev.filter((s) => s.parentAgentId !== id));
        os?.setAgentTool(id, null);
        os?.clearPermissionBubble(id);
      } else if (msg.type === 'agentSelected') {
        setSelectedAgent(msg.id);
      } else if (msg.type === 'agentStatus') {
        const id = msg.id;
        const status = msg.status;
        setAgentStatuses((prev) => {
          if (status === 'active') {
            if (!(id in prev)) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
          }
          return { ...prev, [id]: status };
        });
        const os = campus.getOfficeForAgent(id);
        os?.setAgentActive(id, status === 'active');
        if (status === 'waiting') {
          os?.showWaitingBubble(id);
          playDoneSound();
        }
      } else if (msg.type === 'agentToolPermission') {
        const id = msg.id;
        setAgentTools((prev) => {
          const list = prev[id];
          if (!list) return prev;
          return {
            ...prev,
            [id]: list.map((t) => (t.done ? t : { ...t, permissionWait: true })),
          };
        });
        campus.getOfficeForAgent(id)?.showPermissionBubble(id);
      } else if (msg.type === 'subagentToolPermission') {
        const id = msg.id;
        const parentToolId = msg.parentToolId;
        // Show permission bubble on the sub-agent character
        const os = campus.getOfficeForAgent(id);
        const subId = os?.getSubagentId(id, parentToolId) ?? null;
        if (os && subId !== null) {
          os.showPermissionBubble(subId);
        }
      } else if (msg.type === 'agentToolPermissionClear') {
        const id = msg.id;
        setAgentTools((prev) => {
          const list = prev[id];
          if (!list) return prev;
          const hasPermission = list.some((t) => t.permissionWait);
          if (!hasPermission) return prev;
          return {
            ...prev,
            [id]: list.map((t) => (t.permissionWait ? { ...t, permissionWait: false } : t)),
          };
        });
        const os = campus.getOfficeForAgent(id);
        if (os) {
          os.clearPermissionBubble(id);
          // Also clear permission bubbles on all sub-agent characters of this parent
          for (const [subId, meta] of os.subagentMeta) {
            if (meta.parentAgentId === id) {
              os.clearPermissionBubble(subId);
            }
          }
        }
      } else if (msg.type === 'subagentToolStart') {
        const id = msg.id;
        const parentToolId = msg.parentToolId;
        const toolId = msg.toolId;
        const status = msg.status;
        setSubagentTools((prev) => {
          const agentSubs = prev[id] || {};
          const list = agentSubs[parentToolId] || [];
          if (list.some((t) => t.toolId === toolId)) return prev;
          return {
            ...prev,
            [id]: { ...agentSubs, [parentToolId]: [...list, { toolId, status, done: false }] },
          };
        });
        // Update sub-agent character's tool and active state
        const os = campus.getOfficeForAgent(id);
        const subId = os?.getSubagentId(id, parentToolId) ?? null;
        if (os && subId !== null) {
          const subToolName = extractToolName(status);
          os.setAgentTool(subId, subToolName);
          os.setAgentActive(subId, true);
        }
      } else if (msg.type === 'subagentToolDone') {
        const id = msg.id;
        const parentToolId = msg.parentToolId;
        const toolId = msg.toolId;
        setSubagentTools((prev) => {
          const agentSubs = prev[id];
          if (!agentSubs) return prev;
          const list = agentSubs[parentToolId];
          if (!list) return prev;
          return {
            ...prev,
            [id]: {
              ...agentSubs,
              [parentToolId]: list.map((t) => (t.toolId === toolId ? { ...t, done: true } : t)),
            },
          };
        });
      } else if (msg.type === 'subagentClear') {
        const id = msg.id;
        const parentToolId = msg.parentToolId;
        setSubagentTools((prev) => {
          const agentSubs = prev[id];
          if (!agentSubs || !(parentToolId in agentSubs)) return prev;
          const next = { ...agentSubs };
          delete next[parentToolId];
          if (Object.keys(next).length === 0) {
            const outer = { ...prev };
            delete outer[id];
            return outer;
          }
          return { ...prev, [id]: next };
        });
        // Remove sub-agent character
        campus.getOfficeForAgent(id)?.removeSubagent(id, parentToolId);
        setSubagentCharacters((prev) =>
          prev.filter((s) => !(s.parentAgentId === id && s.parentToolId === parentToolId)),
        );
      } else if (msg.type === 'characterSpritesLoaded') {
        const characters = msg.characters as Array<{
          down: string[][][];
          up: string[][][];
          right: string[][][];
        }>;
        console.log(`[Webview] Received ${characters.length} pre-colored character sprites`);
        setCharacterTemplates(characters);
      } else if (msg.type === 'floorTilesLoaded') {
        const sprites = msg.sprites as string[][][];
        console.log(`[Webview] Received ${sprites.length} floor tile patterns`);
        setFloorSprites(sprites);
      } else if (msg.type === 'wallTilesLoaded') {
        const sprites = msg.sprites as string[][][];
        console.log(`[Webview] Received ${sprites.length} wall tile sprites`);
        setWallSprites(sprites);
      } else if (msg.type === 'workspaceFolders') {
        setWorkspaceFolders(msg.folders);
      } else if (msg.type === 'workspaceTodos') {
        const path = msg.path;
        const todos = msg.todos;
        setWorkspaceTodos((prev) => ({ ...prev, [path]: todos }));
      } else if (msg.type === 'agent-todos') {
        const agentId = msg.agentId;
        const todos = msg.todos;
        setAgentTodos((prev) => ({ ...prev, [agentId]: todos }));
      } else if (msg.type === 'settingsLoaded') {
        setSoundEnabled(msg.soundEnabled);
      } else if (msg.type === 'usageSummary') {
        setUsageSummary(msg.summary);
        campus.setTodayUsage(msg.summary.todayByWorkspace ?? {});
      } else if (msg.type === 'achievementsLoaded') {
        setAchievements(msg.achievements);
      } else if (msg.type === 'achievementUnlocked') {
        const unlocked = msg.achievement;
        setAchievements((prev) => {
          const idx = prev.findIndex((a) => a.id === unlocked.id);
          if (idx === -1) return [...prev, unlocked];
          const next = [...prev];
          next[idx] = unlocked;
          return next;
        });
        setUnlockQueue((prev) => [...prev, unlocked]);
      } else if (msg.type === 'furnitureAssetsLoaded') {
        try {
          const catalog = msg.catalog as FurnitureAsset[];
          const sprites = msg.sprites as Record<string, string[][]>;
          console.log(`📦 Webview: Loaded ${catalog.length} furniture assets`);
          // Build dynamic catalog immediately so getCatalogEntry() works when layoutLoaded arrives next
          buildDynamicCatalog({ catalog, sprites });
          setLoadedAssets({ catalog, sprites });
        } catch (err) {
          console.error(`❌ Webview: Error processing furnitureAssetsLoaded:`, err);
        }
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'webviewReady' });
    return () => window.removeEventListener('message', handler);
  }, [campus]);

  return {
    agents,
    selectedAgent,
    agentTools,
    agentStatuses,
    subagentTools,
    subagentCharacters,
    layoutReady,
    loadedAssets,
    workspaceFolders,
    workspaces,
    workspaceTodos,
    agentTodos,
    usageSummary,
    achievements,
    unlockQueue,
    dismissUnlock,
  };
}
