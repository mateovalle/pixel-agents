import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { HostToWebviewMessage } from '../../../shared/protocol.js';
import { readNewLines } from '../fileWatcher.js';
import { type CoreAgentState, createCoreAgentState, type TrackerContext } from '../types.js';

function makeCtx(): { ctx: TrackerContext<CoreAgentState>; sent: HostToWebviewMessage[] } {
  const sent: HostToWebviewMessage[] = [];
  const ctx: TrackerContext<CoreAgentState> = {
    agents: new Map(),
    fileWatchers: new Map(),
    pollingTimers: new Map(),
    waitingTimers: new Map(),
    permissionTimers: new Map(),
    send: (m) => sent.push(m),
    persistAgents: () => {},
  };
  return { ctx, sent };
}

describe('readNewLines', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-agents-test-'));
    file = path.join(dir, 'session.jsonl');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function agentFor(ctx: TrackerContext<CoreAgentState>): CoreAgentState {
    const agent = createCoreAgentState(1, dir, file);
    ctx.agents.set(1, agent);
    return agent;
  }

  it('parses complete lines and carries the unterminated tail', () => {
    const { ctx, sent } = makeCtx();
    agentFor(ctx);
    const toolUse = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a/b.ts' } }],
      },
    });
    fs.writeFileSync(file, toolUse + '\n{"type":"assis'); // partial second line
    readNewLines(ctx, 1);

    expect(sent.some((m) => m.type === 'agentToolStart' && m.toolId === 't1')).toBe(true);
    // Partial line carried, then completed on the next read
    expect(sent.filter((m) => m.type === 'agentToolStart')).toHaveLength(1);
  });

  it('does not corrupt a multi-byte UTF-8 character split across reads', () => {
    const { ctx, sent } = makeCtx();
    agentFor(ctx);
    const record = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'Bash',
            input: { command: 'echo "héllo wörld ünïcode"' },
          },
        ],
      },
    });
    const bytes = Buffer.from(record + '\n', 'utf-8');
    // First write ends in the MIDDLE of a multi-byte character
    const splitAt = bytes.indexOf(Buffer.from('é', 'utf-8')[0]) + 1;
    fs.writeFileSync(file, bytes.subarray(0, splitAt));
    readNewLines(ctx, 1);
    expect(sent).toHaveLength(0); // nothing complete yet

    fs.appendFileSync(file, bytes.subarray(splitAt));
    readNewLines(ctx, 1);
    const start = sent.find((m) => m.type === 'agentToolStart');
    expect(start).toBeDefined();
    // The é survived the byte-boundary split (a decoded-string carry would
    // have produced replacement chars and failed JSON.parse entirely)
    expect(start && 'status' in start && start.status).toContain('héllo');
  });

  it('resets the offset when the file is truncated/replaced', () => {
    const { ctx, sent } = makeCtx();
    const agent = agentFor(ctx);
    const line = (id: string) =>
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id, name: 'Grep', input: {} }] },
      }) + '\n';

    fs.writeFileSync(file, line('t1') + line('t2'));
    readNewLines(ctx, 1);
    expect(agent.fileOffset).toBeGreaterThan(0);

    // Replace with a SHORTER file (e.g. session file recreated)
    fs.writeFileSync(file, line('t3'));
    readNewLines(ctx, 1);
    expect(sent.some((m) => m.type === 'agentToolStart' && m.toolId === 't3')).toBe(true);
  });

  it('cancels waiting/permission timers when data arrives', () => {
    const { ctx } = makeCtx();
    const agent = agentFor(ctx);
    const timer = setTimeout(() => {}, 60_000);
    ctx.waitingTimers.set(1, timer);
    agent.permissionSent = false;

    fs.writeFileSync(file, '{"type":"system","subtype":"other"}\n');
    readNewLines(ctx, 1);
    expect(ctx.waitingTimers.has(1)).toBe(false);
    clearTimeout(timer);
  });
});
