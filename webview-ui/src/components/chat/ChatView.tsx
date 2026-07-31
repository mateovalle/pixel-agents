import { useCallback, useEffect, useRef, useState } from 'react';

import type { ChatPermissionMode, HostToWebviewMessage } from '../../../../shared/protocol.js';
import {
  CHAT_ACCEPTED_IMAGE_TYPES,
  CHAT_ATTACH_THUMB_PX,
  CHAT_ATTACH_WARNING_MS,
  CHAT_BODY_FONT_SIZE_PX,
  CHAT_COMPOSER_ENDED_PLACEHOLDER,
  CHAT_COMPOSER_LINE_HEIGHT_PX,
  CHAT_COMPOSER_MAX_ROWS,
  CHAT_COMPOSER_PLACEHOLDER,
  CHAT_COST_DECIMALS,
  CHAT_DROP_OVERLAY_BG,
  CHAT_DROP_OVERLAY_INSET_PX,
  CHAT_DURATION_DECIMALS,
  CHAT_MAX_ATTACHMENTS,
  CHAT_MAX_IMAGE_BYTES,
  CHAT_MAX_IMAGE_MB,
  CHAT_MODE_MENU_MIN_WIDTH_PX,
  CHAT_MS_PER_SEC,
  CHAT_NEAR_BOTTOM_PX,
} from '../../constants.js';
import { getElectronAPI, vscode } from '../../vscodeApi.js';
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

/** An image queued in the composer tray, ready to send with the next prompt. */
interface ChatAttachment {
  id: string;
  /** e.g. 'image/png' */
  mediaType: string;
  /** Base64 payload WITHOUT the data: prefix. */
  data: string;
  /** data: URL for the <img> thumbnail. */
  previewUrl: string;
}

/** Read a File as base64 (data: prefix stripped). */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

/** Quote a filesystem path with '…' if it contains spaces. */
function quotePath(path: string): string {
  return path.includes(' ') ? `'${path}'` : path;
}

/** True when a drag event carries OS files (not e.g. text selections). */
function dragHasFiles(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes('Files');
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

const errorCardStyle: React.CSSProperties = {
  fontSize: CHAT_BODY_FONT_SIZE_PX,
  color: 'var(--pixel-chat-red)',
  background: 'var(--pixel-chat-card-bg)',
  border: '2px solid var(--pixel-chat-red)',
  borderRadius: 0,
  boxShadow: 'var(--pixel-shadow)',
  padding: '6px 10px',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const errorHintStyle: React.CSSProperties = {
  marginTop: 6,
  color: 'var(--pixel-text)',
  fontSize: CHAT_BODY_FONT_SIZE_PX - 1,
};

const errorLinkStyle: React.CSSProperties = {
  color: 'var(--pixel-accent)',
  wordBreak: 'break-all',
};

/** Alternates text/URL thanks to the capturing group in split(). */
const URL_SPLIT_PATTERN = /(https?:\/\/[^\s]+)/;

/** Plain text with http(s) URLs rendered as links (opened externally). */
function TextWithLinks({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_SPLIT_PATTERN).map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} style={errorLinkStyle}>
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

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

const attachWarningStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: CHAT_BODY_FONT_SIZE_PX - 1,
  color: 'var(--pixel-chat-amber)',
  background: 'var(--pixel-bg)',
  borderTop: '2px solid var(--pixel-border)',
};

const attachTrayStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  padding: '8px 10px',
  background: 'var(--pixel-bg)',
  borderTop: '2px solid var(--pixel-border)',
};

const attachThumbWrapStyle: React.CSSProperties = {
  position: 'relative',
  width: CHAT_ATTACH_THUMB_PX,
  height: CHAT_ATTACH_THUMB_PX,
  flexShrink: 0,
};

const attachThumbImgStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
  boxSizing: 'border-box',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  background: 'var(--pixel-chat-code-bg)',
};

const attachRemoveBtnStyle: React.CSSProperties = {
  position: 'absolute',
  top: -6,
  right: -6,
  width: 16,
  height: 16,
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 9,
  lineHeight: 1,
  background: 'var(--pixel-bg)',
  color: 'var(--pixel-text)',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  cursor: 'pointer',
};

const dropOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: CHAT_DROP_OVERLAY_INSET_PX,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '2px dashed var(--pixel-accent)',
  borderRadius: 0,
  background: CHAT_DROP_OVERLAY_BG,
  color: 'var(--pixel-text)',
  fontSize: CHAT_BODY_FONT_SIZE_PX + 2,
  pointerEvents: 'none',
  zIndex: 'var(--pixel-controls-z)',
};

