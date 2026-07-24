import type { WorkspaceInfo } from '../../../../shared/protocol.js';
import { CAMPUS_GAP_TILES, CAMPUS_GRID_COLS } from '../../constants.js';
import type { Character, OfficeLayout } from '../types.js';
import { TILE_SIZE } from '../types.js';
import { OfficeState } from './officeState.js';

export interface CampusEntry {
  workspace: WorkspaceInfo;
  office: OfficeState;
  /** Grid origin of this office in tiles (campus world space) */
  originCol: number;
  originRow: number;
}

/**
 * Owns one OfficeState instance per registered workspace, arranged in a
 * fixed-column grid. All offices share the single global layout; origins are
 * recomputed whenever the workspace list or layout dimensions change.
 *
 * Imperative (not React state) — same conventions as OfficeState.
 */
export class CampusState {
  entries: CampusEntry[] = [];
  /** The single global layout shared by every office (null until layoutLoaded). */
  private layout: OfficeLayout | null = null;
  /** Last-clicked workspace path — its office is the edit-mode target. */
  activeWorkspacePath: string | null = null;
  /** Detached office used when no workspaces are registered (never rendered in campus view). */
  private fallbackOffice: OfficeState | null = null;

  /** Sync entries with the host's workspace list, preserving existing offices. */
  syncWorkspaces(workspaces: WorkspaceInfo[]): void {
    const byPath = new Map<string, CampusEntry>();
    for (const e of this.entries) byPath.set(e.workspace.path, e);

    this.entries = workspaces.map((ws) => {
      const existing = byPath.get(ws.path);
      if (existing) {
        existing.workspace = ws;
        return existing;
      }
      return {
        workspace: ws,
        office: new OfficeState(this.layout ?? undefined),
        originCol: 0,
        originRow: 0,
      };
    });

    if (
      this.activeWorkspacePath !== null &&
      !this.entries.some((e) => e.workspace.path === this.activeWorkspacePath)
    ) {
      this.activeWorkspacePath = null;
    }
    this.recomputeOrigins();
  }

  /** Apply a new global layout: rebuild every office and recompute origins. */
  setLayout(layout: OfficeLayout): void {
    this.layout = layout;
    for (const e of this.entries) {
      e.office.rebuildFromLayout(layout);
    }
    this.fallbackOffice?.rebuildFromLayout(layout);
    this.recomputeOrigins();
  }

  /** Current global layout, or the active office's default when none loaded yet. */
  getLayout(): OfficeLayout {
    return this.layout ?? this.getActiveOffice().getLayout();
  }

  /** Adopt the active office's (possibly edited) layout as the global one. */
  adoptLayoutFromActive(): void {
    const active = this.getActiveOffice();
    const layout = active.getLayout();
    this.layout = layout;
    for (const e of this.entries) {
      if (e.office !== active) e.office.rebuildFromLayout(layout);
    }
    if (this.fallbackOffice && this.fallbackOffice !== active) {
      this.fallbackOffice.rebuildFromLayout(layout);
    }
    this.recomputeOrigins();
  }

  /** Arrange offices in a fixed-column grid spaced by layout size + gap. */
  private recomputeOrigins(): void {
    const { cols, rows } = this.cellSize();
    for (let i = 0; i < this.entries.length; i++) {
      this.entries[i].originCol = (i % CAMPUS_GRID_COLS) * cols;
      this.entries[i].originRow = Math.floor(i / CAMPUS_GRID_COLS) * rows;
    }
  }

  /** Grid cell size in tiles (office + gap). */
  private cellSize(): { cols: number; rows: number } {
    const layout = this.layout ?? this.entries[0]?.office.getLayout();
    const cols = (layout?.cols ?? 0) + CAMPUS_GAP_TILES;
    const rows = (layout?.rows ?? 0) + CAMPUS_GAP_TILES;
    return { cols, rows };
  }

  /** Total campus size in sprite px (bounding box of all offices, no trailing gap). */
  getPixelSize(): { w: number; h: number } {
    if (this.entries.length === 0) return { w: 0, h: 0 };
    const layout = this.getLayout();
    const officeW = layout.cols * TILE_SIZE;
    const officeH = layout.rows * TILE_SIZE;
    let maxX = 0;
    let maxY = 0;
    for (const e of this.entries) {
      maxX = Math.max(maxX, e.originCol * TILE_SIZE + officeW);
      maxY = Math.max(maxY, e.originRow * TILE_SIZE + officeH);
    }
    return { w: maxX, h: maxY };
  }

  /** Pixel origin of an entry in campus world space. */
  originPx(entry: CampusEntry): { x: number; y: number } {
    return { x: entry.originCol * TILE_SIZE, y: entry.originRow * TILE_SIZE };
  }

