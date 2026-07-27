import { useEffect, useState } from 'react';

import type { HostToWebviewMessage, UsageSummary } from '../../../shared/protocol.js';
import {
  USAGE_CHART_BAR_DIM_COLOR,
  USAGE_CHART_BAR_GAP_PX,
  USAGE_CHART_BAR_MIN_HEIGHT_PX,
  USAGE_CHART_HEIGHT_PX,
  USAGE_CHART_LABEL_COLOR,
  USAGE_CHART_LABEL_FONT_PX,
  USAGE_CHART_ZERO_BAR_COLOR,
} from '../constants.js';
import { isSoundEnabled, setSoundEnabled } from '../notificationSound.js';
import { formatUsd } from '../office/toolUtils.js';
import { vscode } from '../vscodeApi.js';

const usageRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 16,
  padding: '1px 10px',
  fontSize: '18px',
  color: 'rgba(255, 255, 255, 0.7)',
};

/** Compact 14-day spend bar chart — pure divs, pixel aesthetic (sharp corners). */
function DailyBarChart({ days }: { days: UsageSummary['days'] }) {
  const max = Math.max(0, ...days.map((d) => d.usd));
  if (days.length === 0 || max <= 0) return null;

  return (
    <div style={{ padding: '4px 10px 0' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: USAGE_CHART_BAR_GAP_PX,
          height: USAGE_CHART_HEIGHT_PX,
          borderBottom: '1px solid var(--pixel-border)',
        }}
      >
        {days.map((d, i) => {
          const isToday = i === days.length - 1;
          const barH =
            d.usd > 0
              ? Math.max(
                  USAGE_CHART_BAR_MIN_HEIGHT_PX,
                  Math.round((d.usd / max) * USAGE_CHART_HEIGHT_PX),
                )
              : USAGE_CHART_BAR_MIN_HEIGHT_PX;
          return (
            // Full-height hover target so tooltips work on short bars too
            <div
              key={`${d.day}-${i}`}
              title={`${d.day} · $${d.usd.toFixed(2)}`}
              style={{
                flex: 1,
                height: '100%',
                display: 'flex',
                alignItems: 'flex-end',
                cursor: 'default',
              }}
            >
              <div
                style={{
                  width: '100%',
                  height: barH,
                  borderRadius: 0,
                  background: isToday
                    ? 'var(--pixel-accent)'
                    : d.usd > 0
                      ? USAGE_CHART_BAR_DIM_COLOR
                      : USAGE_CHART_ZERO_BAR_COLOR,
                }}
              />
            </div>
          );
        })}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: USAGE_CHART_LABEL_FONT_PX,
          color: USAGE_CHART_LABEL_COLOR,
          marginTop: 2,
        }}
      >
        <span>{days[0].day}</span>
        <span>{days[days.length - 1].day}</span>
      </div>
    </div>
  );
}