const userImageChipStyle: React.CSSProperties = {
  fontSize: CHAT_BODY_FONT_SIZE_PX - 2,
  color: 'var(--pixel-text-dim)',
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

interface ModeOption {
  mode: ChatPermissionMode;
  label: string;
  color: string;
}

const MODE_OPTIONS: ModeOption[] = [
  { mode: 'default', label: 'Ask', color: 'var(--pixel-text-dim)' },
  { mode: 'acceptEdits', label: 'Accept Edits', color: 'var(--pixel-chat-green)' },
  { mode: 'plan', label: 'Plan', color: 'var(--pixel-accent)' },
  { mode: 'bypassPermissions', label: 'Bypass', color: 'var(--pixel-chat-red)' },
];

const modeBtnStyle: React.CSSProperties = {
  padding: '5px 8px',
  fontSize: CHAT_BODY_FONT_SIZE_PX - 1,
  background: 'var(--pixel-btn-bg)',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  cursor: 'pointer',
  flexShrink: 0,
  whiteSpace: 'nowrap',
  lineHeight: `${CHAT_COMPOSER_LINE_HEIGHT_PX}px`,
};

const modeMenuStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: '100%',
  left: 0,
  marginBottom: 4,
  background: 'var(--pixel-bg)',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  boxShadow: 'var(--pixel-shadow)',
  minWidth: CHAT_MODE_MENU_MIN_WIDTH_PX,
  zIndex: 'var(--pixel-controls-z)',
};

const modeMenuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '5px 10px',
  fontSize: CHAT_BODY_FONT_SIZE_PX - 1,
  background: 'transparent',
  border: 'none',
  borderRadius: 0,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

/**
 * Compact permission-mode selector: a button showing the current mode that
 * opens an upward popup listing the four ChatPermissionModes.
 */