  getEntry(path: string): CampusEntry | null {
    return this.entries.find((e) => e.workspace.path === path) ?? null;
  }

  /** The office edited/rendered in edit mode: last-clicked, else first, else fallback. */
  getActiveOffice(): OfficeState {
    if (this.activeWorkspacePath !== null) {
      const entry = this.getEntry(this.activeWorkspacePath);
      if (entry) return entry.office;
    }
    if (this.entries.length > 0) return this.entries[0].office;
    if (!this.fallbackOffice) {
      this.fallbackOffice = new OfficeState(this.layout ?? undefined);
    }
    return this.fallbackOffice;
  }

  /** Every live office (entries + fallback if created). */
  getAllOffices(): OfficeState[] {
    const offices = this.entries.map((e) => e.office);
    if (this.fallbackOffice) offices.push(this.fallbackOffice);
    return offices;
  }

  /** Find the office that contains a character (agent or sub-agent). */
  getOfficeForAgent(agentId: number): OfficeState | null {
    for (const office of this.getAllOffices()) {
      if (office.characters.has(agentId)) return office;
    }
    return null;
  }

  /** Find the character for an id across all offices. */
  getCharacter(agentId: number): Character | null {
    return this.getOfficeForAgent(agentId)?.characters.get(agentId) ?? null;
  }

  /** The entry containing a character, or null (fallback office has no entry). */
  getEntryForAgent(agentId: number): CampusEntry | null {
    return this.entries.find((e) => e.office.characters.has(agentId)) ?? null;
  }

  /** Route an agent to its workspace office by path, else by folder name, else MRU. */
  routeOffice(workspacePath?: string, folderName?: string): OfficeState {
    if (workspacePath) {
      const entry = this.getEntry(workspacePath);
      if (entry) return entry.office;
    }
    if (folderName) {
      const entry = this.entries.find((e) => e.workspace.name === folderName);
      if (entry) return entry.office;
    }
    const mru = this.mostRecentlyUsedEntry();
    if (mru) return mru.office;
    return this.getActiveOffice();
  }

  private mostRecentlyUsedEntry(): CampusEntry | null {
    let best: CampusEntry | null = null;
    for (const e of this.entries) {
      if (!best || e.workspace.lastUsedAt > best.workspace.lastUsedAt) best = e;
    }
    return best;
  }

  /** The entry whose office bounds contain a campus-world point, or null. */
  getEntryAt(worldX: number, worldY: number): CampusEntry | null {
    const layout = this.entries.length > 0 ? this.getLayout() : null;
    if (!layout) return null;
    const w = layout.cols * TILE_SIZE;
    const h = layout.rows * TILE_SIZE;
    for (const e of this.entries) {
      const ox = e.originCol * TILE_SIZE;
      const oy = e.originRow * TILE_SIZE;
      if (worldX >= ox && worldX < ox + w && worldY >= oy && worldY < oy + h) return e;
    }
    return null;
  }

  /** Selected agent id across all offices, or null. */
  getSelectedAgentId(): number | null {
    for (const office of this.getAllOffices()) {
      if (office.selectedAgentId !== null) return office.selectedAgentId;
    }
    return null;
  }

  /** Hovered agent id across all offices, or null. */
  getHoveredAgentId(): number | null {
    for (const office of this.getAllOffices()) {
      if (office.hoveredAgentId !== null) return office.hoveredAgentId;
    }
    return null;
  }

  /** Clear agent selection (and camera follow) in every office except one. */
  clearSelectionsExcept(except: OfficeState | null): void {
    for (const office of this.getAllOffices()) {
      if (office === except) continue;
      office.selectedAgentId = null;
      office.cameraFollowId = null;
    }
  }

  /** Clear hover state in every office except one. */
  clearHoverExcept(except: OfficeState | null): void {
    for (const office of this.getAllOffices()) {
      if (office === except) continue;
      office.hoveredAgentId = null;
      office.hoveredTile = null;
    }
  }

  /** Break camera follow in every office (manual pan). */
  clearCameraFollow(): void {
    for (const office of this.getAllOffices()) {
      office.cameraFollowId = null;
    }
  }

  /** The camera-followed character and its entry, or null. */
  getCameraFollow(): { entry: CampusEntry; ch: Character } | null {
    for (const entry of this.entries) {
      const id = entry.office.cameraFollowId;
      if (id === null) continue;
      const ch = entry.office.characters.get(id);
      if (ch) return { entry, ch };
    }
    return null;
  }

  /** Count non-sub-agent characters in an office. */
  agentCount(office: OfficeState): number {
    let n = 0;
    for (const ch of office.characters.values()) {
      if (!ch.isSubagent) n++;
    }
    return n;
  }

  update(dt: number): void {
    for (const office of this.getAllOffices()) {
      office.update(dt);
    }
  }
}
