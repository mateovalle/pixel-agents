import { useCallback, useEffect, useRef } from 'react';

import type { WorkspaceInfo } from '../../../../shared/protocol.js';
import {
  CAMERA_FOLLOW_LERP,
  CAMERA_FOLLOW_SNAP_THRESHOLD,
  CAMPUS_CULL_PAD_PX,
  CAMPUS_FIT_PAD_FRACTION,
  PAN_MARGIN_FRACTION,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_SCROLL_THRESHOLD,
} from '../../constants.js';
import { saveAgentSeats } from '../../hooks/useExtensionMessages.js';
import { unlockAudio } from '../../notificationSound.js';
import { canPlaceFurniture, getWallPlacementRow } from '../editor/editorActions.js';
import type { EditorState } from '../editor/editorState.js';
import type { CampusState } from '../engine/campusState.js';
import { startGameLoop } from '../engine/gameLoop.js';
import type { OfficeState } from '../engine/officeState.js';
import type {
  DeleteButtonBounds,
  EditorRenderState,
  RotateButtonBounds,
  SelectionRenderState,
} from '../engine/renderer.js';
import { renderFrame, renderOffice, renderOfficeLabel } from '../engine/renderer.js';
import { getCatalogEntry, isRotatable } from '../layout/furnitureCatalog.js';
import { formatUsd } from '../toolUtils.js';
import { EditTool, TILE_SIZE } from '../types.js';

interface OfficeCanvasProps {
  campus: CampusState;
  /** Active office — the edit-mode target (campus.getActiveOffice()). */
  officeState: OfficeState;
  onClick: (agentId: number, office: OfficeState) => void;
  /** Floor click on an office with nothing else hit — open the workspace popup. */
  onOfficeClick: (workspace: WorkspaceInfo, cssX: number, cssY: number) => void;
  /** Click on empty canvas / a character — close any open popup. */
  onEmptyClick: () => void;
  isEditMode: boolean;
  editorState: EditorState;
  onEditorTileAction: (col: number, row: number) => void;
  onEditorEraseAction: (col: number, row: number) => void;
  onEditorSelectionChange: () => void;
  onDeleteSelected: () => void;
  onRotateSelected: () => void;
  onDragMove: (uid: string, newCol: number, newRow: number) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  panRef: React.MutableRefObject<{ x: number; y: number }>;
}

interface CampusHit {
  office: OfficeState;
  workspace: WorkspaceInfo;
  originX: number;
  originY: number;
  localX: number;
  localY: number;
  col: number;
  row: number;
}