function ModeSelector({
  mode,
  onSelect,
}: {
  mode: ChatPermissionMode;
  onSelect: (mode: ChatPermissionMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<ChatPermissionMode | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close the popup on outside click
  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  const current = MODE_OPTIONS.find((o) => o.mode === mode) ?? MODE_OPTIONS[0];
  const isDefault = current.mode === 'default';

  return (
    <div ref={rootRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        style={{
          ...modeBtnStyle,
          color: isDefault ? 'var(--pixel-text-dim)' : current.color,
          border: isDefault ? modeBtnStyle.border : `2px solid ${current.color}`,
        }}
        onClick={() => setOpen((v) => !v)}
        title="Permission mode"
      >
        {current.label} {open ? '▾' : '▴'}
      </button>
      {open && (
        <div style={modeMenuStyle}>
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.mode}
              style={{
                ...modeMenuItemStyle,
                color: option.color,
                background:
                  option.mode === mode
                    ? 'var(--pixel-active-bg)'
                    : hovered === option.mode
                      ? 'var(--pixel-btn-hover-bg)'
                      : 'transparent',
              }}
              onClick={() => {
                setOpen(false);
                onSelect(option.mode);
              }}
              onMouseEnter={() => setHovered(option.mode)}
              onMouseLeave={() => setHovered(null)}
            >
              {option.mode === mode ? '▸ ' : ''}
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
    case 'user': {
      const imageCount = item.imageCount ?? 0;
      return (
        <div className="pixel-chat-body" style={userBubbleStyle}>
          {imageCount > 0 && (
            <div style={userImageChipStyle}>
              🖼 {imageCount} image{imageCount > 1 ? 's' : ''}
            </div>
          )}
          {item.text}
        </div>
      );
    }
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
        <div className="pixel-chat-body" style={errorCardStyle}>
          <div>{item.text}</div>
          {item.hint && (
            <div style={errorHintStyle}>
              <TextWithLinks text={item.hint} />
            </div>
          )}
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
  // Host is the source of truth ('chat-mode'); updated optimistically on click
  const [mode, setMode] = useState<ChatPermissionMode>('default');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachWarning, setAttachWarning] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const nearBottomRef = useRef(true);
  const replayedRef = useRef(false);
  const warningTimerRef = useRef<number | null>(null);
  const dragCounterRef = useRef(0);

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
      } else if (msg.type === 'chat-mode') {
        if (msg.agentId !== agentId) return;
        setMode(msg.mode);
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

  // ── Image attachments ──────────────────────────────────────

  // Transient warning line above the composer; auto-clears
  const showAttachWarning = useCallback((text: string) => {
    setAttachWarning(text);
    if (warningTimerRef.current !== null) {
      window.clearTimeout(warningTimerRef.current);
    }
    warningTimerRef.current = window.setTimeout(() => {
      setAttachWarning(null);
      warningTimerRef.current = null;
    }, CHAT_ATTACH_WARNING_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (warningTimerRef.current !== null) {
        window.clearTimeout(warningTimerRef.current);
      }
    };
  }, []);

  /** Validate + base64-encode image files into the attachment tray. */
  const addImageFiles = useCallback(
    async (files: File[]) => {
      let added = 0;
      for (const file of files) {
        if (!CHAT_ACCEPTED_IMAGE_TYPES.includes(file.type)) continue;
        if (file.size > CHAT_MAX_IMAGE_BYTES) {
          showAttachWarning(`"${file.name}" is too large (max ${CHAT_MAX_IMAGE_MB} MB per image)`);
          continue;
        }
        if (attachments.length + added >= CHAT_MAX_ATTACHMENTS) {
          showAttachWarning(`Up to ${CHAT_MAX_ATTACHMENTS} images per message`);
          break;
        }
        try {
          const data = await readFileAsBase64(file);
          const attachment: ChatAttachment = {
            id: crypto.randomUUID(),
            mediaType: file.type,
            data,
            previewUrl: `data:${file.type};base64,${data}`,
          };
          setAttachments((prev) =>
            prev.length >= CHAT_MAX_ATTACHMENTS ? prev : [...prev, attachment],
          );
          added++;
        } catch {
          showAttachWarning(`Could not read "${file.name}"`);
        }
      }
    },
    [attachments.length, showAttachWarning],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // Pasted images go to the tray; plain text paste keeps default behavior
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(e.clipboardData.items)
        .filter((item) => item.kind === 'file' && CHAT_ACCEPTED_IMAGE_TYPES.includes(item.type))
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null);
      if (files.length === 0) return;
      e.preventDefault();
      void addImageFiles(files);
    },
    [addImageFiles],
  );

  // ── Drag & drop (whole ChatView is the drop target) ────────

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    dragCounterRef.current++;
    setDragActive(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!dragHasFiles(e)) return;
    // Required to allow dropping (and stops Electron from navigating)
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!dragHasFiles(e)) return;
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setDragActive(false);

      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      const images = files.filter((f) => CHAT_ACCEPTED_IMAGE_TYPES.includes(f.type));
      if (images.length > 0) {
        void addImageFiles(images);
      }

      // Non-image files: insert their absolute paths so Claude can read them
      const paths = files
        .filter((f) => !CHAT_ACCEPTED_IMAGE_TYPES.includes(f.type))
        .map((f) => getElectronAPI()?.getPathForFile?.(f) ?? '')
        .filter((p) => p !== '')
        .map(quotePath);
      if (paths.length > 0) {
        setDraft((prev) => {
          const sep = prev === '' || prev.endsWith(' ') ? '' : ' ';
          return prev + sep + paths.join(' ');
        });
        textareaRef.current?.focus();
      }
    },
    [addImageFiles],
  );

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (text === '' && attachments.length === 0) return;
    // No local echo — the host sends 'user-text' as the single source of truth
    const images = attachments.map(({ mediaType, data }) => ({ mediaType, data }));
    if (images.length > 0) {
      vscode.postMessage({ type: 'chatSend', id: agentId, text, images });
    } else {
      vscode.postMessage({ type: 'chatSend', id: agentId, text });
    }
    setDraft('');
    setAttachments([]);
  }, [agentId, draft, attachments]);

  const handleStop = useCallback(() => {
    vscode.postMessage({ type: 'chatInterrupt', id: agentId });
  }, [agentId]);

  const handleModeSelect = useCallback(
    (next: ChatPermissionMode) => {
      setMode(next); // optimistic; the host echoes 'chat-mode' to reconcile
      vscode.postMessage({ type: 'chatSetPermissionMode', id: agentId, mode: next });
    },
    [agentId],
  );

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

  const ended = model.ended;
  const sendDisabled = ended || (draft.trim() === '' && attachments.length === 0);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: visible ? 'flex' : 'none',
        flexDirection: 'column',
        background: 'var(--pixel-bg)',
        position: 'relative',
      }}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragActive && <div style={dropOverlayStyle}>Drop files</div>}
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

      {attachWarning !== null && (
        <div className="pixel-chat-body" style={attachWarningStyle}>
          {attachWarning}
        </div>
      )}

      {attachments.length > 0 && (
        <div style={attachTrayStyle}>
          {attachments.map((attachment) => (
            <div key={attachment.id} style={attachThumbWrapStyle}>
              <img src={attachment.previewUrl} alt="attached image" style={attachThumbImgStyle} />
              <button
                style={attachRemoveBtnStyle}
                onClick={() => removeAttachment(attachment.id)}
                title="Remove image"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={composerRowStyle}>
        <ModeSelector mode={mode} onSelect={handleModeSelect} />
        <textarea
          ref={textareaRef}
          className="pixel-chat-body"
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={ended ? CHAT_COMPOSER_ENDED_PLACEHOLDER : CHAT_COMPOSER_PLACEHOLDER}
          disabled={ended}
          style={textareaStyle}
        />
        {busy && !ended ? (
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
