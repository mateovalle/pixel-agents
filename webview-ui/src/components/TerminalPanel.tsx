import { useCallback, useEffect, useState } from 'react';

import { getElectronAPI } from '../vscodeApi.js';
import { TerminalInstance } from './TerminalInstance.js';
import type { TerminalTab } from './TerminalTabs.js';
import { TerminalTabs } from './TerminalTabs.js';

interface TerminalPanelProps {
  height: number;
  onTerminalCreated: () => void;
  onShowTerminal: () => void;
  onAllTabsClosed: () => void;
}

export function TerminalPanel({
  height,
  onTerminalCreated,
  onShowTerminal,
  onAllTabsClosed,
}: TerminalPanelProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);

  // Notify closure outside the setState updater (updaters must stay pure)
  useEffect(() => {
    if (tabs.length === 0) {
      onAllTabsClosed();
    }
  }, [tabs.length, onAllTabsClosed]);

  const closeTab = useCallback((ptyId: string) => {
    setTabs((prev) => prev.filter((t) => t.ptyId !== ptyId));
    setActiveTab((prevActive) => (prevActive === ptyId ? null : prevActive));
  }, []);

  const handleClose = useCallback(
    (ptyId: string) => {
      getElectronAPI()?.ptyKill?.(ptyId);
      closeTab(ptyId);
    },
    [closeTab],
  );

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data;

      if (msg.type === 'pty-created') {
        // The PTY is spawned by the main process; the renderer only shows it.
        const { ptyId, label } = msg;
        setTabs((prev) => {
          if (prev.some((t) => t.ptyId === ptyId)) return prev;
          return [...prev, { ptyId, label, exited: false }];
        });
        setActiveTab(ptyId);
        onTerminalCreated();
      } else if (msg.type === 'pty-focus') {
        const { ptyId } = msg;
        if (ptyId) {
          setActiveTab(ptyId);
        }
        onShowTerminal();
      } else if (msg.type === 'pty-close-tab') {
        closeTab(msg.ptyId);
      } else if (msg.type === 'pty-exit') {
        const { ptyId } = msg;
        setTabs((prev) => prev.map((t) => (t.ptyId === ptyId ? { ...t, exited: true } : t)));
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onTerminalCreated, onShowTerminal, closeTab]);

  const shouldShow = tabs.length > 0 && height > 0;

  // Always render (to keep message listener alive), but hide when nothing to show
  return (
    <div
      style={{
        height: shouldShow ? height : 0,
        display: shouldShow ? 'flex' : 'none',
        flexDirection: 'column',
        background: '#1e1e2e',
        flexShrink: 0,
      }}
    >
      <TerminalTabs
        tabs={tabs}
        activeTab={activeTab}
        onSelect={setActiveTab}
        onClose={handleClose}
      />
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {tabs.map((tab) => (
          <TerminalInstance key={tab.ptyId} ptyId={tab.ptyId} visible={tab.ptyId === activeTab} />
        ))}
      </div>
    </div>
  );
}
