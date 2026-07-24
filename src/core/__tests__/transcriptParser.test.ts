import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HostToWebviewMessage } from '../../../shared/protocol.js';
import { formatToolStatus, processTranscriptLine } from '../transcriptParser.js';
import { type CoreAgentState, createCoreAgentState, type TrackerContext } from '../types.js';

function makeCtx(): {
  ctx: TrackerContext<CoreAgentState>;
  sent: HostToWebviewMessage[];
  agent: CoreAgentState;
} {
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
  const agent = createCoreAgentState(1, '/proj', '/proj/s.jsonl');
  ctx.agents.set(1, agent);
  return { ctx, sent, agent };
}

const toolUseLine = (id: string, name = 'Read') =>
  JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id, name, input: {} }] },
  });

describe('processTranscriptLine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ignores malformed JSON lines silently', () => {
    const { ctx, sent } = makeCtx();
    processTranscriptLine(ctx, 1, '{"type":"assis'); // truncated write
    expect(sent).toHaveLength(0);
  });

  it('tracks tool_use start and arms the permission timer for non-exempt tools', () => {
    const { ctx, sent, agent } = makeCtx();
    processTranscriptLine(ctx, 1, toolUseLine('t1', 'Bash'));

    expect(agent.activeToolIds.has('t1')).toBe(true);
    expect(agent.hadToolsInTurn).toBe(true);
    expect(sent.some((m) => m.type === 'agentToolStart' && m.toolId === 't1')).toBe(true);
    expect(ctx.permissionTimers.has(1)).toBe(true);

    // 7s of silence → permission bubble
    vi.advanceTimersByTime(7000);
    expect(sent.some((m) => m.type === 'agentToolPermission')).toBe(true);
  });

  it('does not arm the permission timer for exempt tools (Task)', () => {
    const { ctx } = makeCtx();
    processTranscriptLine(ctx, 1, toolUseLine('t1', 'Task'));
    expect(ctx.permissionTimers.has(1)).toBe(false);
  });

  it('completes tools via tool_result and delays the done message', () => {
    const { ctx, sent, agent } = makeCtx();
    processTranscriptLine(ctx, 1, toolUseLine('t1'));
    processTranscriptLine(
      ctx,
      1,
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] },
      }),
    );

    expect(agent.activeToolIds.size).toBe(0);
    expect(sent.some((m) => m.type === 'agentToolDone')).toBe(false); // delayed
    vi.advanceTimersByTime(300);
    expect(sent.some((m) => m.type === 'agentToolDone' && m.toolId === 't1')).toBe(true);
  });

  it('does not send delayed tool-done after the agent was removed', () => {
    const { ctx, sent } = makeCtx();
    processTranscriptLine(ctx, 1, toolUseLine('t1'));
    processTranscriptLine(
      ctx,
      1,
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] },
      }),
    );
    ctx.agents.delete(1);
    vi.advanceTimersByTime(300);
    expect(sent.some((m) => m.type === 'agentToolDone')).toBe(false);
  });

  it('turn_duration is the definitive turn end: clears state, sets waiting', () => {
    const { ctx, sent, agent } = makeCtx();
    processTranscriptLine(ctx, 1, toolUseLine('t1', 'Bash'));
    processTranscriptLine(ctx, 1, JSON.stringify({ type: 'system', subtype: 'turn_duration' }));

    expect(agent.activeToolIds.size).toBe(0);
    expect(agent.isWaiting).toBe(true);
    expect(agent.hadToolsInTurn).toBe(false);
    expect(ctx.permissionTimers.has(1)).toBe(false);
    expect(sent.some((m) => m.type === 'agentStatus' && m.status === 'waiting')).toBe(true);
  });

  it('text-only turns use the text-idle timer, suppressed once tools ran', () => {
    const { ctx } = makeCtx();
    const textLine = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hi' }] },
    });

    processTranscriptLine(ctx, 1, textLine);
    expect(ctx.waitingTimers.has(1)).toBe(true);

    // New turn with a tool → hadToolsInTurn=true → text no longer arms the timer
    processTranscriptLine(ctx, 1, toolUseLine('t1'));
    expect(ctx.waitingTimers.has(1)).toBe(false);
    processTranscriptLine(ctx, 1, textLine);
    expect(ctx.waitingTimers.has(1)).toBe(false);
  });
});

describe('formatToolStatus', () => {
  it('truncates long bash commands', () => {
    const status = formatToolStatus('Bash', { command: 'x'.repeat(100) });
    expect(status.length).toBeLessThan(50);
    expect(status.endsWith('…')).toBe(true);
  });

  it('uses basename for file tools', () => {
    expect(formatToolStatus('Edit', { file_path: '/deep/path/file.ts' })).toBe('Editing file.ts');
  });
});
