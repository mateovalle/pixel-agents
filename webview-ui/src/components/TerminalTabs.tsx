/** A tab in the bottom panel: an xterm terminal or an SDK-driven chat view. */
export type PanelTab =
  | { kind: 'terminal'; key: string; ptyId: string; label: string; exited: boolean }
  | { kind: 'chat'; key: string; agentId: number; label: string };

interface TerminalTabsProps {
  tabs: PanelTab[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  onClose: (tab: PanelTab) => void;
}

const tabStyle: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: '20px',
  background: 'var(--pixel-bg)',
  color: 'var(--pixel-text-dim)',
  border: '2px solid var(--pixel-border)',
  borderBottom: 'none',
  borderRadius: 0,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  whiteSpace: 'nowrap',
};

const activeTabStyle: React.CSSProperties = {
  ...tabStyle,
  background: '#2a2a3e',
  color: 'var(--pixel-text)',
  borderBottomColor: 'transparent',
};

const closeButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--pixel-text-dim)',
  cursor: 'pointer',
  fontSize: '18px',
  padding: '0 2px',
  lineHeight: 1,
  borderRadius: 0,
};

const chatMarkerStyle: React.CSSProperties = {
  color: 'var(--pixel-chat-green)',
  fontSize: '16px',
  lineHeight: 1,
};

export function TerminalTabs({ tabs, activeKey, onSelect, onClose }: TerminalTabsProps) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 0,
        overflowX: 'auto',
        background: 'var(--pixel-bg)',
        borderBottom: '2px solid var(--pixel-border)',
        minHeight: 30,
        alignItems: 'flex-end',
      }}
    >
      {tabs.map((tab) => (
        <div
          key={tab.key}
          style={tab.key === activeKey ? activeTabStyle : tabStyle}
          onClick={() => onSelect(tab.key)}
        >
          {tab.kind === 'chat' && (
            <span style={chatMarkerStyle} title="Chat agent">
              ❯
            </span>
          )}
          <span style={{ opacity: tab.kind === 'terminal' && tab.exited ? 0.5 : 1 }}>
            {tab.label}
          </span>
          <button
            style={closeButtonStyle}
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab);
            }}
            title={tab.kind === 'chat' ? 'Close chat agent' : 'Close terminal'}
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}