function UsageSection({ liveSummary }: { liveSummary: UsageSummary | null }) {
  // Fallback: request a summary on open and listen for the reply, in case the
  // live push hasn't arrived yet (e.g., host older than the push behavior)
  const [fetched, setFetched] = useState<UsageSummary | null>(null);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data as HostToWebviewMessage;
      if (msg.type === 'usageSummary') {
        setFetched(msg.summary);
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'getUsageSummary' });
    return () => window.removeEventListener('message', handler);
  }, []);

  const summary = liveSummary ?? fetched;
  if (!summary || summary.turnCount === 0) return null;

  return (
    <div style={{ borderTop: '1px solid var(--pixel-border)', marginTop: 4, paddingTop: 4 }}>
      <div style={{ ...usageRowStyle, color: 'rgba(255, 255, 255, 0.9)', fontSize: '20px' }}>
        <span>Chat Usage</span>
      </div>
      <DailyBarChart days={summary.days} />
      <div style={usageRowStyle}>
        <span>Today</span>
        <span>{formatUsd(summary.todayUsd)}</span>
      </div>
      <div style={usageRowStyle}>
        <span>This month</span>
        <span>{formatUsd(summary.monthUsd)}</span>
      </div>
      <div style={usageRowStyle}>
        <span>All time</span>
        <span>{formatUsd(summary.allTimeUsd)}</span>
      </div>
      {summary.perProject.length > 0 && (
        <div style={{ marginTop: 3 }}>
          {summary.perProject.map((p) => (
            <div key={p.path} style={{ ...usageRowStyle, fontSize: '16px' }} title={p.path}>
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 180,
                }}
              >
                {p.folder}
              </span>
              <span style={{ flexShrink: 0 }}>
                {formatUsd(p.monthUsd)} <span style={{ opacity: 0.5 }}>/ mo</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDebugMode: boolean;
  onToggleDebugMode: () => void;
  /** Live usage summary from useExtensionMessages (null until first push). */
  usageSummary: UsageSummary | null;
}

const menuItemBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  padding: '6px 10px',
  fontSize: '24px',
  color: 'rgba(255, 255, 255, 0.8)',
  background: 'transparent',
  border: 'none',
  borderRadius: 0,
  cursor: 'pointer',
  textAlign: 'left',
};

export function SettingsModal({
  isOpen,
  onClose,
  isDebugMode,
  onToggleDebugMode,
  usageSummary,
}: SettingsModalProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  // Bump to re-render after toggling sound (source of truth lives in notificationSound)
  const [, setSoundTick] = useState(0);

  if (!isOpen) return null;

  // Read the current setting on every open render so it stays in sync with
  // external changes (e.g., settingsLoaded from the extension after mount)
  const soundOn = isSoundEnabled();

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
          minWidth: 200,
        }}
      >
        {/* Header with title and X button */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 10px',
            borderBottom: '1px solid var(--pixel-border)',
            marginBottom: '4px',
          }}
        >
          <span style={{ fontSize: '24px', color: 'rgba(255, 255, 255, 0.9)' }}>Settings</span>
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
            }}
          >
            X
          </button>
        </div>
        {/* Menu items */}
        <button
          onClick={() => {
            vscode.postMessage({ type: 'openSessionsFolder' });
            onClose();
          }}
          onMouseEnter={() => setHovered('sessions')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'sessions' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          Open Sessions Folder
        </button>
        <button
          onClick={() => {
            vscode.postMessage({ type: 'exportLayout' });
            onClose();
          }}
          onMouseEnter={() => setHovered('export')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'export' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          Export Layout
        </button>
        <button
          onClick={() => {
            vscode.postMessage({ type: 'importLayout' });
            onClose();
          }}
          onMouseEnter={() => setHovered('import')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'import' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          Import Layout
        </button>
        <button
          onClick={() => {
            const newVal = !isSoundEnabled();
            setSoundEnabled(newVal);
            setSoundTick((n) => n + 1);
            vscode.postMessage({ type: 'setSoundEnabled', enabled: newVal });
          }}
          onMouseEnter={() => setHovered('sound')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'sound' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          <span>Sound Notifications</span>
          <span
            style={{
              width: 14,
              height: 14,
              border: '2px solid rgba(255, 255, 255, 0.5)',
              borderRadius: 0,
              background: soundOn ? 'rgba(90, 140, 255, 0.8)' : 'transparent',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              lineHeight: 1,
              color: '#fff',
            }}
          >
            {soundOn ? 'X' : ''}
          </span>
        </button>
        <button
          onClick={onToggleDebugMode}
          onMouseEnter={() => setHovered('debug')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'debug' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          <span>Debug View</span>
          {isDebugMode && (
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'rgba(90, 140, 255, 0.8)',
                flexShrink: 0,
              }}
            />
          )}
        </button>
        <UsageSection liveSummary={usageSummary} />
      </div>
    </>
  );
}
