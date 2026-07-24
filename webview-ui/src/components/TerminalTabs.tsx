export interface TerminalTab {
  ptyId: string;
  label: string;
  exited: boolean;
}

interface TerminalTabsProps {
  tabs: TerminalTab[];
  activeTab: string | null;
  onSelect: (ptyId: string) => void;
  onClose: (ptyId: string) => void;
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

export function TerminalTabs({ tabs, activeTab, onSelect, onClose }: TerminalTabsProps) {
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
          key={tab.ptyId}
          style={tab.ptyId === activeTab ? activeTabStyle : tabStyle}
          onClick={() => onSelect(tab.ptyId)}
        >
          <span style={{ opacity: tab.exited ? 0.5 : 1 }}>
            {tab.label}
          </span>
          <button
            style={closeButtonStyle}
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab.ptyId);
            }}
            title="Close terminal"
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}
