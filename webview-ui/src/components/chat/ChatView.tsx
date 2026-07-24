import { useCallback, useEffect, useRef, useState } from 'react';

import type { HostToWebviewMessage } from '../../../../shared/protocol.js';
import {
  CHAT_BODY_FONT_SIZE_PX,
  CHAT_COMPOSER_LINE_HEIGHT_PX,
  CHAT_COMPOSER_MAX_ROWS,
  CHAT_COST_DECIMALS,
  CHAT_DURATION_DECIMALS,
  CHAT_MS_PER_SEC,
  CHAT_NEAR_BOTTOM_PX,
} from '../../constants.js';
import { vscode } from '../../vscodeApi.js';
import type { ChatItem, ChatModel } from './chatModel.js';
import { applyChatEvent, applyChatEvents, emptyChatModel } from './chatModel.js';
import { Markdown } from './Markdown.js';
import type { PermissionRequestInfo } from './PermissionCard.js';
import { PermissionCard } from './PermissionCard.js';
import { ToolCard } from './ToolCard.js';

interface ChatViewProps {
  agentId: number;
  visible: boolean;
}

const userBubbleStyle: React.CSSProperties = {
  alignSelf: 'flex-end',
  maxWidth: '80%',
  background: 'var(--pixel-chat-user-bg)',
  border: '2px solid var(--pixel-accent)',
  borderRadius: 0,
  padding: '5px 10px',
  fontSize: CHAT_BODY_FONT_SIZE_PX,
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  color: 'var(--pixel-text)',
};

const assistantStyle: React.CSSProperties = {
  alignSelf: 'stretch',
  color: 'var(--pixel-text)',
};

const thinkingHeaderStyle: React.CSSProperties = {
  fontSize: CHAT_BODY_FONT_SIZE_PX - 1,
  color: 'var(--pixel-text-dim)',
  cursor: 'pointer',
  userSelect: 'none',
};

const thinkingBodyStyle: React.CSSProperties = {
  fontSize: CHAT_BODY_FONT_SIZE_PX - 1,
  color: 'var(--pixel-text-dim)',
  fontStyle: 'italic',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  borderLeft: '2px solid var(--pixel-border)',
  padding: '2px 8px',
  marginTop: 2,
};

const turnSeparatorStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  color: 'var(--pixel-text-dim)',
  fontSize: 11,
  margin: '4px 0',
};

const turnRuleStyle: React.CSSProperties = {
  flex: 1,
  borderTop: '1px solid var(--pixel-border)',
};

const statusLineStyle: React.CSSProperties = {
  fontSize: CHAT_BODY_FONT_SIZE_PX - 1,
  color: 'var(--pixel-text-dim)',
  fontStyle: 'italic',
};

const errorLineStyle: React.CSSProperties = {
  fontSize: CHAT_BODY_FONT_SIZE_PX,
  color: 'var(--pixel-chat-red)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const newMessagesBtnStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 10,
  left: '50%',
  transform: 'translateX(-50%)',
  background: 'var(--pixel-bg)',
  color: 'var(--pixel-text)',
  border: '2px solid var(--pixel-accent)',
  borderRadius: 0,
  boxShadow: 'var(--pixel-shadow)',
  padding: '3px 10px',
  fontSize: '18px',
  cursor: 'pointer',
};

const composerRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  gap: 6,
  padding: '8px 10px',
  borderTop: '2px solid var(--pixel-border)',
  background: 'var(--pixel-bg)',
};

const textareaStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  resize: 'none',
  fontSize: CHAT_BODY_FONT_SIZE_PX,
  lineHeight: `${CHAT_COMPOSER_LINE_HEIGHT_PX}px`,
  background: 'var(--pixel-chat-code-bg)',
  color: 'var(--pixel-text)',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  padding: '5px 8px',
  outline: 'none',
  overflowY: 'auto',
};

