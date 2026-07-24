import type * as vscode from 'vscode';

import type { CoreAgentState, TrackerContext } from './core/types.js';

export interface AgentState extends CoreAgentState {
  terminalRef: vscode.Terminal;
}

/** Everything the VS Code host threads through the agent-tracking functions. */
export interface HostContext extends TrackerContext<AgentState> {
  jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>;
  knownJsonlFiles: Set<string>;
  activeAgentId: { current: number | null };
  nextAgentId: { current: number };
  nextTerminalIndex: { current: number };
  /** One scan timer per project dir (multi-root workspaces scan every folder). */
  projectScanTimers: Map<string, ReturnType<typeof setInterval>>;
}

export interface PersistedAgent {
  id: number;
  terminalName: string;
  jsonlFile: string;
  projectDir: string;
  /** Workspace folder name (only set for multi-root workspaces) */
  folderName?: string;
}
