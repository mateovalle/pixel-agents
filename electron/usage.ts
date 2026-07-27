/**
 * Persistent per-turn usage tracking for chat agents.
 *
 * Every completed SDK turn appends one JSONL line to
 * ~/.pixel-agents/usage.jsonl; summaries are aggregated on read. Costs are
 * the SDK's exact total_cost_usd figures (API-equivalent pricing).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { ProjectUsage, UsageSummary } from '../shared/protocol.js';
import { LAYOUT_FILE_DIR } from '../src/core/constants.js';

const USAGE_FILE = path.join(os.homedir(), LAYOUT_FILE_DIR, 'usage.jsonl');
const MAX_PROJECTS_IN_SUMMARY = 10;

interface UsageEntry {
  /** Epoch ms of turn completion. */
  t: number;
  /** Cost in USD. */
  c: number;
  /** Turn duration in ms. */
  d: number;
  /** Project cwd. */
  p: string;
}

export function recordTurnUsage(cwd: string, costUsd: number, durationMs: number): void {
  if (!(costUsd > 0) && !(durationMs > 0)) return;
  const entry: UsageEntry = { t: Date.now(), c: costUsd, d: durationMs, p: cwd };
  try {
    fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true });
    fs.appendFileSync(USAGE_FILE, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (err) {
    console.error('[Pixel Agents] Failed to record usage:', err);
  }
}

function readEntries(): UsageEntry[] {
  let raw: string;
  try {
    raw = fs.readFileSync(USAGE_FILE, 'utf-8');
  } catch {
    return [];
  }
  const entries: UsageEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as UsageEntry;
      if (typeof e.t === 'number' && typeof e.c === 'number' && typeof e.p === 'string') {
        entries.push(e);
      }
    } catch {
      /* skip malformed line */
    }
  }
  return entries;
}

export function summarizeUsage(now = new Date()): UsageSummary {
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  let todayUsd = 0;
  let monthUsd = 0;
  let allTimeUsd = 0;
  let turnCount = 0;
  const byProject = new Map<string, { monthUsd: number; allTimeUsd: number }>();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const DAYS_IN_SERIES = 14;
  const dayBuckets = new Array<number>(DAYS_IN_SERIES).fill(0);
  const seriesStart = startOfDay - (DAYS_IN_SERIES - 1) * DAY_MS;
  const todayByWorkspace: Record<string, number> = {};

  for (const e of readEntries()) {
    turnCount++;
    allTimeUsd += e.c;
    if (e.t >= startOfMonth) monthUsd += e.c;
    if (e.t >= startOfDay) {
      todayUsd += e.c;
      todayByWorkspace[e.p] = (todayByWorkspace[e.p] ?? 0) + e.c;
    }
    if (e.t >= seriesStart) {
      const idx = Math.min(DAYS_IN_SERIES - 1, Math.floor((e.t - seriesStart) / DAY_MS));
      dayBuckets[idx] += e.c;
    }

    let proj = byProject.get(e.p);
    if (!proj) {
      proj = { monthUsd: 0, allTimeUsd: 0 };
      byProject.set(e.p, proj);
    }
    proj.allTimeUsd += e.c;
    if (e.t >= startOfMonth) proj.monthUsd += e.c;
  }

  const perProject: ProjectUsage[] = [...byProject.entries()]
    .map(([projectPath, sums]) => ({
      path: projectPath,
      folder: path.basename(projectPath),
      monthUsd: sums.monthUsd,
      allTimeUsd: sums.allTimeUsd,
    }))
    .sort((a, b) => b.monthUsd - a.monthUsd || b.allTimeUsd - a.allTimeUsd)
    .slice(0, MAX_PROJECTS_IN_SUMMARY);

  const days = dayBuckets.map((usd, i) => {
    const d = new Date(seriesStart + i * DAY_MS);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return { day: `${mm}-${dd}`, usd };
  });

  return { todayUsd, monthUsd, allTimeUsd, perProject, turnCount, days, todayByWorkspace };
}