const sendBtnStyle: React.CSSProperties = {
  padding: '5px 14px',
  fontSize: '20px',
  background: 'var(--pixel-agent-bg)',
  border: '2px solid var(--pixel-agent-border)',
  color: 'var(--pixel-agent-text)',
  borderRadius: 0,
  cursor: 'pointer',
  flexShrink: 0,
};

const sendBtnDisabledStyle: React.CSSProperties = {
  ...sendBtnStyle,
  opacity: 'var(--pixel-btn-disabled-opacity)',
  cursor: 'default',
};

const stopBtnStyle: React.CSSProperties = {
  ...sendBtnStyle,
  background: 'rgba(243, 139, 168, 0.12)',
  border: '2px solid var(--pixel-chat-red)',
  color: 'var(--pixel-chat-red)',
};

function ThinkingItem({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pixel-chat-body">
      <div style={thinkingHeaderStyle} onClick={() => setOpen((v) => !v)}>
        {open ? '▼' : '▶'} Thinking
      </div>
      {open && <div style={thinkingBodyStyle}>{text}</div>}
    </div>
  );
}

function TurnSeparator({ costUsd, durationMs }: { costUsd: number; durationMs: number }) {
  const cost = `$${costUsd.toFixed(CHAT_COST_DECIMALS)}`;
  const secs = `${(durationMs / CHAT_MS_PER_SEC).toFixed(CHAT_DURATION_DECIMALS)}s`;
  return (
    <div className="pixel-chat-body" style={turnSeparatorStyle}>
      <div style={turnRuleStyle} />
      <span>
        {cost} · {secs}
      </span>
      <div style={turnRuleStyle} />
    </div>
  );
}

function ChatItemView({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="pixel-chat-body" style={userBubbleStyle}>
          {item.text}
        </div>
      );
    case 'assistant':
      return (
        <div style={assistantStyle}>
          <Markdown text={item.text} />
          {item.streaming && (
            <span className="pixel-chat-dot" style={{ color: 'var(--pixel-text-dim)' }}>
              ▌
            </span>
          )}
        </div>
      );
    case 'thinking':
      return <ThinkingItem text={item.text} />;
    case 'tool':
      return (
        <ToolCard
          name={item.name}
          input={item.input}
          status={item.status}
          resultSummary={item.resultSummary}
        />
      );
    case 'turn':
      return <TurnSeparator costUsd={item.costUsd} durationMs={item.durationMs} />;
    case 'status':
      return (
        <div className="pixel-chat-body" style={statusLineStyle}>
          {item.text}
        </div>
      );
    case 'error':
      return (
        <div className="pixel-chat-body" style={errorLineStyle}>
          {item.text}
        </div>
      );
    default:
      return null;
  }
}

