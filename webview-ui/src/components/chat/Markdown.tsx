import { useState } from 'react';

import {
  CHAT_BODY_FONT_SIZE_PX,
  CHAT_CODE_FONT_SIZE_PX,
  CHAT_COPY_FEEDBACK_MS,
} from '../../constants.js';

const paragraphStyle: React.CSSProperties = {
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: CHAT_BODY_FONT_SIZE_PX,
  lineHeight: 1.5,
  margin: '6px 0',
};

const headingFontSizes: Record<number, number> = { 1: 17, 2: 15, 3: 14 };

function headingStyle(level: number): React.CSSProperties {
  return {
    fontSize: headingFontSizes[level] ?? CHAT_BODY_FONT_SIZE_PX,
    fontWeight: 700,
    margin: '10px 0 4px',
    lineHeight: 1.4,
  };
}

const inlineCodeStyle: React.CSSProperties = {
  fontSize: CHAT_CODE_FONT_SIZE_PX,
  background: 'var(--pixel-chat-code-bg)',
  border: '1px solid var(--pixel-border)',
  padding: '0 3px',
  borderRadius: 0,
};

const linkStyle: React.CSSProperties = {
  color: 'var(--pixel-accent)',
  textDecoration: 'underline',
  textDecorationStyle: 'dotted',
  cursor: 'pointer',
};

const blockquoteStyle: React.CSSProperties = {
  ...paragraphStyle,
  borderLeft: '3px solid var(--pixel-border-light)',
  padding: '2px 10px',
  color: 'var(--pixel-text-dim)',
};

const hrStyle: React.CSSProperties = {
  border: 'none',
  borderTop: '2px solid var(--pixel-border)',
  margin: '10px 0',
};

const listStyle: React.CSSProperties = {
  margin: '6px 0',
  paddingLeft: 22,
  fontSize: CHAT_BODY_FONT_SIZE_PX,
  lineHeight: 1.5,
};

const listItemStyle: React.CSSProperties = {
  wordBreak: 'break-word',
};

const codeBlockStyle: React.CSSProperties = {
  border: '2px solid var(--pixel-border)',
  background: 'var(--pixel-chat-code-bg)',
  borderRadius: 0,
  margin: '6px 0',
};

const codeHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '2px 6px',
  borderBottom: '1px solid var(--pixel-border)',
};

const codePreStyle: React.CSSProperties = {
  margin: 0,
  padding: '6px 8px',
  fontSize: CHAT_CODE_FONT_SIZE_PX,
  lineHeight: 1.45,
  whiteSpace: 'pre',
  overflowX: 'auto',
  color: 'var(--pixel-text)',
};

const copyBtnStyle: React.CSSProperties = {
  background: 'var(--pixel-btn-bg)',
  color: 'var(--pixel-text-dim)',
  border: '1px solid var(--pixel-border)',
  borderRadius: 0,
  cursor: 'pointer',
  fontSize: 11,
  padding: '1px 6px',
};

function copyToClipboard(text: string): void {
  try {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  } catch {
    // clipboard unavailable — ignore
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      style={copyBtnStyle}
      onClick={() => {
        copyToClipboard(text);
        setCopied(true);
        setTimeout(() => setCopied(false), CHAT_COPY_FEEDBACK_MS);
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  return (
    <div style={codeBlockStyle}>
      <div style={codeHeaderStyle}>
        <span style={{ color: 'var(--pixel-text-dim)', fontSize: 10 }}>{lang || 'code'}</span>
        <CopyButton text={code} />
      </div>
      <pre className="pixel-chat-mono" style={codePreStyle}>
        {code}
      </pre>
    </div>
  );
}

// Inline tokens: `code`, **bold**, *italic*, [text](url) — tried in order
const INLINE_TOKEN_RE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]*\]\([^()\s]+\))/;
const LINK_RE = /^\[([^\]]*)\]\(([^()\s]+)\)$/;

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let rest = text;
  let k = 0;
  while (rest.length > 0) {
    const m = INLINE_TOKEN_RE.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const tok = m[0];
    const key = `${keyBase}i${k++}`;
    if (m[1]) {
      out.push(
        <code key={key} className="pixel-chat-mono" style={inlineCodeStyle}>
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      out.push(<strong key={key}>{renderInline(tok.slice(2, -2), key)}</strong>);
    } else if (m[3]) {
      out.push(<em key={key}>{renderInline(tok.slice(1, -1), key)}</em>);
    } else {
      const link = LINK_RE.exec(tok);
      if (link) {
        // Navigation is blocked in the webview — clicking copies the url
        const url = link[2];
        out.push(
          <span key={key} style={linkStyle} title={url} onClick={() => copyToClipboard(url)}>
            {link[1] || url}
          </span>,
        );
      } else {
        out.push(tok);
      }
    }
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

function parseBlocks(src: string): React.ReactNode[] {
  const lines = src.split('\n');
  const out: React.ReactNode[] = [];
  let para: string[] = [];
  let key = 0;
  const nextKey = () => `b${key++}`;

  const flushPara = () => {
    if (para.length === 0) return;
    const k = nextKey();
    out.push(
      <div key={k} style={paragraphStyle}>
        {renderInline(para.join('\n'), k)}
      </div>,
    );
    para = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      flushPara();
      const lang = line.slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing fence (or run past end for unterminated blocks)
      out.push(<CodeBlock key={nextKey()} lang={lang} code={buf.join('\n')} />);
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      const k = nextKey();
      out.push(
        <div key={k} style={headingStyle(heading[1].length)}>
          {renderInline(heading[2], k)}
        </div>,
      );
      i++;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara();
      out.push(<div key={nextKey()} style={hrStyle} />);
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushPara();
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      const k = nextKey();
      out.push(
        <div key={k} style={blockquoteStyle}>
          {renderInline(buf.join('\n'), k)}
        </div>,
      );
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      const k = nextKey();
      out.push(
        <ul key={k} style={listStyle}>
          {items.map((item, j) => (
            <li key={j} style={listItemStyle}>
              {renderInline(item, `${k}-${j}`)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
        i++;
      }
      const k = nextKey();
      out.push(
        <ol key={k} style={listStyle}>
          {items.map((item, j) => (
            <li key={j} style={listItemStyle}>
              {renderInline(item, `${k}-${j}`)}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    if (line.trim() === '') {
      flushPara();
      i++;
      continue;
    }

    para.push(line);
    i++;
  }
  flushPara();
  return out;
}

/**
 * Minimal, safe markdown renderer. Produces React elements directly (no HTML
 * parsing, no dangerouslySetInnerHTML) and never throws — malformed input
 * falls back to plain text.
 */
export function Markdown({ text }: { text: string }) {
  let nodes: React.ReactNode[];
  try {
    nodes = parseBlocks(text);
  } catch {
    nodes = [
      <div key="fallback" style={paragraphStyle}>
        {text}
      </div>,
    ];
  }
  return <div className="pixel-chat-body">{nodes}</div>;
}
