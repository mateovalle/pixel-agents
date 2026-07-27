/** Map status prefixes back to tool names for animation selection */
export const STATUS_TO_TOOL: Record<string, string> = {
  Reading: 'Read',
  Searching: 'Grep',
  Globbing: 'Glob',
  Fetching: 'WebFetch',
  'Searching web': 'WebSearch',
  Writing: 'Write',
  Editing: 'Edit',
  Running: 'Bash',
  Task: 'Task',
};

export function extractToolName(status: string): string | null {
  for (const [prefix, tool] of Object.entries(STATUS_TO_TOOL)) {
    if (status.startsWith(prefix)) return tool;
  }
  const first = status.split(/[\s:]/)[0];
  return first || null;
}

import {
  USAGE_USD_NO_DECIMAL_THRESHOLD,
  USAGE_USD_ONE_DECIMAL_THRESHOLD,
  ZOOM_DEFAULT_DPR_FACTOR,
  ZOOM_MIN,
} from '../constants.js';

/** Compute a default integer zoom level (device pixels per sprite pixel) */
export function defaultZoom(): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.max(ZOOM_MIN, Math.round(ZOOM_DEFAULT_DPR_FACTOR * dpr));
}

/** Compact money display: $0.00 → $9.99, then $12.3, then $123 */
export function formatUsd(v: number): string {
  if (v >= USAGE_USD_NO_DECIMAL_THRESHOLD) return `$${v.toFixed(0)}`;
  if (v >= USAGE_USD_ONE_DECIMAL_THRESHOLD) return `$${v.toFixed(1)}`;
  return `$${v.toFixed(2)}`;
}
