import { useCallback, useEffect, useRef, useState } from 'react';

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

export function TerminalPanel({ height, onTerminalCreated, onShowTerminal, onAllTabsClosed }: TerminalPanelProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const nextLabelRef = useRef(1);

  const handleClose = useCallback(
    (ptyId: string) => {
      const api = getElectronAPI();
      api?.ptyKill?.(ptyId);
      setTabs((prev) => {
        const next = prev.filter((t) => t.ptyId !== ptyId);
        if (next.length === 0) {
          onAllTabsClosed();
        }
        // Update active tab within the same state snapshot to avoid stale closure
        setActiveTab((prevActive) => {
          if (prevActive !== ptyId) return prevActive;
          return next.length > 0 ? next[next.length - 1].ptyId : null;
        });
        return next;
      });
    },
    [onAllTabsClosed],
  );

  useEffect(() => {
    const api = getElectronAPI();

    const handler = (e: MessageEvent) => {
      const msg = e.data;

      if (msg.type === 'pty-created') {
        const { ptyId, sessionId, cwd, shellOnly } = msg;
        const label = `Agent ${nextLabelRef.current++}`;

        setTabs((prev) => {
          if (prev.some((t) => t.ptyId === ptyId)) return prev;
          return [...prev, { ptyId, label, exited: false }];
        });
        setActiveTab(ptyId);
        onTerminalCreated();

        // Spawn PTY — either a plain shell (for existing agents) or claude with session
        const shell = navigator.platform.startsWith('Win')
          ? 'powershell.exe'
          : undefined; // Let main process pick default shell
        if (shellOnly) {
          // Open a plain shell in the agent's project directory
          api?.ptySpawn?.({
            id: ptyId,
            cmd: shell || '',
            args: [],
            cwd: cwd || '',
          });
        } else {
          api?.ptySpawn?.({
            id: ptyId,
            cmd: shell || '',
            args: ['-c', `claude --session-id ${sessionId}`],
            cwd: cwd || '',
          });
        }
      } else if (msg.type === 'pty-focus') {
        const { ptyId } = msg;
        if (ptyId) {
          setActiveTab(ptyId);
        }
        onShowTerminal();
      } else if (msg.type === 'pty-close-tab') {
        const { ptyId } = msg;
        setTabs((prev) => {
          const next = prev.filter((t) => t.ptyId !== ptyId);
          if (next.length === 0) {
            onAllTabsClosed();
          }
          return next;
        });
        setActiveTab((prev) => {
          if (prev !== ptyId) return prev;
          return null;
        });
      } else if (msg.type === 'pty-exit') {
        const { ptyId } = msg;
        setTabs((prev) =>
          prev.map((t) => (t.ptyId === ptyId ? { ...t, exited: true } : t)),
        );
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onTerminalCreated, onShowTerminal]);

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
          <TerminalInstance
            key={tab.ptyId}
            ptyId={tab.ptyId}
            visible={tab.ptyId === activeTab}
          />
        ))}
      </div>
    </div>
  );
}
