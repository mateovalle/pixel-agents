import { useState } from 'react';

import {
  CHAT_BODY_FONT_SIZE_PX,
  CHAT_CODE_FONT_SIZE_PX,
  CHAT_DOT_STAGGER_SEC,
  CHAT_JSON_PREVIEW_MAX_CHARS,
  CHAT_RESULT_MAX_HEIGHT_PX,
  CHAT_WRITE_PREVIEW_MAX_CHARS,
} from '../../constants.js';
import type { ToolCallStatus } from './chatModel.js';
import { summarizeToolInput, truncateChars } from './chatModel.js';

interface ToolCardProps {
  name: string;
  input: Record<string, unknown>;
  status: ToolCallStatus;
  resultSummary: string | null;
}

const cardStyle: React.CSSProperties = {
  border: '2px solid var(--pixel-border)',
  background: 'var(--pixel-chat-card-bg)',
  borderRadius: 0,
  margin: '4px 0',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '3px 8px',
  cursor: 'pointer',
  userSelect: 'none',
  minWidth: 0,
};

const nameStyle: React.CSSProperties = {
  fontSize: CHAT_CODE_FONT_SIZE_PX,
  fontWeight: 700,
  color: 'var(--pixel-text)',
  flexShrink: 0,
};

const summaryStyle: React.CSSProperties = {
  fontSize: CHAT_BODY_FONT_SIZE_PX,
  color: 'var(--pixel-text-dim)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  flex: 1,
  minWidth: 0,
};

const glyphStyle: React.CSSProperties = {
  fontSize: CHAT_BODY_FONT_SIZE_PX,
  flexShrink: 0,
  width: 14,
  textAlign: 'center',
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--pixel-text-dim)',
  padding: '3px 8px 0',
  textTransform: 'uppercase',
  letterSpacing: 1,
};

const preStyle: React.CSSProperties = {
  margin: '3px 8px 8px',
  padding: '6px 8px',
  fontSize: CHAT_CODE_FONT_SIZE_PX,
  lineHeight: 1.45,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: CHAT_RESULT_MAX_HEIGHT_PX,
  overflowY: 'auto',
  background: 'var(--pixel-chat-code-bg)',
  border: '1px solid var(--pixel-border)',
  color: 'var(--pixel-text)',
};

const diffContainerStyle: React.CSSProperties = {
  margin: '3px 8px 8px',
  border: '1px solid var(--pixel-border)',
  background: 'var(--pixel-chat-code-bg)',
  maxHeight: CHAT_RESULT_MAX_HEIGHT_PX,
  overflowY: 'auto',
};

const diffLineStyle: React.CSSProperties = {
  fontSize: CHAT_CODE_FONT_SIZE_PX,
  lineHeight: 1.45,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  padding: '0 6px',
};

const diffOldStyle: React.CSSProperties = {
  ...diffLineStyle,
  background: 'var(--pixel-chat-diff-old-bg)',
  color: 'var(--pixel-chat-red)',
};

const diffNewStyle: React.CSSProperties = {
  ...diffLineStyle,
  background: 'var(--pixel-chat-diff-new-bg)',
  color: 'var(--pixel-chat-green)',
};

function RunningDots() {
  return (
    <span style={{ color: 'var(--pixel-chat-amber)', letterSpacing: 1 }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="pixel-chat-dot"
          style={{ animationDelay: `${i * CHAT_DOT_STAGGER_SEC}s` }}
        >
          .
        </span>
      ))}
    </span>
  );
}

function StatusGlyph({ status }: { status: ToolCallStatus }) {
  if (status === 'running') {
    return (
      <span style={glyphStyle}>
        <RunningDots />
      </span>
    );
  }
  if (status === 'error') {
    return <span style={{ ...glyphStyle, color: 'var(--pixel-chat-red)' }}>✗</span>;
  }
  return <span style={{ ...glyphStyle, color: 'var(--pixel-chat-green)' }}>✓</span>;
}

/** Simple full-block diff: all old lines as '-', all new lines as '+'. */
function DiffBlock({ oldText, newText }: { oldText: string; newText: string }) {
  return (
    <div style={diffContainerStyle}>
      {oldText.split('\n').map((line, i) => (
        <div key={`o${i}`} style={diffOldStyle}>
          - {line}
        </div>
      ))}
      {newText.split('\n').map((line, i) => (
        <div key={`n${i}`} style={diffNewStyle}>
          + {line}
        </div>
      ))}
    </div>
  );
}

function stringField(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  return typeof value === 'string' ? value : null;
}

function prettyJson(input: Record<string, unknown>): string {
  try {
    return truncateChars(JSON.stringify(input, null, 2) ?? '', CHAT_JSON_PREVIEW_MAX_CHARS);
  } catch {
    return String(input);
  }
}

function ExpandedBody({ name, input, resultSummary }: Omit<ToolCardProps, 'status'>) {
  const oldString = stringField(input, 'old_string');
  const newString = stringField(input, 'new_string');
  const isEditDiff = oldString !== null && newString !== null;

  let inputSection: React.ReactNode;
  if (isEditDiff) {
    inputSection = <DiffBlock oldText={oldString} newText={newString} />;
  } else if (name === 'Write' && stringField(input, 'content') !== null) {
    inputSection = (
      <pre className="pixel-chat-mono" style={preStyle}>
        {truncateChars(stringField(input, 'content') ?? '', CHAT_WRITE_PREVIEW_MAX_CHARS)}
      </pre>
    );
  } else if (name === 'Bash' && stringField(input, 'command') !== null) {
    inputSection = (
      <pre className="pixel-chat-mono" style={preStyle}>
        {stringField(input, 'command')}
      </pre>
    );
  } else {
    inputSection = (
      <pre className="pixel-chat-mono" style={preStyle}>
        {prettyJson(input)}
      </pre>
    );
  }

  return (
    <div style={{ borderTop: '1px solid var(--pixel-border)' }}>
      {inputSection}
      {resultSummary !== null && (
        <>
          <div style={sectionLabelStyle}>Result</div>
          <pre className="pixel-chat-mono" style={preStyle}>
            {resultSummary}
          </pre>
        </>
      )}
    </div>
  );
}

export function ToolCard({ name, input, status, resultSummary }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeToolInput(name, input);

  return (
    <div style={cardStyle} className="pixel-chat-body">
      <div style={headerStyle} onClick={() => setExpanded((v) => !v)}>
        <StatusGlyph status={status} />
        <span className="pixel-chat-mono" style={nameStyle}>
          {name}
        </span>
        {summary !== '' && <span style={summaryStyle}>{summary}</span>}
        <span style={{ color: 'var(--pixel-text-dim)', fontSize: 10, flexShrink: 0 }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>
      {expanded && <ExpandedBody name={name} input={input} resultSummary={resultSummary} />}
    </div>
  );
}
