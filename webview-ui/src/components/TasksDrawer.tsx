import { useEffect, useState } from 'react';

import type { AgentTodo, TodoItem, WorkspaceInfo } from '../../../shared/protocol.js';
import {
  TASKS_CHECKBOX_SIZE_PX,
  TASKS_DRAWER_WIDTH_PX,
  TASKS_HEADER_FONT_SIZE_PX,
  TASKS_ITEM_FONT_SIZE_PX,
  TASKS_SECTION_FONT_SIZE_PX,
} from '../constants.js';
import { vscode } from '../vscodeApi.js';

/** One workspace agent with its live plan (TodoWrite items). */
export interface AgentTaskGroup {
  agentId: number;
  label: string;
  todos: AgentTodo[];
}

interface TasksDrawerProps {
  workspace: WorkspaceInfo;
  /** Human todos of this workspace. */
  todos: TodoItem[];
  /** Agents of this workspace that have published a plan. */
  agentGroups: AgentTaskGroup[];
  onClose: () => void;
}

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: TASKS_SECTION_FONT_SIZE_PX,
  color: 'var(--pixel-text-dim)',
  padding: '8px 10px 4px',
  borderBottom: '2px solid var(--pixel-border)',
};

const emptyStyle: React.CSSProperties = {
  fontSize: TASKS_ITEM_FONT_SIZE_PX,
  color: 'var(--pixel-text-dim)',
  opacity: 'var(--pixel-btn-disabled-opacity)',
  padding: '8px 10px',
};

const iconBtnStyle: React.CSSProperties = {
  fontSize: TASKS_ITEM_FONT_SIZE_PX,
  lineHeight: 1,
  padding: '2px 4px',
  background: 'var(--pixel-btn-bg)',
  color: 'var(--pixel-text-dim)',
  border: '2px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
};

const AGENT_TODO_GLYPHS: Record<AgentTodo['status'], string> = {
  completed: '✓',
  in_progress: '▸',
  pending: '○',
};

function agentTodoColor(status: AgentTodo['status']): string {
  if (status === 'in_progress') return 'var(--pixel-accent)';
  return 'var(--pixel-text-dim)';
}

