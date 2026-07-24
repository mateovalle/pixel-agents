import * as fs from 'fs';

import { FILE_WATCHER_POLL_INTERVAL_MS } from './constants.js';
import { cancelPermissionTimer, cancelWaitingTimer } from './timerManager.js';
import { processTranscriptLine } from './transcriptParser.js';
import type { CoreAgentState, TrackerContext } from './types.js';

const NEWLINE = 0x0a;

export function startFileWatching(
  ctx: TrackerContext<CoreAgentState>,
  agentId: number,
  filePath: string,
): void {
  // Never stack watchers for the same agent (e.g. webview re-resolve)
  stopFileWatching(ctx, agentId, filePath);

  // Primary: fs.watch (unreliable on macOS — may miss events)
  try {
    const watcher = fs.watch(filePath, () => {
      readNewLines(ctx, agentId);
    });
    // Without an 'error' listener, an async watcher error (file deleted,
    // dir pruned) is an uncaught exception that kills the host process.
    watcher.on('error', (e) => {
      console.log(`[Pixel Agents] fs.watch error for agent ${agentId}: ${e}`);
      watcher.close();
      if (ctx.fileWatchers.get(agentId) === watcher) {
        ctx.fileWatchers.delete(agentId);
      }
      // Polling below keeps the agent alive.
    });
    ctx.fileWatchers.set(agentId, watcher);
  } catch (e) {
    console.log(`[Pixel Agents] fs.watch failed for agent ${agentId}: ${e}`);
  }

  // Secondary: fs.watchFile (stat-based polling, reliable on macOS)
  try {
    fs.watchFile(filePath, { interval: FILE_WATCHER_POLL_INTERVAL_MS }, () => {
      readNewLines(ctx, agentId);
    });
  } catch (e) {
    console.log(`[Pixel Agents] fs.watchFile failed for agent ${agentId}: ${e}`);
  }

  // Tertiary: manual poll as last resort
  const interval = setInterval(() => {
    if (!ctx.agents.has(agentId)) {
      clearInterval(interval);
      try {
        fs.unwatchFile(filePath);
      } catch {
        /* ignore */
      }
      return;
    }
    readNewLines(ctx, agentId);
  }, FILE_WATCHER_POLL_INTERVAL_MS);
  ctx.pollingTimers.set(agentId, interval);
}

/** Tears down all three watch mechanisms for an agent. Safe to call repeatedly. */
export function stopFileWatching(
  ctx: TrackerContext<CoreAgentState>,
  agentId: number,
  filePath: string,
): void {
  ctx.fileWatchers.get(agentId)?.close();
  ctx.fileWatchers.delete(agentId);
  const pt = ctx.pollingTimers.get(agentId);
  if (pt) {
    clearInterval(pt);
  }
  ctx.pollingTimers.delete(agentId);
  try {
    fs.unwatchFile(filePath);
  } catch {
    /* ignore */
  }
}

export function readNewLines(ctx: TrackerContext<CoreAgentState>, agentId: number): void {
  const agent = ctx.agents.get(agentId);
  if (!agent) return;
  try {
    const stat = fs.statSync(agent.jsonlFile);
    if (stat.size < agent.fileOffset) {
      // File was truncated or replaced — start over from the beginning
      // instead of stalling until it regrows past the old offset.
      agent.fileOffset = 0;
      agent.lineBuffer = Buffer.alloc(0);
    }
    if (stat.size <= agent.fileOffset) return;

    const buf = Buffer.alloc(stat.size - agent.fileOffset);
    const fd = fs.openSync(agent.jsonlFile, 'r');
    fs.readSync(fd, buf, 0, buf.length, agent.fileOffset);
    fs.closeSync(fd);
    agent.fileOffset = stat.size;

    // Split on the last newline at the BYTE level before decoding, so a
    // multi-byte UTF-8 character straddling two reads is never corrupted.
    const combined = Buffer.concat([agent.lineBuffer, buf]);
    const lastNewline = combined.lastIndexOf(NEWLINE);
    if (lastNewline === -1) {
      agent.lineBuffer = combined;
      return;
    }
    agent.lineBuffer = combined.subarray(lastNewline + 1);
    const lines = combined.subarray(0, lastNewline).toString('utf-8').split('\n');

    const hasLines = lines.some((l) => l.trim());
    if (hasLines) {
      // New data arriving — cancel timers (data flowing means agent is still active)
      cancelWaitingTimer(ctx, agentId);
      cancelPermissionTimer(ctx, agentId);
      if (agent.permissionSent) {
        agent.permissionSent = false;
        ctx.send({ type: 'agentToolPermissionClear', id: agentId });
      }
    }

    for (const line of lines) {
      if (!line.trim()) continue;
      processTranscriptLine(ctx, agentId, line);
    }
  } catch (e) {
    console.log(`[Pixel Agents] Read error for agent ${agentId}: ${e}`);
  }
}