export function OfficeCanvas({
  campus,
  officeState,
  onClick,
  onOfficeClick,
  onEmptyClick,
  isEditMode,
  editorState,
  onEditorTileAction,
  onEditorEraseAction,
  onEditorSelectionChange,
  onDeleteSelected,
  onRotateSelected,
  onDragMove,
  zoom,
  onZoomChange,
  panRef,
}: OfficeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef({ x: 0, y: 0 });
  // Middle-mouse pan state (imperative, no re-renders)
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ mouseX: 0, mouseY: 0, panX: 0, panY: 0 });
  // Delete/rotate button bounds (updated each frame by renderer)
  const deleteButtonBoundsRef = useRef<DeleteButtonBounds | null>(null);
  const rotateButtonBoundsRef = useRef<RotateButtonBounds | null>(null);
  // Right-click erase dragging
  const isEraseDraggingRef = useRef(false);
  // Zoom scroll accumulator for trackpad pinch sensitivity
  const zoomAccumulatorRef = useRef(0);
  // Fit-the-campus zoom applied once on first load
  const didFitRef = useRef(false);

  // Clamp pan so the map edge can't go past a margin inside the viewport
  const clampPan = useCallback(
    (px: number, py: number): { x: number; y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: px, y: py };
      let mapW: number;
      let mapH: number;
      if (isEditMode) {
        const layout = officeState.getLayout();
        mapW = layout.cols * TILE_SIZE * zoom;
        mapH = layout.rows * TILE_SIZE * zoom;
      } else {
        const size = campus.getPixelSize();
        mapW = size.w * zoom;
        mapH = size.h * zoom;
      }
      const marginX = canvas.width * PAN_MARGIN_FRACTION;
      const marginY = canvas.height * PAN_MARGIN_FRACTION;
      const maxPanX = mapW / 2 + canvas.width / 2 - marginX;
      const maxPanY = mapH / 2 + canvas.height / 2 - marginY;
      return {
        x: Math.max(-maxPanX, Math.min(maxPanX, px)),
        y: Math.max(-maxPanY, Math.min(maxPanY, py)),
      };
    },
    [campus, officeState, zoom, isEditMode],
  );

  // Resize canvas backing store to device pixels (no DPR transform on ctx)
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    // No ctx.scale(dpr) — we render directly in device pixels
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    resizeCanvas();

    const observer = new ResizeObserver(() => resizeCanvas());
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    const stop = startGameLoop(canvas, {
      update: (dt) => {
        campus.update(dt);
      },
      render: (ctx) => {
        // Canvas dimensions are in device pixels
        const w = canvas.width;
        const h = canvas.height;

        if (!isEditMode) {
          // ── Campus view: render every office at its origin ──
          // One-time default camera: fit the whole campus (integer zoom)
          if (!didFitRef.current && campus.entries.length > 0 && w > 0 && h > 0) {
            didFitRef.current = true;
            const size = campus.getPixelSize();
            const padScale = 1 + CAMPUS_FIT_PAD_FRACTION * 2;
            const fit = Math.floor(Math.min(w / (size.w * padScale), h / (size.h * padScale)));
            const fitted = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fit));
            panRef.current = { x: 0, y: 0 };
            if (fitted !== zoom) {
              onZoomChange(fitted);
              return; // re-render next frame with the new zoom
            }
          }

          // Camera follow: smoothly center on followed agent (office-origin aware)
          const follow = campus.getCameraFollow();
          if (follow) {
            const size = campus.getPixelSize();
            const worldX = follow.entry.originCol * TILE_SIZE + follow.ch.x;
            const worldY = follow.entry.originRow * TILE_SIZE + follow.ch.y;
            const targetX = (size.w / 2 - worldX) * zoom;
            const targetY = (size.h / 2 - worldY) * zoom;
            const dx = targetX - panRef.current.x;
            const dy = targetY - panRef.current.y;
            if (
              Math.abs(dx) < CAMERA_FOLLOW_SNAP_THRESHOLD &&
              Math.abs(dy) < CAMERA_FOLLOW_SNAP_THRESHOLD
            ) {
              panRef.current = { x: targetX, y: targetY };
            } else {
              panRef.current = {
                x: panRef.current.x + dx * CAMERA_FOLLOW_LERP,
                y: panRef.current.y + dy * CAMERA_FOLLOW_LERP,
              };
            }
          }

          ctx.clearRect(0, 0, w, h);
          const size = campus.getPixelSize();
          const baseX = Math.floor((w - size.w * zoom) / 2) + Math.round(panRef.current.x);
          const baseY = Math.floor((h - size.h * zoom) / 2) + Math.round(panRef.current.y);
          offsetRef.current = { x: baseX, y: baseY };

          if (campus.entries.length > 0) {
            const pad = CAMPUS_CULL_PAD_PX * zoom;
            for (const entry of campus.entries) {
              // Offices may have per-workspace layouts with differing sizes
              const layout = entry.office.getLayout();
              const officeW = layout.cols * TILE_SIZE * zoom;
              const officeH = layout.rows * TILE_SIZE * zoom;
              const ox = baseX + entry.originCol * TILE_SIZE * zoom;
              const oy = baseY + entry.originRow * TILE_SIZE * zoom;
              // Cull offices fully outside the viewport
              if (
                ox + officeW + pad < 0 ||
                ox - pad > w ||
                oy + officeH + pad < 0 ||
                oy - pad > h
              ) {
                continue;
              }
              renderOffice(ctx, entry.office, ox, oy, zoom);
              const count = campus.agentCount(entry.office);
              const todayUsd = campus.getTodayUsd(entry.workspace.path);
              const costSegment = todayUsd > 0 ? ` · ${formatUsd(todayUsd)}` : '';
              renderOfficeLabel(
                ctx,
                `${entry.workspace.name} · ${count}${costSegment}`,
                count === 0,
                ox,
                oy,
                zoom,
                officeW,
              );
            }
          }

          deleteButtonBoundsRef.current = null;
          rotateButtonBoundsRef.current = null;
          return;
        }

        // ── Edit mode: render only the active office at origin 0 ──
        // Build editor render state
        const showGhostBorder =
          editorState.activeTool === EditTool.TILE_PAINT ||
          editorState.activeTool === EditTool.WALL_PAINT ||
          editorState.activeTool === EditTool.ERASE;
        const editorRender: EditorRenderState = {
          showGrid: true,
          ghostSprite: null,
          ghostCol: editorState.ghostCol,
          ghostRow: editorState.ghostRow,
          ghostValid: editorState.ghostValid,
          selectedCol: 0,
          selectedRow: 0,
          selectedW: 0,
          selectedH: 0,
          hasSelection: false,
          isRotatable: false,
          deleteButtonBounds: null,
          rotateButtonBounds: null,
          showGhostBorder,
          ghostBorderHoverCol: showGhostBorder ? editorState.ghostCol : -999,
          ghostBorderHoverRow: showGhostBorder ? editorState.ghostRow : -999,
        };

        // Ghost preview for furniture placement
        if (editorState.activeTool === EditTool.FURNITURE_PLACE && editorState.ghostCol >= 0) {
          const entry = getCatalogEntry(editorState.selectedFurnitureType);
          if (entry) {
            const placementRow = getWallPlacementRow(
              editorState.selectedFurnitureType,
              editorState.ghostRow,
            );
            editorRender.ghostSprite = entry.sprite;
            editorRender.ghostRow = placementRow;
            editorRender.ghostValid = canPlaceFurniture(
              officeState.getLayout(),
              editorState.selectedFurnitureType,
              editorState.ghostCol,
              placementRow,
            );
          }
        }

        // Ghost preview for drag-to-move
        if (editorState.isDragMoving && editorState.dragUid && editorState.ghostCol >= 0) {
          const draggedItem = officeState
            .getLayout()
            .furniture.find((f) => f.uid === editorState.dragUid);
          if (draggedItem) {
            const entry = getCatalogEntry(draggedItem.type);
            if (entry) {
              const ghostCol = editorState.ghostCol - editorState.dragOffsetCol;
              const ghostRow = editorState.ghostRow - editorState.dragOffsetRow;
              editorRender.ghostSprite = entry.sprite;
              editorRender.ghostCol = ghostCol;
              editorRender.ghostRow = ghostRow;
              editorRender.ghostValid = canPlaceFurniture(
                officeState.getLayout(),
                draggedItem.type,
                ghostCol,
                ghostRow,
                editorState.dragUid,
              );
            }
          }
        }

        // Selection highlight
        if (editorState.selectedFurnitureUid && !editorState.isDragMoving) {
          const item = officeState
            .getLayout()
            .furniture.find((f) => f.uid === editorState.selectedFurnitureUid);
          if (item) {
            const entry = getCatalogEntry(item.type);
            if (entry) {
              editorRender.hasSelection = true;
              editorRender.selectedCol = item.col;
              editorRender.selectedRow = item.row;
              editorRender.selectedW = entry.footprintW;
              editorRender.selectedH = entry.footprintH;
              editorRender.isRotatable = isRotatable(item.type);
            }
          }
        }

        // Build selection render state
        const selectionRender: SelectionRenderState = {
          selectedAgentId: officeState.selectedAgentId,
          hoveredAgentId: officeState.hoveredAgentId,
          hoveredTile: officeState.hoveredTile,
          seats: officeState.seats,
          characters: officeState.characters,
        };

        const { offsetX, offsetY } = renderFrame(
          ctx,
          w,
          h,
          officeState.tileMap,
          officeState.furniture,
          officeState.getCharacters(),
          zoom,
          panRef.current.x,
          panRef.current.y,
          selectionRender,
          editorRender,
          officeState.getLayout().tileColors,
          officeState.getLayout().cols,
          officeState.getLayout().rows,
        );
        offsetRef.current = { x: offsetX, y: offsetY };

        // Store delete/rotate button bounds for hit-testing
        deleteButtonBoundsRef.current = editorRender.deleteButtonBounds;
        rotateButtonBoundsRef.current = editorRender.rotateButtonBounds;
      },
    });

    return () => {
      stop();
      observer.disconnect();
    };
  }, [campus, officeState, resizeCanvas, isEditMode, editorState, zoom, panRef, onZoomChange]);

  // Convert CSS mouse coords to world (sprite pixel) coords
  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      // CSS coords relative to canvas
      const cssX = clientX - rect.left;
      const cssY = clientY - rect.top;
      // Convert to device pixels
      const deviceX = cssX * dpr;
      const deviceY = cssY * dpr;
      // Convert to world (sprite pixel) coords
      const worldX = (deviceX - offsetRef.current.x) / zoom;
      const worldY = (deviceY - offsetRef.current.y) / zoom;
      return { worldX, worldY, screenX: cssX, screenY: cssY, deviceX, deviceY };
    },
    [zoom],
  );

  /** Campus-mode: which office (if any) contains a world point, plus local coords. */
  const campusHitTest = useCallback(
    (worldX: number, worldY: number): CampusHit | null => {
      const entry = campus.getEntryAt(worldX, worldY);
      if (!entry) return null;
      const origin = campus.originPx(entry);
      const localX = worldX - origin.x;
      const localY = worldY - origin.y;
      return {
        office: entry.office,
        workspace: entry.workspace,
        originX: origin.x,
        originY: origin.y,
        localX,
        localY,
        col: Math.floor(localX / TILE_SIZE),
        row: Math.floor(localY / TILE_SIZE),
      };
    },
    [campus],
  );

  const screenToTile = useCallback(
    (clientX: number, clientY: number): { col: number; row: number } | null => {
      const pos = screenToWorld(clientX, clientY);
      if (!pos) return null;
      const col = Math.floor(pos.worldX / TILE_SIZE);
      const row = Math.floor(pos.worldY / TILE_SIZE);
      const layout = officeState.getLayout();
      // In edit mode with floor/wall/erase tool, extend valid range by 1 for ghost border
      if (
        isEditMode &&
        (editorState.activeTool === EditTool.TILE_PAINT ||
          editorState.activeTool === EditTool.WALL_PAINT ||
          editorState.activeTool === EditTool.ERASE)
      ) {
        if (col < -1 || col > layout.cols || row < -1 || row > layout.rows) return null;
        return { col, row };
      }
      if (col < 0 || col >= layout.cols || row < 0 || row >= layout.rows) return null;
      return { col, row };
    },
    [screenToWorld, officeState, isEditMode, editorState],
  );

  // Check if device-pixel coords hit the delete button
  const hitTestDeleteButton = useCallback((deviceX: number, deviceY: number): boolean => {
    const bounds = deleteButtonBoundsRef.current;
    if (!bounds) return false;
    const dx = deviceX - bounds.cx;
    const dy = deviceY - bounds.cy;
    return dx * dx + dy * dy <= (bounds.radius + 2) * (bounds.radius + 2); // small padding
  }, []);

  // Check if device-pixel coords hit the rotate button
  const hitTestRotateButton = useCallback((deviceX: number, deviceY: number): boolean => {
    const bounds = rotateButtonBoundsRef.current;
    if (!bounds) return false;
    const dx = deviceX - bounds.cx;
    const dy = deviceY - bounds.cy;
    return dx * dx + dy * dy <= (bounds.radius + 2) * (bounds.radius + 2);
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      // Handle middle-mouse panning
      if (isPanningRef.current) {
        const dpr = window.devicePixelRatio || 1;
        const dx = (e.clientX - panStartRef.current.mouseX) * dpr;
        const dy = (e.clientY - panStartRef.current.mouseY) * dpr;
        panRef.current = clampPan(panStartRef.current.panX + dx, panStartRef.current.panY + dy);
        return;
      }

      if (isEditMode) {
        const tile = screenToTile(e.clientX, e.clientY);
        if (tile) {
          editorState.ghostCol = tile.col;
          editorState.ghostRow = tile.row;

          // Drag-to-move: check if cursor moved to different tile
          if (editorState.dragUid && !editorState.isDragMoving) {
            if (tile.col !== editorState.dragStartCol || tile.row !== editorState.dragStartRow) {
              editorState.isDragMoving = true;
            }
          }

          // Paint on drag (tile/wall/erase paint tool only, not during furniture drag)
          if (
            editorState.isDragging &&
            (editorState.activeTool === EditTool.TILE_PAINT ||
              editorState.activeTool === EditTool.WALL_PAINT ||
              editorState.activeTool === EditTool.ERASE) &&
            !editorState.dragUid
          ) {
            onEditorTileAction(tile.col, tile.row);
          }
          // Right-click erase drag
          if (
            isEraseDraggingRef.current &&
            (editorState.activeTool === EditTool.TILE_PAINT ||
              editorState.activeTool === EditTool.WALL_PAINT ||
              editorState.activeTool === EditTool.ERASE)
          ) {
            const layout = officeState.getLayout();
            if (
              tile.col >= 0 &&
              tile.col < layout.cols &&
              tile.row >= 0 &&
              tile.row < layout.rows
            ) {
              onEditorEraseAction(tile.col, tile.row);
            }
          }
        } else {
          editorState.ghostCol = -1;
          editorState.ghostRow = -1;
        }

        // Cursor: show grab during drag, pointer over delete button, crosshair otherwise
        const canvas = canvasRef.current;
        if (canvas) {
          if (editorState.isDragMoving) {
            canvas.style.cursor = 'grabbing';
          } else {
            const pos = screenToWorld(e.clientX, e.clientY);
            if (
              pos &&
              (hitTestDeleteButton(pos.deviceX, pos.deviceY) ||
                hitTestRotateButton(pos.deviceX, pos.deviceY))
            ) {
              canvas.style.cursor = 'pointer';
            } else if (editorState.activeTool === EditTool.FURNITURE_PICK && tile) {
              // Pick mode: show pointer over furniture, crosshair elsewhere
              const layout = officeState.getLayout();
              const hitFurniture = layout.furniture.find((f) => {
                const entry = getCatalogEntry(f.type);
                if (!entry) return false;
                return (
                  tile.col >= f.col &&
                  tile.col < f.col + entry.footprintW &&
                  tile.row >= f.row &&
                  tile.row < f.row + entry.footprintH
                );
              });
              canvas.style.cursor = hitFurniture ? 'pointer' : 'crosshair';
            } else if (
              (editorState.activeTool === EditTool.SELECT ||
                (editorState.activeTool === EditTool.FURNITURE_PLACE &&
                  editorState.selectedFurnitureType === '')) &&
              tile
            ) {
              // Check if hovering over furniture
              const layout = officeState.getLayout();
              const hitFurniture = layout.furniture.find((f) => {
                const entry = getCatalogEntry(f.type);
                if (!entry) return false;
                return (
                  tile.col >= f.col &&
                  tile.col < f.col + entry.footprintW &&
                  tile.row >= f.row &&
                  tile.row < f.row + entry.footprintH
                );
              });
              canvas.style.cursor = hitFurniture ? 'grab' : 'crosshair';
            } else {
              canvas.style.cursor = 'crosshair';
            }
          }
        }
        return;
      }

      // ── Campus mode: hover within the office under the cursor ──
      const pos = screenToWorld(e.clientX, e.clientY);
      if (!pos) return;
      const hit = campusHitTest(pos.worldX, pos.worldY);
      campus.clearHoverExcept(hit?.office ?? null);
      let cursor = 'default';
      if (hit) {
        const office = hit.office;
        const hitId = office.getCharacterAt(hit.localX, hit.localY);
        office.hoveredAgentId = hitId;
        office.hoveredTile = { col: hit.col, row: hit.row };
        if (hitId !== null) {
          cursor = 'pointer';
        } else if (office.selectedAgentId !== null) {
          // Check if hovering over a clickable seat (available or own)
          const seatId = office.getSeatAtTile(hit.col, hit.row);
          if (seatId) {
            const seat = office.seats.get(seatId);
            if (seat) {
              const selectedCh = office.characters.get(office.selectedAgentId);
              if (!seat.assigned || (selectedCh && selectedCh.seatId === seatId)) {
                cursor = 'pointer';
              }
            }
          }
        }
      }
      const canvas = canvasRef.current;
      if (canvas) canvas.style.cursor = cursor;
    },
    [
      campus,
      officeState,
      screenToWorld,
      screenToTile,
      campusHitTest,
      isEditMode,
      editorState,
      onEditorTileAction,
      onEditorEraseAction,
      panRef,
      hitTestDeleteButton,
      hitTestRotateButton,
      clampPan,
    ],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      unlockAudio();
      // Middle mouse button (button 1) starts panning
      if (e.button === 1) {
        e.preventDefault();
        // Break camera follow on manual pan
        campus.clearCameraFollow();
        isPanningRef.current = true;
        panStartRef.current = {
          mouseX: e.clientX,
          mouseY: e.clientY,
          panX: panRef.current.x,
          panY: panRef.current.y,
        };
        const canvas = canvasRef.current;
        if (canvas) canvas.style.cursor = 'grabbing';
        return;
      }

      // Right-click in edit mode for erasing
      if (e.button === 2 && isEditMode) {
        const tile = screenToTile(e.clientX, e.clientY);
        if (
          tile &&
          (editorState.activeTool === EditTool.TILE_PAINT ||
            editorState.activeTool === EditTool.WALL_PAINT ||
            editorState.activeTool === EditTool.ERASE)
        ) {
          const layout = officeState.getLayout();
          if (tile.col >= 0 && tile.col < layout.cols && tile.row >= 0 && tile.row < layout.rows) {
            isEraseDraggingRef.current = true;
            onEditorEraseAction(tile.col, tile.row);
          }
        }
        return;
      }

      if (!isEditMode) return;

      // Check rotate/delete button hit first
      const pos = screenToWorld(e.clientX, e.clientY);
      if (pos && hitTestRotateButton(pos.deviceX, pos.deviceY)) {
        onRotateSelected();
        return;
      }
      if (pos && hitTestDeleteButton(pos.deviceX, pos.deviceY)) {
        onDeleteSelected();
        return;
      }

      const tile = screenToTile(e.clientX, e.clientY);

      // SELECT tool (or furniture tool with nothing selected): check for furniture hit to start drag
      const actAsSelect =
        editorState.activeTool === EditTool.SELECT ||
        (editorState.activeTool === EditTool.FURNITURE_PLACE &&
          editorState.selectedFurnitureType === '');
      if (actAsSelect && tile) {
        const layout = officeState.getLayout();
        // Find all furniture at clicked tile, prefer surface items (on top of desks)
        let hitFurniture = null as (typeof layout.furniture)[0] | null;
        for (const f of layout.furniture) {
          const entry = getCatalogEntry(f.type);
          if (!entry) continue;
          if (
            tile.col >= f.col &&
            tile.col < f.col + entry.footprintW &&
            tile.row >= f.row &&
            tile.row < f.row + entry.footprintH
          ) {
            if (!hitFurniture || entry.canPlaceOnSurfaces) hitFurniture = f;
          }
        }
        if (hitFurniture) {
          // Start drag — record offset from furniture's top-left
          editorState.startDrag(
            hitFurniture.uid,
            tile.col,
            tile.row,
            tile.col - hitFurniture.col,
            tile.row - hitFurniture.row,
          );
          return;
        } else {
          // Clicked empty space — deselect
          editorState.clearSelection();
          onEditorSelectionChange();
        }
      }

      // Non-select tools: start paint drag
      editorState.isDragging = true;
      if (tile) {
        onEditorTileAction(tile.col, tile.row);
      }
    },
    [
      campus,
      officeState,
      isEditMode,
      editorState,
      screenToTile,
      screenToWorld,
      onEditorTileAction,
      onEditorEraseAction,
      onEditorSelectionChange,
      onDeleteSelected,
      onRotateSelected,
      hitTestDeleteButton,
      hitTestRotateButton,
      panRef,
    ],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1) {
        isPanningRef.current = false;
        const canvas = canvasRef.current;
        if (canvas) canvas.style.cursor = isEditMode ? 'crosshair' : 'default';
        return;
      }
      if (e.button === 2) {
        isEraseDraggingRef.current = false;
        return;
      }

      // Handle drag-to-move completion
      if (editorState.dragUid) {
        if (editorState.isDragMoving) {
          // Compute target position
          const ghostCol = editorState.ghostCol - editorState.dragOffsetCol;
          const ghostRow = editorState.ghostRow - editorState.dragOffsetRow;
          const draggedItem = officeState
            .getLayout()
            .furniture.find((f) => f.uid === editorState.dragUid);
          if (draggedItem) {
            const valid = canPlaceFurniture(
              officeState.getLayout(),
              draggedItem.type,
              ghostCol,
              ghostRow,
              editorState.dragUid,
            );
            if (valid) {
              onDragMove(editorState.dragUid, ghostCol, ghostRow);
            }
          }
          editorState.clearSelection();
        } else {
          // Click (no movement) — toggle selection
          if (editorState.selectedFurnitureUid === editorState.dragUid) {
            editorState.clearSelection();
          } else {
            editorState.selectedFurnitureUid = editorState.dragUid;
          }
        }
        editorState.clearDrag();
        onEditorSelectionChange();
        const canvas = canvasRef.current;
        if (canvas) canvas.style.cursor = 'crosshair';
        return;
      }

      editorState.isDragging = false;
      editorState.wallDragAdding = null;
    },
    [editorState, isEditMode, officeState, onDragMove, onEditorSelectionChange],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (isEditMode) return; // handled by mouseDown/mouseUp
      const pos = screenToWorld(e.clientX, e.clientY);
      if (!pos) return;

      const hit = campusHitTest(pos.worldX, pos.worldY);
      if (!hit) {
        // Empty canvas — deselect everywhere and close popups
        campus.clearSelectionsExcept(null);
        onEmptyClick();
        return;
      }

      // Remember the last-clicked workspace (edit-mode target)
      campus.activeWorkspacePath = hit.workspace.path;
      const office = hit.office;

      const hitId = office.getCharacterAt(hit.localX, hit.localY);
      if (hitId !== null) {
        onEmptyClick(); // close any open popup
        // Dismiss any active bubble on click
        office.dismissBubble(hitId);
        // Toggle selection: click same agent deselects, different agent selects
        if (office.selectedAgentId === hitId) {
          office.selectedAgentId = null;
          office.cameraFollowId = null;
        } else {
          campus.clearSelectionsExcept(office);
          office.selectedAgentId = hitId;
          office.cameraFollowId = hitId;
        }
        onClick(hitId, office); // still focus terminal
        return;
      }

      // No agent hit — check seat click while an agent in THIS office is selected
      if (office.selectedAgentId !== null) {
        const selectedCh = office.characters.get(office.selectedAgentId);
        // Skip seat reassignment for sub-agents
        if (selectedCh && !selectedCh.isSubagent) {
          const seatId = office.getSeatAtTile(hit.col, hit.row);
          if (seatId) {
            const seat = office.seats.get(seatId);
            if (seat) {
              if (selectedCh.seatId === seatId) {
                // Clicked own seat — send agent back to it
                office.sendToSeat(office.selectedAgentId);
                office.selectedAgentId = null;
                office.cameraFollowId = null;
                return;
              } else if (!seat.assigned) {
                // Clicked available seat — reassign
                office.reassignSeat(office.selectedAgentId, seatId);
                office.selectedAgentId = null;
                office.cameraFollowId = null;
                // Persist seat assignments (exclude sub-agents)
                saveAgentSeats(campus);
                return;
              }
            }
          }
        }
        // Clicked empty floor with a selection — just deselect
        office.selectedAgentId = null;
        office.cameraFollowId = null;
        return;
      }

      if (campus.getSelectedAgentId() !== null) {
        // Selection lives in another office — deselect everywhere
        campus.clearSelectionsExcept(null);
        return;
      }

      // Nothing hit, nothing selected — open the workspace action popup
      onOfficeClick(hit.workspace, pos.screenX, pos.screenY);
    },
    [campus, onClick, onOfficeClick, onEmptyClick, screenToWorld, campusHitTest, isEditMode],
  );

  const handleMouseLeave = useCallback(() => {
    isPanningRef.current = false;
    isEraseDraggingRef.current = false;
    editorState.isDragging = false;
    editorState.wallDragAdding = null;
    editorState.clearDrag();
    editorState.ghostCol = -1;
    editorState.ghostRow = -1;
    campus.clearHoverExcept(null);
  }, [campus, editorState]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (isEditMode) return;
      // Right-click to walk selected agent to a tile in its own office
      const selectedId = campus.getSelectedAgentId();
      if (selectedId === null) return;
      const entry = campus.getEntryForAgent(selectedId);
      if (!entry) return;
      const pos = screenToWorld(e.clientX, e.clientY);
      if (!pos) return;
      const origin = campus.originPx(entry);
      const col = Math.floor((pos.worldX - origin.x) / TILE_SIZE);
      const row = Math.floor((pos.worldY - origin.y) / TILE_SIZE);
      const layout = entry.office.getLayout();
      if (col < 0 || col >= layout.cols || row < 0 || row >= layout.rows) return;
      entry.office.walkToTile(selectedId, col, row);
    },
    [isEditMode, campus, screenToWorld],
  );

  // Wheel: Ctrl+wheel to zoom, plain wheel/trackpad to pan
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // Accumulate scroll delta, step zoom when threshold crossed
        zoomAccumulatorRef.current += e.deltaY;
        if (Math.abs(zoomAccumulatorRef.current) >= ZOOM_SCROLL_THRESHOLD) {
          const delta = zoomAccumulatorRef.current < 0 ? 1 : -1;
          zoomAccumulatorRef.current = 0;
          const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom + delta));
          if (newZoom !== zoom) {
            onZoomChange(newZoom);
          }
        }
      } else {
        // Pan via trackpad two-finger scroll or mouse wheel
        const dpr = window.devicePixelRatio || 1;
        campus.clearCameraFollow();
        panRef.current = clampPan(
          panRef.current.x - e.deltaX * dpr,
          panRef.current.y - e.deltaY * dpr,
        );
      }
    },
    [zoom, onZoomChange, campus, panRef, clampPan],
  );

  // Prevent default middle-click browser behavior (auto-scroll)
  const handleAuxClick = useCallback((e: React.MouseEvent) => {
    if (e.button === 1) e.preventDefault();
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        background: '#1E1E2E',
      }}
    >
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onClick={handleClick}
        onAuxClick={handleAuxClick}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
        style={{ display: 'block' }}
      />
    </div>
  );
}
