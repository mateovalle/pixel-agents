import { useCallback, useEffect, useState } from 'react';

import type { HostToWebviewMessage } from '../../../shared/protocol.js';
import { getElectronAPI, vscode } from '../vscodeApi.js';
import { ChatView } from './chat/ChatView.js';
import { TerminalInstance } from './TerminalInstance.js';
import type { PanelTab } from './TerminalTabs.js';
import { TerminalTabs } from './TerminalTabs.js';

interface TerminalPanelProps {
  height: number;
  onTerminalCreated: () => void;
  onShowTerminal: () => void;
  onAllTabsClosed: () => void;
}

const ptyKey = (ptyId: string) => `pty:${ptyId}`;
const chatKey = (agentId: number) => `chat:${agentId}`;

export function TerminalPanel({
  height,
  onTerminalCreated,
  onShowTerminal,
  onAllTabsClosed,
}: TerminalPanelProps) {
  const [tabs, setTabs] = useState<PanelTab[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // Notify closure outside the setState updater (updaters must stay pure)
  useEffect(() => {
    if (tabs.length === 0) {
      onAllTabsClosed();
    }
  }, [tabs.length, onAllTabsClosed]);

  const removeTab = useCallback((key: string) => {
    setTabs((prev) => prev.filter((t) => t.key !== key));
    setActiveKey((prevActive) => (prevActive === key ? null : prevActive));
  }, []);

  const handleClose = useCallback(
    (tab: PanelTab) => {
      if (tab.kind === 'terminal') {
        getElectronAPI()?.ptyKill?.(tab.ptyId);
        removeTab(tab.key);
      } else {
        // The host kills the session and sends chat-close-tab + agentClosed
        vscode.postMessage({ type: 'closeAgent', id: tab.agentId });
      }
    },
    [removeTab],
  );

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data as HostToWebviewMessage;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'pty-created') {
        // The PTY is spawned by the main process; the renderer only shows it.
        const { ptyId, label } = msg;
        const key = ptyKey(ptyId);
        setTabs((prev) => {
          if (prev.some((t) => t.key === key)) return prev;
          return [...prev, { kind: 'terminal', key, ptyId, label, exited: false }];
        });
        setActiveKey(key);
        onTerminalCreated();
      } else if (msg.type === 'pty-focus') {
        const { ptyId } = msg;
        if (ptyId) {
          setActiveKey(ptyKey(ptyId));
        }
        onShowTerminal();
      } else if (msg.type === 'pty-close-tab') {
        removeTab(ptyKey(msg.ptyId));
      } else if (msg.type === 'pty-exit') {
        const { ptyId } = msg;
        setTabs((prev) =>
          prev.map((t) =>
            t.kind === 'terminal' && t.ptyId === ptyId ? { ...t, exited: true } : t,
          ),
        );
      } else if (msg.type === 'chat-created') {
        const { agentId, label } = msg;
        const key = chatKey(agentId);
        setTabs((prev) => {
          if (prev.some((t) => t.key === key)) return prev;
          return [...prev, { kind: 'chat', key, agentId, label }];
        });
        setActiveKey(key);
        onTerminalCreated();
      } else if (msg.type === 'chat-focus') {
        setActiveKey(chatKey(msg.agentId));
        onShowTerminal();
      } else if (msg.type === 'chat-close-tab') {
        removeTab(chatKey(msg.agentId));
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onTerminalCreated, onShowTerminal, removeTab]);

  const shouldShow = tabs.length > 0 && height > 0;

  // Always render (to keep message listener alive), but hide when nothing to show.
  // All tabs stay mounted (display:none) so chat scroll state and terminal
  // scrollback survive tab switches.
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
        activeKey={activeKey}
        onSelect={setActiveKey}
        onClose={handleClose}
      />
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {tabs.map((tab) =>
          tab.kind === 'terminal' ? (
            <TerminalInstance key={tab.key} ptyId={tab.ptyId} visible={tab.key === activeKey} />
          ) : (
            <ChatView key={tab.key} agentId={tab.agentId} visible={tab.key === activeKey} />
          ),
        )}
      </div>
    </div>
  );
}