export function ChatView({ agentId, visible }: ChatViewProps) {
  const [model, setModel] = useState<ChatModel>(emptyChatModel);
  const [busy, setBusy] = useState(false);
  const [permissions, setPermissions] = useState<PermissionRequestInfo[]>([]);
  const [hasNew, setHasNew] = useState(false);
  const [draft, setDraft] = useState('');

  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const nearBottomRef = useRef(true);
  const replayedRef = useRef(false);

  useEffect(() => {
    // Ignore live chat-events until the replay arrives — the replay contains
    // everything sent so far and message order is guaranteed (same gating
    // pattern TerminalInstance uses for pty-replay).
    const handler = (e: MessageEvent) => {
      const msg = e.data as HostToWebviewMessage;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'chat-replay') {
        if (msg.agentId !== agentId || replayedRef.current) return;
        replayedRef.current = true;
        const events = msg.events;
        setModel(applyChatEvents(emptyChatModel(), events));
      } else if (msg.type === 'chat-event') {
        if (msg.agentId !== agentId || !replayedRef.current) return;
        const event = msg.event;
        setModel((m) => applyChatEvent(m, event));
        if (!nearBottomRef.current) {
          setHasNew(true);
        }
      } else if (msg.type === 'chat-busy') {
        if (msg.agentId !== agentId) return;
        setBusy(msg.busy);
      } else if (msg.type === 'chat-permission-request') {
        if (msg.agentId !== agentId) return;
        const request: PermissionRequestInfo = {
          requestId: msg.requestId,
          toolName: msg.toolName,
          title: msg.title,
          description: msg.description,
          input: msg.input,
        };
        setPermissions((prev) => [
          ...prev.filter((p) => p.requestId !== request.requestId),
          request,
        ]);
      } else if (msg.type === 'chat-permission-resolved') {
        if (msg.agentId !== agentId) return;
        const requestId = msg.requestId;
        setPermissions((prev) => prev.filter((p) => p.requestId !== requestId));
      }
    };

    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'chatReady', id: agentId });
    return () => window.removeEventListener('message', handler);
  }, [agentId]);

  // Auto-scroll to bottom on new content when the user is already near it
  useEffect(() => {
    const el = listRef.current;
    if (!el || !visible) return;
    if (nearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [model, visible]);

  // Focus the composer when the tab becomes visible
  useEffect(() => {
    if (visible) {
      textareaRef.current?.focus();
    }
  }, [visible]);

  // Auto-grow the textarea (1–CHAT_COMPOSER_MAX_ROWS rows)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = CHAT_COMPOSER_MAX_ROWS * CHAT_COMPOSER_LINE_HEIGHT_PX;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [draft]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < CHAT_NEAR_BOTTOM_PX;
    nearBottomRef.current = near;
    if (near) {
      setHasNew(false);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    nearBottomRef.current = true;
    setHasNew(false);
  }, []);

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (text === '') return;
    // No local echo — the host sends 'user-text' as the single source of truth
    vscode.postMessage({ type: 'chatSend', id: agentId, text });
    setDraft('');
  }, [agentId, draft]);

  const handleStop = useCallback(() => {
    vscode.postMessage({ type: 'chatInterrupt', id: agentId });
  }, [agentId]);

  const handlePermissionResponse = useCallback(
    (requestId: string, allow: boolean, message?: string) => {
      vscode.postMessage({
        type: 'chatPermissionResponse',
        id: agentId,
        requestId,
        allow,
        message,
      });
      setPermissions((prev) => prev.filter((p) => p.requestId !== requestId));
    },
    [agentId],
  );

  const sendDisabled = draft.trim() === '';

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: visible ? 'flex' : 'none',
        flexDirection: 'column',
        background: 'var(--pixel-bg)',
      }}
    >
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div
          ref={listRef}
          onScroll={handleScroll}
          style={{
            position: 'absolute',
            inset: 0,
            overflowY: 'auto',
            padding: '10px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {model.items.map((item) => (
            <ChatItemView key={item.key} item={item} />
          ))}
        </div>
        {hasNew && (
          <button style={newMessagesBtnStyle} onClick={scrollToBottom}>
            ↓ new messages
          </button>
        )}
      </div>

      {permissions.length > 0 && (
        <div style={{ flexShrink: 0, maxHeight: '50%', overflowY: 'auto' }}>
          {permissions.map((request) => (
            <PermissionCard
              key={request.requestId}
              request={request}
              onRespond={handlePermissionResponse}
            />
          ))}
        </div>
      )}

      <div style={composerRowStyle}>
        <textarea
          ref={textareaRef}
          className="pixel-chat-body"
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Message Claude… (Enter to send, Shift+Enter for newline)"
          style={textareaStyle}
        />
        {busy ? (
          <button style={stopBtnStyle} onClick={handleStop} title="Interrupt the current turn">
            Stop
          </button>
        ) : (
          <button
            style={sendDisabled ? sendBtnDisabledStyle : sendBtnStyle}
            onClick={sendDisabled ? undefined : handleSend}
            disabled={sendDisabled}
            title="Send message"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
