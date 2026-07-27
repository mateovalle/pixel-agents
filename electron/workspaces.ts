/**
 * Workspace registry: project folders rendered as offices in the campus.
 * Persisted to ~/.pixel-agents/workspaces.json.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { WorkspaceInfo } from '../shared/protocol.js';
import { LAYOUT_FILE_DIR } from '../src/core/constants.js';

const WORKSPACES_FILE = path.join(os.homedir(), LAYOUT_FILE_DIR, 'workspaces.json');

let cache: WorkspaceInfo[] | null = null;

export function loadWorkspaces(): WorkspaceInfo[] {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(WORKSPACES_FILE, 'utf-8')) as {
      workspaces?: WorkspaceInfo[];
    };
    cache = (raw.workspaces ?? []).filter((w) => typeof w.path === 'string');
  } catch {
    cache = [];
  }
  return cache;
}

function save(): void {
  try {
    fs.mkdirSync(path.dirname(WORKSPACES_FILE), { recursive: true });
    fs.writeFileSync(
      WORKSPACES_FILE,
      JSON.stringify({ workspaces: cache ?? [] }, null, 2),
      'utf-8',
    );
  } catch (err) {
    console.error('[Pixel Agents] Failed to save workspaces:', err);
  }
}

/** Adds (or touches) a workspace; returns the updated list. */
export function touchWorkspace(workspacePath: string, name?: string): WorkspaceInfo[] {
  const list = loadWorkspaces();
  const existing = list.find((w) => w.path === workspacePath);
  if (existing) {
    existing.lastUsedAt = Date.now();
    if (name) existing.name = name;
  } else {
    list.push({
      path: workspacePath,
      name: name ?? path.basename(workspacePath),
      addedAt: Date.now(),
      lastUsedAt: Date.now(),
    });
  }
  save();
  return list;
}

export function removeWorkspace(workspacePath: string): WorkspaceInfo[] {
  cache = loadWorkspaces().filter((w) => w.path !== workspacePath);
  save();
  return cache;
}
