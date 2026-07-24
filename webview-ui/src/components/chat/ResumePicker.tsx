import { useEffect, useState } from 'react';

import type { ResumableSession } from '../../../../shared/protocol.js';
import {
  CHAT_BODY_FONT_SIZE_PX,
  CHAT_MS_PER_SEC,
  CHAT_RESUME_LIST_MAX_HEIGHT_PX,
  CHAT_RESUME_MODAL_WIDTH_PX,
  CHAT_RESUME_PREVIEW_MAX_LINES,
  HOURS_PER_DAY,
  MINUTES_PER_HOUR,
  SECONDS_PER_MINUTE,
} from '../../constants.js';
import { vscode } from '../../vscodeApi.js';

interface ResumePickerProps {
  folderPath: string;
  sessions: ResumableSession[];
  onClose: () => void;
}

/** "just now", "5m ago", "2h ago", "3d ago" — no deps. */
function formatRelativeTime(mtimeMs: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - mtimeMs) / CHAT_MS_PER_SEC));
  if (seconds < SECONDS_PER_MINUTE) return 'just now';
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  if (minutes < MINUTES_PER_HOUR) return `${minutes}m ago`;
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) return `${hours}h ago`;
  const days = Math.floor(hours / HOURS_PER_DAY);
  return `${days}d ago`;
}

function basename(path: string): string {
  const parts = path.split(/[/\\]/).filter((p) => p !== '');
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

const previewStyle: React.CSSProperties = {
  fontSize: CHAT_BODY_FONT_SIZE_PX,
  color: 'var(--pixel-text)',
  overflow: 'hidden',
  display: '-webkit-box',
  WebkitLineClamp: CHAT_RESUME_PREVIEW_MAX_LINES,
  WebkitBoxOrient: 'vertical',
  wordBreak: 'break-word',
};

const timeStyle: React.CSSProperties = {
  fontSize: CHAT_BODY_FONT_SIZE_PX - 1,
  color: 'var(--pixel-text-dim)',
  flexShrink: 0,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 10,
  width: '100%',
  textAlign: 'left',
  padding: '6px 10px',
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid var(--pixel-border)',
  borderRadius: 0,
  cursor: 'pointer',
};

/**
 * Centered pixel-styled modal listing past sessions of a folder; clicking a
 * row resumes that session as a new chat agent.
 */
export function ResumePicker({ folderPath, sessions, onClose }: ResumePickerProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  // Esc closes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleResume = (sessionId: string) => {
    vscode.postMessage({ type: 'resumeChatAgent', folderPath, sessionId });
    onClose();
  };

  return (
    <>
      {/* Dark backdrop — click to close */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 49,
        }}
      />
      {/* Centered modal */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 50,
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          borderRadius: 0,
          padding: '4px',
          boxShadow: 'var(--pixel-shadow)',
          width: CHAT_RESUME_MODAL_WIDTH_PX,
          maxWidth: '90vw',
        }}
      >
        {/* Header with title and X button */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '4px 10px',
            borderBottom: '1px solid var(--pixel-border)',
            marginBottom: '4px',
          }}
        >
          <span
            style={{
              fontSize: '24px',
              color: 'rgba(255, 255, 255, 0.9)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={folderPath}
          >
            Resume session — {basename(folderPath)}
          </span>
          <button
            onClick={onClose}
            onMouseEnter={() => setHovered('close')}
            onMouseLeave={() => setHovered(null)}
            style={{
              background: hovered === 'close' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
              border: 'none',
              borderRadius: 0,
              color: 'rgba(255, 255, 255, 0.6)',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            X
          </button>
        </div>
        {/* Session list */}
        <div style={{ maxHeight: CHAT_RESUME_LIST_MAX_HEIGHT_PX, overflowY: 'auto' }}>
          {sessions.length === 0 ? (
            <div
              className="pixel-chat-body"
              style={{
                padding: '10px',
                fontSize: CHAT_BODY_FONT_SIZE_PX,
                color: 'var(--pixel-text-dim)',
              }}
            >
              No past sessions in this folder
            </div>
          ) : (
            sessions.map((session) => (
              <button
                key={session.sessionId}
                className="pixel-chat-body"
                onClick={() => handleResume(session.sessionId)}
                onMouseEnter={() => setHovered(session.sessionId)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  ...rowStyle,
                  background:
                    hovered === session.sessionId ? 'var(--pixel-btn-hover-bg)' : 'transparent',
                }}
              >
                <span style={previewStyle}>{session.preview}</span>
                <span style={timeStyle}>{formatRelativeTime(session.mtimeMs)}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}
