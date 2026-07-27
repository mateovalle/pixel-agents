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
 * fixed-column grid. Each office is built from its workspace's own layout
 * override when one exists, else from the shared default layout. Origins are
 * recomputed (with per-row/per-column cell sizes, since offices may differ in
 * dimensions) whenever the workspace list or any layout changes.
 *
 * Imperative (not React state) — same conventions as OfficeState.
 */
export class CampusState {
  entries: CampusEntry[] = [];
  /** The global default layout applied to offices without an override (null until layoutLoaded). */
  private defaultLayout: OfficeLayout | null = null;
  /** Per-workspace layout overrides, keyed by workspace path. */
  private overrides = new Map<string, OfficeLayout>();
  /** Last-clicked workspace path — its office is the edit-mode target. */
  activeWorkspacePath: string | null = null;
  /** Detached office used when no workspaces are registered (never rendered in campus view). */
  private fallbackOffice: OfficeState | null = null;
  /** Today's chat spend (USD) per workspace path — shown on office label plates. */
  private todayUsage: Record<string, number> = {};

  /** Replace today's per-workspace spend map (from the host's usageSummary). */
  setTodayUsage(map: Record<string, number>): void {
    this.todayUsage = map;
  }

  /** Today's spend for a workspace path (0 when unknown). */
  getTodayUsd(path: string): number {
    return this.todayUsage[path] ?? 0;
  }

  /** The layout a given workspace's office should use: override, else default. */
  private layoutFor(path: string): OfficeLayout | null {
    return this.overrides.get(path) ?? this.defaultLayout;
  }

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
        office: new OfficeState(this.layoutFor(ws.path) ?? undefined),
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

  /** Apply a new default layout: rebuild offices without overrides, recompute origins. */
  setDefaultLayout(layout: OfficeLayout): void {
    this.defaultLayout = layout;
    for (const e of this.entries) {
      if (!this.overrides.has(e.workspace.path)) e.office.rebuildFromLayout(layout);
    }
    this.fallbackOffice?.rebuildFromLayout(layout);
    this.recomputeOrigins();
  }

  /** Store a workspace's own layout and rebuild just that office. */
  setWorkspaceLayout(path: string, layout: OfficeLayout): void {
    this.overrides.set(path, layout);
    this.getEntry(path)?.office.rebuildFromLayout(layout);
    this.recomputeOrigins();
  }

  /** Current default layout, or the active office's layout when none loaded yet. */
  getLayout(): OfficeLayout {
    return this.defaultLayout ?? this.getActiveOffice().getLayout();
  }

  /**
   * Adopt the active office's (possibly edited) layout on editor exit: it
   * becomes that workspace's own override, or the default layout when the
   * active office is the detached fallback (no workspace).
   */
  adoptLayoutFromActive(): void {
    const active = this.getActiveOffice();
    const layout = active.getLayout();
    const entry = this.entries.find((e) => e.office === active);
    if (entry) {
      this.overrides.set(entry.workspace.path, layout);
    } else {
      this.defaultLayout = layout;
    }
    this.recomputeOrigins();
  }

  /** Workspace path of the active office, or null when it's the detached fallback. */
  getActiveOfficePath(): string | null {
    const active = this.getActiveOffice();
    const entry = this.entries.find((e) => e.office === active);
    return entry ? entry.workspace.path : null;
  }

  /**
   * Arrange offices in a fixed-column grid. Offices may differ in size, so
   * each grid column is as wide as its widest office and each grid row as
   * tall as its tallest office (plus the campus gap).
   */
  private recomputeOrigins(): void {
    const colWidths: number[] = [];
    const rowHeights: number[] = [];
    for (let i = 0; i < this.entries.length; i++) {
      const layout = this.entries[i].office.getLayout();
      const gc = i % CAMPUS_GRID_COLS;
      const gr = Math.floor(i / CAMPUS_GRID_COLS);
      colWidths[gc] = Math.max(colWidths[gc] ?? 0, layout.cols);
      rowHeights[gr] = Math.max(rowHeights[gr] ?? 0, layout.rows);
    }
    const colOrigins: number[] = [];
    let acc = 0;
    for (let c = 0; c < colWidths.length; c++) {
      colOrigins[c] = acc;
      acc += colWidths[c] + CAMPUS_GAP_TILES;
    }
    const rowOrigins: number[] = [];
    acc = 0;
    for (let r = 0; r < rowHeights.length; r++) {
      rowOrigins[r] = acc;
      acc += rowHeights[r] + CAMPUS_GAP_TILES;
    }
    for (let i = 0; i < this.entries.length; i++) {
      this.entries[i].originCol = colOrigins[i % CAMPUS_GRID_COLS];
      this.entries[i].originRow = rowOrigins[Math.floor(i / CAMPUS_GRID_COLS)];
    }
  }

  /** Total campus size in sprite px (bounding box of all offices, no trailing gap). */
  getPixelSize(): { w: number; h: number } {
    let maxX = 0;
    let maxY = 0;
    for (const e of this.entries) {
      const layout = e.office.getLayout();
      maxX = Math.max(maxX, (e.originCol + layout.cols) * TILE_SIZE);
      maxY = Math.max(maxY, (e.originRow + layout.rows) * TILE_SIZE);
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
      this.fallbackOffice = new OfficeState(this.defaultLayout ?? undefined);
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
    for (const e of this.entries) {
      const layout = e.office.getLayout();
      const w = layout.cols * TILE_SIZE;
      const h = layout.rows * TILE_SIZE;
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
