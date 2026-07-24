import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  RESTORE_GRACE_MS,
  TERMINAL_NAME_PREFIX,
  WORKSPACE_KEY_AGENT_SEATS,
  WORKSPACE_KEY_AGENTS,
} from './constants.js';
import { JSONL_POLL_INTERVAL_MS } from './core/constants.js';
import { readNewLines, startFileWatching, stopFileWatching } from './core/fileWatcher.js';
import { cancelPermissionTimer, cancelWaitingTimer } from './core/timerManager.js';
import { createCoreAgentState, type Send } from './core/types.js';
import { ensureProjectScan } from './fileWatcher.js';
import { migrateAndLoadLayout } from './layoutPersistence.js';
import type { AgentState, HostContext, PersistedAgent } from './types.js';

export function getProjectDirPath(cwd?: string): string | null {
  const workspacePath = cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspacePath) return null;
  const dirName = workspacePath.replace(/[^a-zA-Z0-9-]/g, '-');
  const projectDir = path.join(os.homedir(), '.claude', 'projects', dirName);
  console.log(`[Pixel Agents] Project dir: ${workspacePath} → ${dirName}`);
  return projectDir;
}

export async function launchNewTerminal(ctx: HostContext, folderPath?: string): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  const cwd = folderPath || folders?.[0]?.uri.fsPath;
  const isMultiRoot = !!(folders && folders.length > 1);

  // Resolve the project dir BEFORE creating the terminal so we never leave
  // an orphan terminal running claude with no agent attached to it.
  const projectDir = getProjectDirPath(cwd);
  if (!projectDir) {
    console.log(`[Pixel Agents] No project dir, cannot track agent`);
    return;
  }

  const idx = ctx.nextTerminalIndex.current++;
  const terminal = vscode.window.createTerminal({
    name: `${TERMINAL_NAME_PREFIX} #${idx}`,
    cwd,
  });
  terminal.show();

  const sessionId = crypto.randomUUID();
  terminal.sendText(`claude --session-id ${sessionId}`);

  // Pre-register expected JSONL file so project scan won't treat it as a /clear file
  const expectedFile = path.join(projectDir, `${sessionId}.jsonl`);
  ctx.knownJsonlFiles.add(expectedFile);

  // Create agent immediately (before JSONL file exists)
  const id = ctx.nextAgentId.current++;
  const folderName = isMultiRoot && cwd ? path.basename(cwd) : undefined;
  const agent: AgentState = {
    ...createCoreAgentState(id, projectDir, expectedFile),
    terminalRef: terminal,
    folderName,
  };

  ctx.agents.set(id, agent);
  ctx.activeAgentId.current = id;
  ctx.persistAgents();
  console.log(`[Pixel Agents] Agent ${id}: created for terminal ${terminal.name}`);
  ctx.send({ type: 'agentCreated', id, folderName });

  ensureProjectScan(ctx, projectDir);
  pollForJsonlFile(ctx, id, false);
}

/** Poll until the agent's JSONL file appears, then start watching it. */
function pollForJsonlFile(ctx: HostContext, agentId: number, skipToEnd: boolean): void {
  const pollTimer = setInterval(() => {
    const agent = ctx.agents.get(agentId);
    if (!agent) {
      clearInterval(pollTimer);
      ctx.jsonlPollTimers.delete(agentId);
      return;
    }
    try {
      if (fs.existsSync(agent.jsonlFile)) {
        console.log(
          `[Pixel Agents] Agent ${agentId}: found JSONL file ${path.basename(agent.jsonlFile)}`,
        );
        clearInterval(pollTimer);
        ctx.jsonlPollTimers.delete(agentId);
        if (skipToEnd) {
          agent.fileOffset = fs.statSync(agent.jsonlFile).size;
        }
        startFileWatching(ctx, agentId, agent.jsonlFile);
        if (!skipToEnd) {
          readNewLines(ctx, agentId);
        }
      }
    } catch {
      /* file may not exist yet */
    }
  }, JSONL_POLL_INTERVAL_MS);
  ctx.jsonlPollTimers.set(agentId, pollTimer);
}

export function removeAgent(ctx: HostContext, agentId: number): void {
  const agent = ctx.agents.get(agentId);
  if (!agent) return;

  // Stop JSONL poll timer
  const jpTimer = ctx.jsonlPollTimers.get(agentId);
  if (jpTimer) {
    clearInterval(jpTimer);
  }
  ctx.jsonlPollTimers.delete(agentId);

  // Stop file watching
  stopFileWatching(ctx, agentId, agent.jsonlFile);

  // Cancel timers
  cancelWaitingTimer(ctx, agentId);
  cancelPermissionTimer(ctx, agentId);

  // Remove from maps
  ctx.agents.delete(agentId);
  ctx.persistAgents();
}

export function persistAgents(
  agents: Map<number, AgentState>,
  context: vscode.ExtensionContext,
): void {
  const persisted: PersistedAgent[] = [];
  for (const agent of agents.values()) {
    persisted.push({
      id: agent.id,
      terminalName: agent.terminalRef.name,
      jsonlFile: agent.jsonlFile,
      projectDir: agent.projectDir,
      folderName: agent.folderName,
    });
  }
  context.workspaceState.update(WORKSPACE_KEY_AGENTS, persisted);
}

/**
 * Restore persisted agents by matching live terminals by name.
 *
 * Terminals are restored asynchronously on window reload, so entries with no
 * matching terminal yet are NOT dropped — a terminal-open listener keeps
 * matching them until RESTORE_GRACE_MS elapses, after which the persisted
 * list is rewritten without the ones that never came back.
 *
 * Returns a Disposable that cancels the grace-period matching.
 */
