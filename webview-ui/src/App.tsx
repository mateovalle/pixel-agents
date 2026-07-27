import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  HostToWebviewMessage,
  ResumableSession,
  WorkspaceInfo,
} from '../../shared/protocol.js';
import { AchievementToast } from './components/AchievementToast.js';
import { BottomToolbar } from './components/BottomToolbar.js';
import { ResumePicker } from './components/chat/ResumePicker.js';
import { DebugView } from './components/DebugView.js';
import { OfficePopup } from './components/OfficePopup.js';
import type { AgentTaskGroup } from './components/TasksDrawer.js';
import { TasksDrawer } from './components/TasksDrawer.js';
import { TerminalPanel } from './components/TerminalPanel.js';
import { TerminalSplitter } from './components/TerminalSplitter.js';
import { ZoomControls } from './components/ZoomControls.js';
import {
  OFFICE_POPUP_MARGIN_PX,
  OFFICE_POPUP_WIDTH_PX,
  PULSE_ANIMATION_DURATION_SEC,
} from './constants.js';
import { useEditorActions } from './hooks/useEditorActions.js';
import { useEditorKeyboard } from './hooks/useEditorKeyboard.js';
import { useExtensionMessages } from './hooks/useExtensionMessages.js';
import { OfficeCanvas } from './office/components/OfficeCanvas.js';
import { ToolOverlay } from './office/components/ToolOverlay.js';
import { EditorState } from './office/editor/editorState.js';
import { EditorToolbar } from './office/editor/EditorToolbar.js';
import { CampusState } from './office/engine/campusState.js';
import type { OfficeState } from './office/engine/officeState.js';
import { isRotatable } from './office/layout/furnitureCatalog.js';
import { EditTool } from './office/types.js';
import { vscode } from './vscodeApi.js';

// Game state lives outside React — updated imperatively by message handlers.
// The campus owns one OfficeState per registered workspace.
const campus = new CampusState();
const editorState = new EditorState();

/** The active office — edit-mode target and fallback for editor actions. */
function getOfficeState(): OfficeState {
  return campus.getActiveOffice();
}

/** Workspace path of the active office (null → detached fallback, saves globally). */
function getActiveWorkspacePath(): string | null {
  return campus.getActiveOfficePath();
}

const actionBarBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: '22px',
  background: 'var(--pixel-btn-bg)',
  color: 'var(--pixel-text-dim)',
  border: '2px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
};

const actionBarBtnDisabled: React.CSSProperties = {
  ...actionBarBtnStyle,
  opacity: 'var(--pixel-btn-disabled-opacity)',
  cursor: 'default',
};

function EditActionBar({
  editor,
  editorState: es,
}: {
  editor: ReturnType<typeof useEditorActions>;
  editorState: EditorState;
}) {
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const undoDisabled = es.undoStack.length === 0;
  const redoDisabled = es.redoStack.length === 0;

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 'var(--pixel-controls-z)',
        display: 'flex',
        gap: 4,
        alignItems: 'center',
        background: 'var(--pixel-bg)',
        border: '2px solid var(--pixel-border)',
        borderRadius: 0,
        padding: '4px 8px',
        boxShadow: 'var(--pixel-shadow)',
      }}
    >
      <button
        style={undoDisabled ? actionBarBtnDisabled : actionBarBtnStyle}
        onClick={undoDisabled ? undefined : editor.handleUndo}
        title="Undo (Ctrl+Z)"
      >
        Undo
      </button>
      <button
        style={redoDisabled ? actionBarBtnDisabled : actionBarBtnStyle}
        onClick={redoDisabled ? undefined : editor.handleRedo}
        title="Redo (Ctrl+Y)"
      >
        Redo
      </button>
      <button style={actionBarBtnStyle} onClick={editor.handleSave} title="Save layout">
        Save
      </button>
      {!showResetConfirm ? (
        <button
          style={actionBarBtnStyle}
          onClick={() => setShowResetConfirm(true)}
          title="Reset to last saved layout"
        >
          Reset
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: '22px', color: 'var(--pixel-reset-text)' }}>Reset?</span>
          <button
            style={{ ...actionBarBtnStyle, background: 'var(--pixel-danger-bg)', color: '#fff' }}
            onClick={() => {
              setShowResetConfirm(false);
              editor.handleReset();
            }}
          >
            Yes
          </button>
          <button style={actionBarBtnStyle} onClick={() => setShowResetConfirm(false)}>
            No
          </button>
        </div>
      )}
    </div>
  );
}

