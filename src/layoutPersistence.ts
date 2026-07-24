// Host-agnostic layout file I/O lives in src/core/layoutPersistence.ts.
// This module adds the VS Code-specific migration path (workspace state).

import type { ExtensionContext } from 'vscode';

import { WORKSPACE_KEY_LAYOUT } from './constants.js';
import { readLayoutFromFile, writeLayoutToFile } from './core/layoutPersistence.js';

export type { LayoutWatcher } from './core/layoutPersistence.js';
export {
  isValidLayout,
  readLayoutFromFile,
  watchLayoutFile,
  writeLayoutToFile,
} from './core/layoutPersistence.js';

/**
 * Load layout with migration from workspace state:
 * 1. If file exists → return it
 * 2. Else if workspace state has layout → write to file, clear workspace state, return it
 * 3. Else if defaultLayout provided → write to file, return it
 * 4. Else → return null
 */
export function migrateAndLoadLayout(
  context: ExtensionContext,
  defaultLayout?: Record<string, unknown> | null,
): Record<string, unknown> | null {
  // 1. Try file
  const fromFile = readLayoutFromFile();
  if (fromFile) {
    console.log('[Pixel Agents] Layout loaded from file');
    return fromFile;
  }

  // 2. Migrate from workspace state
  const fromState = context.workspaceState.get<Record<string, unknown>>(WORKSPACE_KEY_LAYOUT);
  if (fromState) {
    console.log('[Pixel Agents] Migrating layout from workspace state to file');
    writeLayoutToFile(fromState);
    context.workspaceState.update(WORKSPACE_KEY_LAYOUT, undefined);
    return fromState;
  }

  // 3. Use bundled default
  if (defaultLayout) {
    console.log('[Pixel Agents] Writing bundled default layout to file');
    writeLayoutToFile(defaultLayout);
    return defaultLayout;
  }

  // 4. Nothing
  return null;
}
