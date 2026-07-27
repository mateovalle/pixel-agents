/**
 * Human todo lists per workspace, persisted to ~/.pixel-agents/todos.json.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { TodoItem } from '../shared/protocol.js';
import { LAYOUT_FILE_DIR } from '../src/core/constants.js';

const TODOS_FILE = path.join(os.homedir(), LAYOUT_FILE_DIR, 'todos.json');

let cache: Record<string, TodoItem[]> | null = null;

function load(): Record<string, TodoItem[]> {
  if (cache) return cache;
  try {
    cache =
      (
        JSON.parse(fs.readFileSync(TODOS_FILE, 'utf-8')) as {
          byWorkspace?: Record<string, TodoItem[]>;
        }
      ).byWorkspace ?? {};
  } catch {
    cache = {};
  }
  return cache;
}

function save(): void {
  try {
    fs.mkdirSync(path.dirname(TODOS_FILE), { recursive: true });
    fs.writeFileSync(TODOS_FILE, JSON.stringify({ byWorkspace: cache ?? {} }, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Pixel Agents] Failed to save todos:', err);
  }
}

export function getTodos(workspacePath: string): TodoItem[] {
  return load()[workspacePath] ?? [];
}

export function getAllTodoPaths(): string[] {
  return Object.keys(load());
}

export function addTodo(workspacePath: string, text: string): TodoItem[] {
  const all = load();
  const list = (all[workspacePath] ??= []);
  list.push({ id: crypto.randomUUID(), text, status: 'open', createdAt: Date.now() });
  save();
  return list;
}

export function toggleTodo(workspacePath: string, id: string): TodoItem[] {
  const list = getTodos(workspacePath);
  const item = list.find((t) => t.id === id);
  if (item) {
    item.status = item.status === 'open' ? 'done' : 'open';
    save();
  }
  return list;
}

export function deleteTodo(workspacePath: string, id: string): TodoItem[] {
  const all = load();
  all[workspacePath] = (all[workspacePath] ?? []).filter((t) => t.id !== id);
  save();
  return all[workspacePath];
}