function App() {
  const editor = useEditorActions(getOfficeState, editorState, getActiveWorkspacePath);

  const isEditDirty = useCallback(
    () => editor.isEditMode && editor.isDirty,
    [editor.isEditMode, editor.isDirty],
  );

  const {
    agents,
    selectedAgent,
    agentTools,
    agentStatuses,
    subagentTools,
    subagentCharacters,
    layoutReady,
    loadedAssets,
    workspaces,
    workspaceTodos,
    agentTodos,
    usageSummary,
    achievements,
    unlockQueue,
    dismissUnlock,
  } = useExtensionMessages(campus, editor.setLastSavedLayout, isEditDirty);

  const [isDebugMode, setIsDebugMode] = useState(false);
  const [terminalVisible, setTerminalVisible] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(250);

  // Office action popup (opened by clicking an office's floor)
  const [officePopup, setOfficePopup] = useState<{
    workspace: WorkspaceInfo;
    x: number;
    y: number;
  } | null>(null);

  const handleOfficeClick = useCallback((workspace: WorkspaceInfo, x: number, y: number) => {
    // Clamp so the popup stays inside the office container (event handler —
    // ref access is fine here, unlike during render)
    const rect = containerRef.current?.getBoundingClientRect();
    const maxX =
      (rect?.width ?? window.innerWidth) - OFFICE_POPUP_WIDTH_PX - OFFICE_POPUP_MARGIN_PX;
    setOfficePopup({
      workspace,
      x: Math.max(OFFICE_POPUP_MARGIN_PX, Math.min(x, maxX)),
      y: Math.max(OFFICE_POPUP_MARGIN_PX, y),
    });
  }, []);

  const handleCloseOfficePopup = useCallback(() => setOfficePopup(null), []);

  // Per-workspace tasks drawer — one open at a time; opening for another
  // workspace replaces the current one.
  const [tasksDrawerPath, setTasksDrawerPath] = useState<string | null>(null);
  const handleOpenTasks = useCallback((path: string) => setTasksDrawerPath(path), []);
  const handleCloseTasksDrawer = useCallback(() => setTasksDrawerPath(null), []);

  // Close the popup if its workspace was removed
  useEffect(() => {
    setOfficePopup((prev) =>
      prev && !workspaces.some((w) => w.path === prev.workspace.path) ? null : prev,
    );
  }, [workspaces]);

  // Edit-mode transitions: reset the camera (campus pan is meaningless for a
  // single office at origin 0 and vice versa), clear selections on enter, and
  // on exit adopt the possibly-edited layout as the active workspace's own
  // layout (or as the default layout when editing the detached fallback).
  const prevEditModeRef = useRef(editor.isEditMode);
  useEffect(() => {
    if (prevEditModeRef.current === editor.isEditMode) return;
    prevEditModeRef.current = editor.isEditMode;
    editor.panRef.current = { x: 0, y: 0 };
    if (editor.isEditMode) {
      campus.clearSelectionsExcept(null);
      campus.clearHoverExcept(null);
      setOfficePopup(null);
    } else {
      campus.adoptLayoutFromActive();
    }
  }, [editor.isEditMode, editor.panRef]);

  // Resume-session picker — opened by a 'sessionList' reply from the host;
  // a newer 'sessionList' while open replaces the contents.
  const [sessionList, setSessionList] = useState<{
    folderPath: string;
    sessions: ResumableSession[];
  } | null>(null);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data as HostToWebviewMessage;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'sessionList') {
        setSessionList({ folderPath: msg.folderPath, sessions: msg.sessions });
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const handleCloseResumePicker = useCallback(() => setSessionList(null), []);

  const handleToggleDebugMode = useCallback(() => setIsDebugMode((prev) => !prev), []);

  const handleTerminalCreated = useCallback(() => setTerminalVisible(true), []);
  const handleAllTabsClosed = useCallback(() => setTerminalVisible(false), []);

  const handleSplitterDrag = useCallback((deltaY: number) => {
    setTerminalHeight((prev) => Math.max(100, Math.min(window.innerHeight - 150, prev - deltaY)));
  }, []);

  const handleSplitterDoubleClick = useCallback(() => {
    setTerminalVisible((prev) => !prev);
  }, []);

  const handleSelectAgent = useCallback((id: number) => {
    vscode.postMessage({ type: 'focusAgent', id });
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);

  const [editorTickForKeyboard, setEditorTickForKeyboard] = useState(0);
  useEditorKeyboard(
    editor.isEditMode,
    editorState,
    editor.handleDeleteSelected,
    editor.handleRotateSelected,
    editor.handleToggleState,
    editor.handleUndo,
    editor.handleRedo,
    useCallback(() => setEditorTickForKeyboard((n) => n + 1), []),
    editor.handleToggleEditMode,
  );

  const handleCloseAgent = useCallback((id: number) => {
    vscode.postMessage({ type: 'closeAgent', id });
  }, []);

  const handleClick = useCallback((agentId: number, office: OfficeState) => {
    // If clicked agent is a sub-agent, focus the parent's terminal instead
    const meta = office.subagentMeta.get(agentId);
    const focusId = meta ? meta.parentAgentId : agentId;
    vscode.postMessage({ type: 'focusAgent', id: focusId });
  }, []);

  const officeState = getOfficeState();

  // Force dependency on editorTickForKeyboard to propagate keyboard-triggered re-renders
  void editorTickForKeyboard;

  // Show "Press R to rotate" hint when a rotatable item is selected or being placed
  const showRotateHint =
    editor.isEditMode &&
    (() => {
      if (editorState.selectedFurnitureUid) {
        const item = officeState
          .getLayout()
          .furniture.find((f) => f.uid === editorState.selectedFurnitureUid);
        if (item && isRotatable(item.type)) return true;
      }
      if (
        editorState.activeTool === EditTool.FURNITURE_PLACE &&
        isRotatable(editorState.selectedFurnitureType)
      ) {
        return true;
      }
      return false;
    })();

  // Tasks drawer data — resolves to null when the workspace was removed.
  const tasksWorkspace = tasksDrawerPath
    ? (workspaces.find((w) => w.path === tasksDrawerPath) ?? null)
    : null;
  // Map agentId → workspace via the campus: an agent's office entry carries
  // the workspace it was routed to on creation.
  const tasksAgentGroups: AgentTaskGroup[] = tasksWorkspace
    ? Object.entries(agentTodos)
        .filter(
          ([idStr, todos]) =>
            todos.length > 0 &&
            campus.getEntryForAgent(Number(idStr))?.workspace.path === tasksWorkspace.path,
        )
        .map(([idStr, todos]) => ({ agentId: Number(idStr), label: `Agent ${idStr}`, todos }))
    : [];

  if (!layoutReady) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--vscode-foreground)',
        }}
      >
        Loading...
      </div>
    );
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes pixel-agents-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        .pixel-agents-pulse { animation: pixel-agents-pulse ${PULSE_ANIMATION_DURATION_SEC}s ease-in-out infinite; }
      `}</style>

      {/* Office area */}
      <div
        ref={containerRef}
        style={{ flex: 1, position: 'relative', overflow: 'hidden', minHeight: 100 }}
      >
        <OfficeCanvas
          campus={campus}
          officeState={officeState}
          onClick={handleClick}
          onOfficeClick={handleOfficeClick}
          onEmptyClick={handleCloseOfficePopup}
          isEditMode={editor.isEditMode}
          editorState={editorState}
          onEditorTileAction={editor.handleEditorTileAction}
          onEditorEraseAction={editor.handleEditorEraseAction}
          onEditorSelectionChange={editor.handleEditorSelectionChange}
          onDeleteSelected={editor.handleDeleteSelected}
          onRotateSelected={editor.handleRotateSelected}
          onDragMove={editor.handleDragMove}
          zoom={editor.zoom}
          onZoomChange={editor.handleZoomChange}
          panRef={editor.panRef}
        />

        <ZoomControls zoom={editor.zoom} onZoomChange={editor.handleZoomChange} />

        {/* Vignette overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'var(--pixel-vignette)',
            pointerEvents: 'none',
            zIndex: 40,
          }}
        />

        <BottomToolbar
          isEditMode={editor.isEditMode}
          onToggleEditMode={editor.handleToggleEditMode}
          isDebugMode={isDebugMode}
          onToggleDebugMode={handleToggleDebugMode}
          usageSummary={usageSummary}
          achievements={achievements}
        />

        <AchievementToast queue={unlockQueue} onDismiss={dismissUnlock} />

        {editor.isEditMode && editor.isDirty && (
          <EditActionBar editor={editor} editorState={editorState} />
        )}

        {showRotateHint && (
          <div
            style={{
              position: 'absolute',
              top: 8,
              left: '50%',
              transform: editor.isDirty ? 'translateX(calc(-50% + 100px))' : 'translateX(-50%)',
              zIndex: 49,
              background: 'var(--pixel-hint-bg)',
              color: '#fff',
              fontSize: '20px',
              padding: '3px 8px',
              borderRadius: 0,
              border: '2px solid var(--pixel-accent)',
              boxShadow: 'var(--pixel-shadow)',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Press <b>R</b> to rotate
          </div>
        )}

        {editor.isEditMode &&
          (() => {
            const selUid = editorState.selectedFurnitureUid;
            const selColor = selUid
              ? (officeState.getLayout().furniture.find((f) => f.uid === selUid)?.color ?? null)
              : null;
            return (
              <EditorToolbar
                activeTool={editorState.activeTool}
                selectedTileType={editorState.selectedTileType}
                selectedFurnitureType={editorState.selectedFurnitureType}
                selectedFurnitureUid={selUid}
                selectedFurnitureColor={selColor}
                floorColor={editorState.floorColor}
                wallColor={editorState.wallColor}
                onToolChange={editor.handleToolChange}
                onTileTypeChange={editor.handleTileTypeChange}
                onFloorColorChange={editor.handleFloorColorChange}
                onWallColorChange={editor.handleWallColorChange}
                onSelectedFurnitureColorChange={editor.handleSelectedFurnitureColorChange}
                onFurnitureTypeChange={editor.handleFurnitureTypeChange}
                loadedAssets={loadedAssets}
              />
            );
          })()}

        <ToolOverlay
          campus={campus}
          isEditMode={editor.isEditMode}
          agents={agents}
          agentTools={agentTools}
          subagentCharacters={subagentCharacters}
          containerRef={containerRef}
          zoom={editor.zoom}
          panRef={editor.panRef}
          onCloseAgent={handleCloseAgent}
        />

        {officePopup && !editor.isEditMode && (
          <OfficePopup
            workspace={officePopup.workspace}
            x={officePopup.x}
            y={officePopup.y}
            openTaskCount={
              (workspaceTodos[officePopup.workspace.path] ?? []).filter((t) => t.status === 'open')
                .length
            }
            onOpenTasks={() => handleOpenTasks(officePopup.workspace.path)}
            onClose={handleCloseOfficePopup}
          />
        )}

        {tasksWorkspace && !editor.isEditMode && (
          <TasksDrawer
            workspace={tasksWorkspace}
            todos={workspaceTodos[tasksWorkspace.path] ?? []}
            agentGroups={tasksAgentGroups}
            onClose={handleCloseTasksDrawer}
          />
        )}

        {workspaces.length === 0 && !editor.isEditMode && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              zIndex: 30,
            }}
          >
            <div
              style={{
                background: 'var(--pixel-bg)',
                border: '2px solid var(--pixel-border)',
                borderRadius: 0,
                boxShadow: 'var(--pixel-shadow)',
                padding: '12px 20px',
                fontSize: '24px',
                color: 'var(--pixel-text-dim)',
              }}
            >
              Add a workspace to get started
            </div>
          </div>
        )}

        {sessionList && (
          <ResumePicker
            folderPath={sessionList.folderPath}
            sessions={sessionList.sessions}
            onClose={handleCloseResumePicker}
          />
        )}

        {isDebugMode && (
          <DebugView
            agents={agents}
            selectedAgent={selectedAgent}
            agentTools={agentTools}
            agentStatuses={agentStatuses}
            subagentTools={subagentTools}
            onSelectAgent={handleSelectAgent}
          />
        )}
      </div>

      {/* Terminal area */}
      {terminalVisible && (
        <TerminalSplitter onDrag={handleSplitterDrag} onDoubleClick={handleSplitterDoubleClick} />
      )}
      <TerminalPanel
        height={terminalVisible ? terminalHeight : 0}
        onTerminalCreated={handleTerminalCreated}
        onShowTerminal={handleTerminalCreated}
        onAllTabsClosed={handleAllTabsClosed}
      />
    </div>
  );
}

export default App;
