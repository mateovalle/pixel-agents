/**
 * VS Code-specific watching: project-level scans for terminal adoption and
 * /clear detection. The per-agent JSONL watching lives in src/core/fileWatcher.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { PROJECT_SCAN_INTERVAL_MS } from './core/constants.js';
import { readNewLines, startFileWatching, stopFileWatching } from './core/fileWatcher.js';
import {
  cancelPermissionTimer,
  cancelWaitingTimer,
  clearAgentActivity,
} from './core/timerManager.js';
import { createCoreAgentState } from './core/types.js';
import type { AgentState, HostContext } from './types.js';

export function ensureProjectScan(ctx: HostContext, projectDir: string): void {
  if (ctx.projectScanTimers.has(projectDir)) return;
  // Seed with all existing JSONL files so we only react to truly new ones
  try {
    const files = fs
      .readdirSync(projectDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(projectDir, f));
    for (const f of files) {
      ctx.knownJsonlFiles.add(f);
    }
  } catch {
    /* dir may not exist yet */
  }

  const timer = setInterval(() => {
    scanForNewJsonlFiles(ctx, projectDir);
  }, PROJECT_SCAN_INTERVAL_MS);
  ctx.projectScanTimers.set(projectDir, timer);
}

export function stopAllProjectScans(ctx: HostContext): void {
  for (const timer of ctx.projectScanTimers.values()) {
    clearInterval(timer);
  }
  ctx.projectScanTimers.clear();
}

function scanForNewJsonlFiles(ctx: HostContext, projectDir: string): void {
  let files: string[];
  try {
    files = fs
      .readdirSync(projectDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(projectDir, f));
  } catch {
    return;
  }

  // Prune deleted files from the known set so a re-created session file
  // with the same name is detected again (and the set doesn't grow forever).
  const current = new Set(files);
  for (const known of ctx.knownJsonlFiles) {
    if (known.startsWith(projectDir + path.sep) && !current.has(known)) {
      ctx.knownJsonlFiles.delete(known);
    }
  }

  for (const file of files) {
    if (!ctx.knownJsonlFiles.has(file)) {
      ctx.knownJsonlFiles.add(file);
      if (ctx.activeAgentId.current !== null) {
        // Active agent focused → /clear reassignment
        console.log(
          `[Pixel Agents] New JSONL detected: ${path.basename(file)}, reassigning to agent ${ctx.activeAgentId.current}`,
        );
        reassignAgentToFile(ctx, ctx.activeAgentId.current, file);
      } else {
        // No active agent → try to adopt the focused terminal
        const activeTerminal = vscode.window.activeTerminal;
        if (activeTerminal) {
          let owned = false;
          for (const agent of ctx.agents.values()) {
            if (agent.terminalRef === activeTerminal) {
              owned = true;
              break;
            }
          }
          if (!owned) {
            adoptTerminalForFile(ctx, activeTerminal, file, projectDir);
          }
        }
      }
    }
  }
}

function adoptTerminalForFile(
  ctx: HostContext,
  terminal: vscode.Terminal,
  jsonlFile: string,
  projectDir: string,
): void {
  const id = ctx.nextAgentId.current++;
  const agent: AgentState = {
    ...createCoreAgentState(id, projectDir, jsonlFile),
    terminalRef: terminal,
  };

  ctx.agents.set(id, agent);
  ctx.activeAgentId.current = id;
  ctx.persistAgents();

  console.log(
    `[Pixel Agents] Agent ${id}: adopted terminal "${terminal.name}" for ${path.basename(jsonlFile)}`,
  );
  ctx.send({ type: 'agentCreated', id });

  startFileWatching(ctx, id, jsonlFile);
  readNewLines(ctx, id);
}

export function reassignAgentToFile(ctx: HostContext, agentId: number, newFilePath: string): void {
  const agent = ctx.agents.get(agentId);
  if (!agent) return;

  // Stop old file watching
  stopFileWatching(ctx, agentId, agent.jsonlFile);

  // Clear activity
  cancelWaitingTimer(ctx, agentId);
  cancelPermissionTimer(ctx, agentId);
  clearAgentActivity(ctx, agentId);

  // Swap to new file
  agent.jsonlFile = newFilePath;
  agent.fileOffset = 0;
  agent.lineBuffer = Buffer.alloc(0);
  ctx.persistAgents();

  // Start watching new file
  startFileWatching(ctx, agentId, newFilePath);
  readNewLines(ctx, agentId);
}
