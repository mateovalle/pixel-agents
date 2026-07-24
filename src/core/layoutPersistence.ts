import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { LAYOUT_FILE_DIR, LAYOUT_FILE_NAME, LAYOUT_FILE_POLL_INTERVAL_MS } from './constants.js';

export interface LayoutWatcher {
  markOwnWrite(): void;
  dispose(): void;
}

export function getLayoutFilePath(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, LAYOUT_FILE_NAME);
}

export function readLayoutFromFile(): Record<string, unknown> | null {
  const filePath = getLayoutFilePath();
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    console.error('[Pixel Agents] Failed to read layout file:', err);
    return null;
  }
}

export function writeLayoutToFile(layout: Record<string, unknown>): void {
  const filePath = getLayoutFilePath();
  const dir = path.dirname(filePath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const json = JSON.stringify(layout, null, 2);
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error('[Pixel Agents] Failed to write layout file:', err);
  }
}

/**
 * Basic structural validation shared by every path that accepts a layout
 * from outside (import dialog, IPC): version 1 with a tiles array.
 */
export function isValidLayout(layout: unknown): layout is Record<string, unknown> {
  return (
    typeof layout === 'object' &&
    layout !== null &&
    (layout as Record<string, unknown>).version === 1 &&
    Array.isArray((layout as Record<string, unknown>).tiles)
  );
}

/**
 * Watch ~/.pixel-agents/layout.json for external changes (other windows).
 * Uses hybrid fs.watch + polling (same pattern as JSONL watching).
 */
export function watchLayoutFile(
  onExternalChange: (layout: Record<string, unknown>) => void,
): LayoutWatcher {
  const filePath = getLayoutFilePath();
  let skipNextChange = false;
  let lastMtime = 0;
  let fsWatcher: fs.FSWatcher | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;

  // Initialize lastMtime
  try {
    if (fs.existsSync(filePath)) {
      lastMtime = fs.statSync(filePath).mtimeMs;
    }
  } catch {
    /* ignore */
  }

  function checkForChange(): void {
    if (disposed) return;
    try {
      if (!fs.existsSync(filePath)) return;
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs <= lastMtime) return;
      lastMtime = stat.mtimeMs;

      if (skipNextChange) {
        skipNextChange = false;
        return;
      }

      const raw = fs.readFileSync(filePath, 'utf-8');
      const layout = JSON.parse(raw) as Record<string, unknown>;
      console.log('[Pixel Agents] External layout change detected');
      onExternalChange(layout);
    } catch (err) {
      console.error('[Pixel Agents] Error checking layout file:', err);
    }
  }

  function startFsWatch(): void {
    if (disposed || fsWatcher) return;
    try {
      if (!fs.existsSync(filePath)) return;
      fsWatcher = fs.watch(filePath, () => {
        checkForChange();
      });
      fsWatcher.on('error', () => {
        // fs.watch can be unreliable — polling backup handles it
        fsWatcher?.close();
        fsWatcher = null;
      });
    } catch {
      // File may not exist yet — polling will retry
    }
  }

  // Start fs.watch if file exists
  startFsWatch();

  // Polling backup (also starts fs.watch if file appears)
  pollTimer = setInterval(() => {
    if (disposed) return;
    if (!fsWatcher) {
      startFsWatch();
    }
    checkForChange();
  }, LAYOUT_FILE_POLL_INTERVAL_MS);

  return {
    markOwnWrite(): void {
      skipNextChange = true;
      // Update lastMtime preemptively so a near-instant poll doesn't miss the flag
      try {
        if (fs.existsSync(filePath)) {
          lastMtime = fs.statSync(filePath).mtimeMs;
        }
      } catch {
        /* ignore */
      }
    },
    dispose(): void {
      disposed = true;
      fsWatcher?.close();
      fsWatcher = null;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    },
  };
}