export function restoreAgents(
  ctx: HostContext,
  context: vscode.ExtensionContext,
): vscode.Disposable {
  const persisted = context.workspaceState.get<PersistedAgent[]>(WORKSPACE_KEY_AGENTS, []);
  if (persisted.length === 0) return { dispose: () => {} };

  let maxId = 0;
  let maxIdx = 0;
  const restoredProjectDirs = new Set<string>();
  const pending = new Map<string, PersistedAgent>(); // terminalName → entry

  const restoreOne = (p: PersistedAgent, terminal: vscode.Terminal, announce: boolean): void => {
    if (ctx.agents.has(p.id)) return; // already live (e.g. webview re-resolve)

    const agent: AgentState = {
      ...createCoreAgentState(p.id, p.projectDir, p.jsonlFile),
      terminalRef: terminal,
      folderName: p.folderName,
    };
    ctx.agents.set(p.id, agent);
    ctx.knownJsonlFiles.add(p.jsonlFile);
    console.log(`[Pixel Agents] Restored agent ${p.id} → terminal "${p.terminalName}"`);

    restoredProjectDirs.add(p.projectDir);

    // Start file watching if JSONL exists, skipping to end of file
    try {
      if (fs.existsSync(p.jsonlFile)) {
        agent.fileOffset = fs.statSync(p.jsonlFile).size;
        startFileWatching(ctx, p.id, p.jsonlFile);
      } else {
        pollForJsonlFile(ctx, p.id, true);
      }
    } catch {
      /* ignore errors during restore */
    }

    // Agents restored before sendExistingAgents are announced by that message;
    // only late matches (terminal restored after webviewReady) announce here.
    if (announce) {
      ctx.send({ type: 'agentCreated', id: p.id, folderName: p.folderName });
    }
  };

  for (const p of persisted) {
    if (p.id > maxId) maxId = p.id;
    // Extract terminal index from name like "Claude Code #3"
    const match = p.terminalName.match(/#(\d+)$/);
    if (match) {
      const idx = parseInt(match[1], 10);
      if (idx > maxIdx) maxIdx = idx;
    }

    const terminal = vscode.window.terminals.find((t) => t.name === p.terminalName);
    if (terminal) {
      restoreOne(p, terminal, false);
    } else if (!ctx.agents.has(p.id)) {
      pending.set(p.terminalName, p);
    }
  }

  // Advance counters past restored IDs
  if (maxId >= ctx.nextAgentId.current) {
    ctx.nextAgentId.current = maxId + 1;
  }
  if (maxIdx >= ctx.nextTerminalIndex.current) {
    ctx.nextTerminalIndex.current = maxIdx + 1;
  }

  // Start project scans for /clear detection (one per restored project dir)
  for (const dir of restoredProjectDirs) {
    ensureProjectScan(ctx, dir);
  }

  if (pending.size === 0) {
    // Everything matched — safe to rewrite the persisted list now
    ctx.persistAgents();
    return { dispose: () => {} };
  }

  console.log(`[Pixel Agents] ${pending.size} persisted agent(s) awaiting terminal restore`);

  const openListener = vscode.window.onDidOpenTerminal((terminal) => {
    const p = pending.get(terminal.name);
    if (!p) return;
    pending.delete(terminal.name);
    restoreOne(p, terminal, true);
    ensureProjectScan(ctx, p.projectDir);
    if (pending.size === 0) {
      cleanup();
      ctx.persistAgents();
    }
  });

  const graceTimer = setTimeout(() => {
    if (pending.size > 0) {
      console.log(
        `[Pixel Agents] Pruning ${pending.size} persisted agent(s) whose terminals never restored`,
      );
    }
    cleanup();
    ctx.persistAgents();
  }, RESTORE_GRACE_MS);

  let done = false;
  const cleanup = (): void => {
    if (done) return;
    done = true;
    openListener.dispose();
    clearTimeout(graceTimer);
  };

  return { dispose: cleanup };
}

export function sendExistingAgents(ctx: HostContext, context: vscode.ExtensionContext): void {
  const agentIds: number[] = [];
  for (const id of ctx.agents.keys()) {
    agentIds.push(id);
  }
  agentIds.sort((a, b) => a - b);

  // Include persisted palette/seatId from separate key
  const agentMeta = context.workspaceState.get<
    Record<string, { palette?: number; seatId?: string }>
  >(WORKSPACE_KEY_AGENT_SEATS, {});

  // Include folderName per agent
  const folderNames: Record<number, string> = {};
  for (const [id, agent] of ctx.agents) {
    if (agent.folderName) {
      folderNames[id] = agent.folderName;
    }
  }
  console.log(
    `[Pixel Agents] sendExistingAgents: agents=${JSON.stringify(agentIds)}, meta=${JSON.stringify(agentMeta)}`,
  );

  ctx.send({
    type: 'existingAgents',
    agents: agentIds,
    agentMeta,
    folderNames,
  });

  sendCurrentAgentStatuses(ctx);
}

export function sendCurrentAgentStatuses(ctx: HostContext): void {
  for (const [agentId, agent] of ctx.agents) {
    // Re-send active tools
    for (const [toolId, status] of agent.activeToolStatuses) {
      ctx.send({ type: 'agentToolStart', id: agentId, toolId, status });
    }
    // Re-send waiting status
    if (agent.isWaiting) {
      ctx.send({ type: 'agentStatus', id: agentId, status: 'waiting' });
    }
  }
}

export function sendLayout(
  context: vscode.ExtensionContext,
  send: Send,
  defaultLayout?: Record<string, unknown> | null,
): void {
  const layout = migrateAndLoadLayout(context, defaultLayout);
  send({ type: 'layoutLoaded', layout });
}
