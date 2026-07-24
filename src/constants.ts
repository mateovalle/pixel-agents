// Host-agnostic constants live in src/core/constants.ts and are re-exported
// here so existing imports keep working.
export * from './core/constants.js';

// ── Settings Persistence ────────────────────────────────────
export const GLOBAL_KEY_SOUND_ENABLED = 'pixel-agents.soundEnabled';

// ── VS Code Identifiers ─────────────────────────────────────
export const VIEW_ID = 'pixel-agents.panelView';
export const COMMAND_SHOW_PANEL = 'pixel-agents.showPanel';
export const COMMAND_EXPORT_DEFAULT_LAYOUT = 'pixel-agents.exportDefaultLayout';
export const WORKSPACE_KEY_AGENTS = 'pixel-agents.agents';
export const WORKSPACE_KEY_AGENT_SEATS = 'pixel-agents.agentSeats';
export const WORKSPACE_KEY_LAYOUT = 'pixel-agents.layout';
export const TERMINAL_NAME_PREFIX = 'Claude Code';

// ── Agent Restore ───────────────────────────────────────────
/**
 * On window reload, terminals are restored asynchronously — persisted agents
 * whose terminals haven't appeared yet get this long before being pruned.
 */
export const RESTORE_GRACE_MS = 15000;
