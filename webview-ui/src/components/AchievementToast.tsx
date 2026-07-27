import { useEffect } from 'react';

import type { AchievementInfo } from '../../../shared/protocol.js';
import {
  ACHIEVEMENT_TOAST_BORDER_COLOR,
  ACHIEVEMENT_TOAST_DURATION_MS,
  ACHIEVEMENT_TOAST_SLIDE_SEC,
  ACHIEVEMENT_TOAST_Z_INDEX,
} from '../constants.js';

interface AchievementToastProps {
  /** Pending unlocks — the first entry is displayed; the rest wait their turn. */
  queue: AchievementInfo[];
  /** Called when the current toast should be dismissed (auto-timeout or click). */
  onDismiss: () => void;
}

/**
 * Pixel-styled unlock toast (top-center). Shows one achievement at a time,
 * auto-dismisses after a few seconds, and advances through the queue.
 */
export function AchievementToast({ queue, onDismiss }: AchievementToastProps) {
  const current = queue.length > 0 ? queue[0] : null;

  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(onDismiss, ACHIEVEMENT_TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [current, onDismiss]);

  if (!current) return null;

  return (
    <>
      <style>{`
        @keyframes pixel-agents-achievement-slide {
          from { transform: translate(-50%, -120%); opacity: 0; }
          to { transform: translate(-50%, 0); opacity: 1; }
        }
      `}</style>
      <div
        // Key restarts the slide-in animation for each queued unlock
        key={current.id}
        onClick={onDismiss}
        style={{
          position: 'absolute',
          top: 8,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: ACHIEVEMENT_TOAST_Z_INDEX,
          background: 'var(--pixel-bg)',
          border: `2px solid ${ACHIEVEMENT_TOAST_BORDER_COLOR}`,
          borderRadius: 0,
          boxShadow: '2px 2px 0px #0a0a14',
          padding: '8px 16px',
          cursor: 'pointer',
          textAlign: 'center',
          whiteSpace: 'nowrap',
          animation: `pixel-agents-achievement-slide ${ACHIEVEMENT_TOAST_SLIDE_SEC}s ease-out`,
        }}
        title="Click to dismiss"
      >
        <div style={{ fontSize: '20px', color: ACHIEVEMENT_TOAST_BORDER_COLOR }}>
          🏆 Achievement unlocked!
        </div>
        <div style={{ fontSize: '22px', color: 'rgba(255, 255, 255, 0.9)', marginTop: 2 }}>
          {current.name}
        </div>
        <div style={{ fontSize: '16px', color: 'rgba(255, 255, 255, 0.6)', marginTop: 2 }}>
          {current.description}
        </div>
      </div>
    </>
  );
}
