/**
 * Achievements: milestone tracking persisted to ~/.pixel-agents/achievements.json.
 * Rewards are cosmetic milestones (future: unlock decorative furniture).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { AchievementInfo } from '../shared/protocol.js';
import { LAYOUT_FILE_DIR } from '../src/core/constants.js';

const FILE = path.join(os.homedir(), LAYOUT_FILE_DIR, 'achievements.json');

export type AchievementEvent =
  | 'agentSpawned'
  | 'taskAssigned'
  | 'taskCompleted'
  | 'agentTaskCompleted'
  | 'turnCompleted'
  | 'workspaceAdded';

interface Counters {
  agentsSpawned: number;
  maxConcurrentAgents: number;
  tasksAssigned: number;
  tasksCompleted: number;
  agentTaskCompletions: number;
  turns: number;
  activeDays: string[];
  workspaces: number;
}

interface State {
  counters: Counters;
  unlocked: Record<string, number>;
}

interface AchievementDef {
  id: string;
  name: string;
  description: string;
  test: (c: Counters) => boolean;
}

const DEFS: AchievementDef[] = [
  {
    id: 'first-agent',
    name: 'First Hire',
    description: 'Create your first agent',
    test: (c) => c.agentsSpawned >= 1,
  },
  {
    id: 'multitasker',
    name: 'Multitasker',
    description: '3 agents working at the same time',
    test: (c) => c.maxConcurrentAgents >= 3,
  },
  {
    id: 'full-floor',
    name: 'Full Floor',
    description: '5 agents working at the same time',
    test: (c) => c.maxConcurrentAgents >= 5,
  },
  {
    id: 'delegator',
    name: 'Delegator',
    description: 'Assign 5 tasks to agents',
    test: (c) => c.tasksAssigned >= 5,
  },
  {
    id: 'first-done',
    name: 'Shipped',
    description: 'Complete your first task',
    test: (c) => c.tasksCompleted >= 1,
  },
  {
    id: 'ten-done',
    name: 'Momentum',
    description: 'Complete 10 tasks',
    test: (c) => c.tasksCompleted >= 10,
  },
  {
    id: 'fifty-done',
    name: 'Well-Oiled Machine',
    description: 'Complete 50 tasks',
    test: (c) => c.tasksCompleted >= 50,
  },
  {
    id: 'self-organizing',
    name: 'Self-Organizing',
    description: 'An agent completes a task on its own',
    test: (c) => c.agentTaskCompletions >= 1,
  },
  {
    id: 'campus',
    name: 'Campus',
    description: 'Register 3 workspaces',
    test: (c) => c.workspaces >= 3,
  },
  {
    id: 'streak-3',
    name: 'Warming Up',
    description: 'Active 3 different days',
    test: (c) => c.activeDays.length >= 3,
  },
  {
    id: 'streak-7',
    name: 'Regular',
    description: 'Active 7 different days',
    test: (c) => c.activeDays.length >= 7,
  },
  {
    id: 'century',
    name: 'Century',
    description: '100 agent turns completed',
    test: (c) => c.turns >= 100,
  },
];

let state: State | null = null;

function load(): State {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(FILE, 'utf-8')) as State;
  } catch {
    state = null;
  }
  state ??= {
    counters: {
      agentsSpawned: 0,
      maxConcurrentAgents: 0,
      tasksAssigned: 0,
      tasksCompleted: 0,
      agentTaskCompletions: 0,
      turns: 0,
      activeDays: [],
      workspaces: 0,
    },
    unlocked: {},
  };
  return state;
}

function save(): void {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Pixel Agents] Failed to save achievements:', err);
  }
}

export function listAchievements(): AchievementInfo[] {
  const st = load();
  return DEFS.map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    ...(st.unlocked[d.id] ? { unlockedAt: st.unlocked[d.id] } : {}),
  }));
}

/** Records an event; returns any achievements newly unlocked by it. */
export function recordAchievementEvent(
  event: AchievementEvent,
  detail?: { concurrentAgents?: number; workspaces?: number },
): AchievementInfo[] {
  const st = load();
  const c = st.counters;
  if (event === 'agentSpawned') {
    c.agentsSpawned++;
    c.maxConcurrentAgents = Math.max(c.maxConcurrentAgents, detail?.concurrentAgents ?? 0);
  } else if (event === 'taskAssigned') {
    c.tasksAssigned++;
  } else if (event === 'taskCompleted') {
    c.tasksCompleted++;
  } else if (event === 'agentTaskCompleted') {
    c.agentTaskCompletions++;
    c.tasksCompleted++;
  } else if (event === 'turnCompleted') {
    c.turns++;
    const today = new Date().toISOString().slice(0, 10);
    if (!c.activeDays.includes(today)) c.activeDays.push(today);
  } else if (event === 'workspaceAdded') {
    c.workspaces = Math.max(c.workspaces, detail?.workspaces ?? 0);
  }

  const fresh: AchievementInfo[] = [];
  for (const d of DEFS) {
    if (!st.unlocked[d.id] && d.test(c)) {
      st.unlocked[d.id] = Date.now();
      fresh.push({
        id: d.id,
        name: d.name,
        description: d.description,
        unlockedAt: st.unlocked[d.id],
      });
    }
  }
  save();
  return fresh;
}
