import { useState } from 'react';

import { CHAT_BODY_FONT_SIZE_PX, CHAT_CODE_FONT_SIZE_PX } from '../../constants.js';
import { summarizeToolInput } from './chatModel.js';

/** A pending chat-permission-request, tracked by ChatView. */
export interface PermissionRequestInfo {
  requestId: string;
  toolName: string;
  title?: string;
  description?: string;
  input: Record<string, unknown>;
}

interface PermissionCardProps {
  request: PermissionRequestInfo;
  onRespond: (requestId: string, allow: boolean, message?: string) => void;
}

const cardStyle: React.CSSProperties = {
  border: '2px solid var(--pixel-chat-amber)',
  background: 'var(--pixel-chat-permission-bg)',
  borderRadius: 0,
  boxShadow: 'var(--pixel-shadow)',
  padding: '8px 10px',
  margin: '4px 8px',
};

const titleStyle: React.CSSProperties = {
  fontSize: CHAT_BODY_FONT_SIZE_PX,
  fontWeight: 700,
  color: 'var(--pixel-chat-amber)',
};

const descriptionStyle: React.CSSProperties = {
  fontSize: CHAT_BODY_FONT_SIZE_PX,
  color: 'var(--pixel-text-dim)',
  marginTop: 3,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const previewStyle: React.CSSProperties = {
  fontSize: CHAT_CODE_FONT_SIZE_PX,
  color: 'var(--pixel-text)',
  background: 'var(--pixel-chat-code-bg)',
  border: '1px solid var(--pixel-border)',
  padding: '3px 6px',
  marginTop: 6,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const btnBase: React.CSSProperties = {
  padding: '3px 12px',
  fontSize: '20px',
  borderRadius: 0,
  cursor: 'pointer',
  color: 'var(--pixel-text)',
};

const allowBtnStyle: React.CSSProperties = {
  ...btnBase,
  background: 'var(--pixel-agent-bg)',
  border: '2px solid var(--pixel-agent-border)',
  color: 'var(--pixel-agent-text)',
};

const denyBtnStyle: React.CSSProperties = {
  ...btnBase,
  background: 'rgba(243, 139, 168, 0.12)',
  border: '2px solid var(--pixel-chat-red)',
  color: 'var(--pixel-chat-red)',
};

const feedbackInputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: CHAT_BODY_FONT_SIZE_PX,
  background: 'var(--pixel-chat-code-bg)',
  color: 'var(--pixel-text)',
  border: '1px solid var(--pixel-border)',
  borderRadius: 0,
  padding: '3px 6px',
  outline: 'none',
};

export function PermissionCard({ request, onRespond }: PermissionCardProps) {
  const [feedback, setFeedback] = useState('');
  const summary = summarizeToolInput(request.toolName, request.input);

  const deny = () => onRespond(request.requestId, false, feedback.trim() || undefined);

  return (
    <div style={cardStyle} className="pixel-chat-body">
      <div style={titleStyle}>{request.title || `Allow ${request.toolName}?`}</div>
      {request.description && <div style={descriptionStyle}>{request.description}</div>}
      <div className="pixel-chat-mono" style={previewStyle}>
        {request.toolName}
        {summary !== '' && summary !== request.toolName ? ` · ${summary}` : ''}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
        <button style={allowBtnStyle} onClick={() => onRespond(request.requestId, true)}>
          Allow
        </button>
        <button style={denyBtnStyle} onClick={deny}>
          Deny
        </button>
        <input
          style={feedbackInputStyle}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && feedback.trim() !== '') {
              e.preventDefault();
              deny();
            }
          }}
          placeholder="tell Claude what to do instead (sends Deny)"
        />
      </div>
    </div>
  );
}
