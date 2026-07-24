import { PERMISSION_TIMER_DELAY_MS } from './constants.js';
import type { CoreAgentState, TrackerContext } from './types.js';

export function clearAgentActivity(ctx: TrackerContext<CoreAgentState>, agentId: number): void {
  const agent = ctx.agents.get(agentId);
  if (!agent) return;
  agent.activeToolIds.clear();
  agent.activeToolStatuses.clear();
  agent.activeToolNames.clear();
  agent.activeSubagentToolIds.clear();
  agent.activeSubagentToolNames.clear();
  agent.isWaiting = false;
  agent.permissionSent = false;
  cancelPermissionTimer(ctx, agentId);
  ctx.send({ type: 'agentToolsClear', id: agentId });
  ctx.send({ type: 'agentStatus', id: agentId, status: 'active' });
}

export function cancelWaitingTimer(ctx: TrackerContext<CoreAgentState>, agentId: number): void {
  const timer = ctx.waitingTimers.get(agentId);
  if (timer) {
    clearTimeout(timer);
    ctx.waitingTimers.delete(agentId);
  }
}

export function startWaitingTimer(
  ctx: TrackerContext<CoreAgentState>,
  agentId: number,
  delayMs: number,
): void {
  cancelWaitingTimer(ctx, agentId);
  const timer = setTimeout(() => {
    ctx.waitingTimers.delete(agentId);
    const agent = ctx.agents.get(agentId);
    if (!agent) return; // agent removed while the timer was pending
    agent.isWaiting = true;
    ctx.send({ type: 'agentStatus', id: agentId, status: 'waiting' });
  }, delayMs);
  ctx.waitingTimers.set(agentId, timer);
}

export function cancelPermissionTimer(ctx: TrackerContext<CoreAgentState>, agentId: number): void {
  const timer = ctx.permissionTimers.get(agentId);
  if (timer) {
    clearTimeout(timer);
    ctx.permissionTimers.delete(agentId);
  }
}

export function startPermissionTimer(
  ctx: TrackerContext<CoreAgentState>,
  agentId: number,
  permissionExemptTools: Set<string>,
): void {
  cancelPermissionTimer(ctx, agentId);
  const timer = setTimeout(() => {
    ctx.permissionTimers.delete(agentId);
    const agent = ctx.agents.get(agentId);
    if (!agent) return;

    // Only flag if there are still active non-exempt tools (parent or sub-agent)
    let hasNonExempt = false;
    for (const toolId of agent.activeToolIds) {
      const toolName = agent.activeToolNames.get(toolId);
      if (!permissionExemptTools.has(toolName || '')) {
        hasNonExempt = true;
        break;
      }
    }

    // Check sub-agent tools for non-exempt tools
    const stuckSubagentParentToolIds: string[] = [];
    for (const [parentToolId, subToolNames] of agent.activeSubagentToolNames) {
      for (const [, toolName] of subToolNames) {
        if (!permissionExemptTools.has(toolName)) {
          stuckSubagentParentToolIds.push(parentToolId);
          hasNonExempt = true;
          break;
        }
      }
    }

    if (hasNonExempt) {
      agent.permissionSent = true;
      console.log(`[Pixel Agents] Agent ${agentId}: possible permission wait detected`);
      ctx.send({ type: 'agentToolPermission', id: agentId });
      // Also notify stuck sub-agents
      for (const parentToolId of stuckSubagentParentToolIds) {
        ctx.send({ type: 'subagentToolPermission', id: agentId, parentToolId });
      }
    }
  }, PERMISSION_TIMER_DELAY_MS);
  ctx.permissionTimers.set(agentId, timer);
}