function HumanTodoRow({ path, todo }: { path: string; todo: TodoItem }) {
  const [hovered, setHovered] = useState(false);
  const done = todo.status === 'done';

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 10px',
        background: hovered ? 'var(--pixel-btn-bg)' : 'transparent',
      }}
    >
      <button
        onClick={() => vscode.postMessage({ type: 'toggleTodo', path, id: todo.id })}
        title={done ? 'Mark as open' : 'Mark as done'}
        style={{
          width: TASKS_CHECKBOX_SIZE_PX,
          height: TASKS_CHECKBOX_SIZE_PX,
          flexShrink: 0,
          padding: 0,
          fontSize: TASKS_CHECKBOX_SIZE_PX - 4,
          lineHeight: 1,
          background: done ? 'var(--pixel-agent-bg)' : 'transparent',
          color: 'var(--pixel-green)',
          border: '2px solid var(--pixel-border-light)',
          borderRadius: 0,
          cursor: 'pointer',
        }}
      >
        {done ? '✓' : ''}
      </button>
      <span
        style={{
          flex: 1,
          fontSize: TASKS_ITEM_FONT_SIZE_PX,
          color: 'var(--pixel-text)',
          opacity: done ? 'var(--pixel-btn-disabled-opacity)' : 1,
          textDecoration: done ? 'line-through' : 'none',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={todo.text}
      >
        {todo.text}
      </span>
      {hovered && (
        <>
          <button
            disabled={done}
            onClick={
              done ? undefined : () => vscode.postMessage({ type: 'assignTodo', path, id: todo.id })
            }
            title="Start an agent on this task"
            style={{
              ...iconBtnStyle,
              color: done ? 'var(--pixel-text-dim)' : 'var(--pixel-green)',
              opacity: done ? 'var(--pixel-btn-disabled-opacity)' : 1,
              cursor: done ? 'default' : 'pointer',
            }}
          >
            ▶
          </button>
          <button
            onClick={() => vscode.postMessage({ type: 'deleteTodo', path, id: todo.id })}
            title="Delete this task"
            style={{ ...iconBtnStyle, color: 'var(--pixel-close-text)' }}
          >
            ✕
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Right-side drawer listing a workspace's human todos ("Tasks") and the live
 * plans of its working agents ("Agents at work"). Closes on Esc or ✕.
 */
export function TasksDrawer({ workspace, todos, agentGroups, onClose }: TasksDrawerProps) {
  const [newText, setNewText] = useState('');

  // Esc closes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  const handleAdd = () => {
    const text = newText.trim();
    if (!text) return;
    vscode.postMessage({ type: 'addTodo', path: workspace.path, text });
    setNewText('');
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: TASKS_DRAWER_WIDTH_PX,
        zIndex: 'var(--pixel-controls-z)',
        background: 'var(--pixel-bg)',
        borderLeft: '2px solid var(--pixel-border)',
        boxShadow: 'var(--pixel-shadow-left)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          borderBottom: '2px solid var(--pixel-border)',
        }}
      >
        <span
          style={{
            flex: 1,
            fontSize: TASKS_HEADER_FONT_SIZE_PX,
            color: 'var(--pixel-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={workspace.path}
        >
          {workspace.name}
        </span>
        <button
          onClick={onClose}
          title="Close (Esc)"
          style={{ ...iconBtnStyle, fontSize: TASKS_HEADER_FONT_SIZE_PX }}
        >
          ✕
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Human todos */}
        <div style={sectionHeaderStyle}>Tasks</div>
        {todos.length === 0 ? (
          <div style={emptyStyle}>No tasks yet</div>
        ) : (
          todos.map((todo) => <HumanTodoRow key={todo.id} path={workspace.path} todo={todo} />)
        )}
        <div style={{ display: 'flex', gap: 4, padding: '6px 10px' }}>
          <input
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
            }}
            placeholder="New task…"
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: TASKS_ITEM_FONT_SIZE_PX,
              fontFamily: 'inherit',
              color: 'var(--pixel-text)',
              background: 'var(--pixel-btn-bg)',
              border: '2px solid var(--pixel-border)',
              borderRadius: 0,
              padding: '2px 6px',
              outline: 'none',
            }}
          />
          <button
            onClick={handleAdd}
            title="Add task"
            style={{
              ...iconBtnStyle,
              border: '2px solid var(--pixel-agent-border)',
              background: 'var(--pixel-agent-bg)',
              color: 'var(--pixel-agent-text)',
            }}
          >
            Add
          </button>
        </div>

        {/* Agent plans */}
        <div style={sectionHeaderStyle}>Agents at work</div>
        {agentGroups.length === 0 ? (
          <div style={emptyStyle}>No agents working here</div>
        ) : (
          agentGroups.map((group) => (
            <div key={group.agentId} style={{ padding: '4px 0 6px' }}>
              <div
                style={{
                  fontSize: TASKS_ITEM_FONT_SIZE_PX,
                  color: 'var(--pixel-text)',
                  padding: '2px 10px',
                }}
              >
                {group.label}
              </div>
              {group.todos.map((todo, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 6,
                    padding: '1px 10px 1px 18px',
                    fontSize: TASKS_ITEM_FONT_SIZE_PX,
                    color: agentTodoColor(todo.status),
                    opacity: todo.status === 'completed' ? 'var(--pixel-btn-disabled-opacity)' : 1,
                  }}
                >
                  <span style={{ flexShrink: 0 }}>{AGENT_TODO_GLYPHS[todo.status]}</span>
                  <span style={{ overflowWrap: 'anywhere' }}>{todo.content}</span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
