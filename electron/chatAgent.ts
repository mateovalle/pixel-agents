/**
 * SDK-driven chat sessions (Claude Agent SDK) for the Electron main process.
 *
 * Each chat agent runs query() with a streaming input queue. SDK messages
 * are reduced to the ChatEvent protocol the renderer knows how to draw, and
 * permission prompts become promises resolved by renderer button clicks.
 *
 * The SDK package is ESM-only while this process is CJS, so the runtime
 * import is dynamic; only types are imported statically.
 */

import type {
  Options,
  PermissionResult,
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk' with { 'resolution-mode': 'import' };
import * as path from 'path';

import type {
  AgentTodo,
  ChatEvent,
  ChatImageAttachment,
  ChatPermissionMode,
} from '../shared/protocol.js';
import type { Send } from '../src/core/types.js';

const CHAT_HISTORY_MAX_EVENTS = 2000;
const TOOL_SUMMARY_MAX_CHARS = 1500;
const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

type SdkModule = typeof import('@anthropic-ai/claude-agent-sdk', {
  with: { 'resolution-mode': 'import' },
});
let sdkPromise: Promise<SdkModule> | null = null;
function loadSdk(): Promise<SdkModule> {
  sdkPromise ??= import('@anthropic-ai/claude-agent-sdk');
  return sdkPromise;
}

interface InputStream {
  iterable: AsyncIterable<SDKUserMessage>;
  push: (m: SDKUserMessage) => void;
  end: () => void;
}

function createInputStream(): InputStream {
  const queue: SDKUserMessage[] = [];
  let notify: (() => void) | null = null;
  let ended = false;
  const iterable = (async function* () {
    for (;;) {
      while (queue.length === 0 && !ended) {
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }
      const next = queue.shift();
      if (next === undefined) {
        if (ended) return;
        continue;
      }
      yield next;
    }
  })();
  const wake = (): void => {
    notify?.();
    notify = null;
  };
  return {
    iterable,
    push: (m) => {
      queue.push(m);
      wake();
    },
    end: () => {
      ended = true;
      wake();
    },
  };
}

export interface ChatSession {
  agentId: number;
  sessionId: string;
  cwd: string;
  label: string;
  history: ChatEvent[];
  busy: boolean;
  /** Last time the user sent a prompt — used for /clear attribution. */
  lastInputAt: number;
  mode: ChatPermissionMode;
  /** Latest TodoWrite plan (resent on webviewReady). */
  latestTodos: AgentTodo[];
  send(text: string, images?: ChatImageAttachment[]): void;
  interrupt(): void;
  setMode(mode: ChatPermissionMode): void;
  respondPermission(requestId: string, allow: boolean, message?: string): void;
  dispose(): void;
}

export function startChatSession(opts: {
  agentId: number;
  sessionId: string;
  cwd: string;
  label: string;
  send: Send;
  /** When set, continue this existing session instead of starting fresh. */
  resume?: boolean;
  onExit: () => void;
  /** Called once per completed turn with the SDK's exact cost/duration. */
  onTurnComplete?: (costUsd: number, durationMs: number) => void;
}): ChatSession {
  const { agentId, sessionId, cwd, send } = opts;
  const input = createInputStream();
  const pendingPermissions = new Map<string, (r: PermissionResult) => void>();
  let query: Query | null = null;
  let disposed = false;

  const session: ChatSession = {
    agentId,
    sessionId,
    cwd,
    label: opts.label,
    history: [],
    busy: false,
    lastInputAt: Date.now(),
    mode: 'default',
    latestTodos: [],

    send(text: string, images?: ChatImageAttachment[]): void {
      if (disposed) return;
      session.lastInputAt = Date.now();
      const validImages = (images ?? []).filter((img) => SUPPORTED_IMAGE_TYPES.has(img.mediaType));
      emit({
        kind: 'user-text',
        text,
        ...(validImages.length > 0 ? { imageCount: validImages.length } : {}),
      });
      setBusy(true);
      input.push({
        type: 'user',
        message: {
          role: 'user',
          content: [
            ...validImages.map((img) => ({
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: img.mediaType as
                  'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
                data: img.data,
              },
            })),
            { type: 'text', text },
          ],
        },
        parent_tool_use_id: null,
        session_id: sessionId,
      });
    },

    interrupt(): void {
      void query?.interrupt().catch(() => {
        /* not running */
      });
    },

    setMode(mode: ChatPermissionMode): void {
      if (disposed) return;
      void (async () => {
        try {
          await query?.setPermissionMode(mode);
          session.mode = mode;
        } catch (err) {
          console.error(`[Pixel Agents] Chat ${agentId}: setPermissionMode failed`, err);
        }
        // Echo the authoritative mode either way so the UI reconciles
        send({ type: 'chat-mode', agentId, mode: session.mode });
      })();
    },

    respondPermission(requestId: string, allow: boolean, message?: string): void {
      const resolve = pendingPermissions.get(requestId);
      if (!resolve) return;
      pendingPermissions.delete(requestId);
      send({ type: 'chat-permission-resolved', agentId, requestId });
      resolve(
        allow
          ? { behavior: 'allow' }
          : { behavior: 'deny', message: message || 'The user declined this action.' },
      );
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      // Deny anything still waiting so the SDK isn't parked forever
      for (const [requestId, resolve] of pendingPermissions) {
        send({ type: 'chat-permission-resolved', agentId, requestId });
        resolve({ behavior: 'deny', message: 'Session closed.' });
      }
      pendingPermissions.clear();
      input.end();
      try {
        query?.close();
      } catch {
        /* already gone */
      }
    },
  };

  function emit(event: ChatEvent): void {
    session.history.push(event);
    if (session.history.length > CHAT_HISTORY_MAX_EVENTS) {
      session.history.splice(0, session.history.length - CHAT_HISTORY_MAX_EVENTS);
    }
    send({ type: 'chat-event', agentId, event });
  }

  function setBusy(busy: boolean): void {
    if (session.busy === busy) return;
    session.busy = busy;
    send({ type: 'chat-busy', agentId, busy });
  }

  function summarize(value: unknown): string {
    let text: string;
    if (typeof value === 'string') {
      text = value;
    } else {
      try {
        text = JSON.stringify(value, null, 2) ?? '';
      } catch {
        text = String(value);
      }
    }
    return text.length > TOOL_SUMMARY_MAX_CHARS
      ? text.slice(0, TOOL_SUMMARY_MAX_CHARS) + '\n… (truncated)'
      : text;
  }

  function handleMessage(msg: SDKMessage): void {
    if (msg.type === 'stream_event') {
      const event = msg.event;
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta' &&
        msg.parent_tool_use_id === null
      ) {
        emit({ kind: 'text-delta', text: event.delta.text });
      }
    } else if (msg.type === 'assistant') {
      if (msg.parent_tool_use_id !== null) return; // subagent traffic — office shows it
      for (const block of msg.message.content) {
        if (block.type === 'text' && block.text.trim()) {
          emit({ kind: 'block-final', block: 'text', text: block.text });
        } else if (block.type === 'thinking' && block.thinking.trim()) {
          emit({ kind: 'block-final', block: 'thinking', text: block.thinking });
        } else if (block.type === 'tool_use') {
          if (block.name === 'TodoWrite') {
            const todos = (block.input as { todos?: AgentTodo[] })?.todos;
            if (Array.isArray(todos)) {
              session.latestTodos = todos;
              send({ type: 'agent-todos', agentId, todos });
            }
          }
          emit({
            kind: 'tool-start',
            toolId: block.id,
            name: block.name,
            input: (block.input ?? {}) as Record<string, unknown>,
          });
        }
      }
    } else if (msg.type === 'user') {
      if (msg.parent_tool_use_id !== null) return;
      const content = msg.message.content;
      if (!Array.isArray(content)) return;
      for (const block of content) {
        if (typeof block === 'object' && block !== null && block.type === 'tool_result') {
          emit({
            kind: 'tool-result',
            toolId: block.tool_use_id,
            isError: !!block.is_error,
            summary: summarize(block.content),
          });
        }
      }
    } else if (msg.type === 'result') {
      setBusy(false);
      const costUsd = msg.total_cost_usd ?? 0;
      const durationMs = msg.duration_ms ?? 0;
      opts.onTurnComplete?.(costUsd, durationMs);
      emit({
        kind: 'turn-complete',
        costUsd,
        durationMs,
        isError: msg.is_error,
      });
    } else if (msg.type === 'system' && msg.subtype === 'compact_boundary') {
      emit({ kind: 'status', text: 'Context compacted' });
    } else if (msg.type === 'system' && msg.subtype === 'init') {
      send({ type: 'chat-mode', agentId, mode: session.mode });
    }
  }

  const sdkOptions: Options = {
    cwd,
    // Resuming continues the same session id (no fork), so the transcript
    // watcher registered on this id keeps working in both cases.
    ...(opts.resume ? { resume: sessionId } : { sessionId }),
    permissionMode: 'default',
    // Required for the Bypass option in the mode selector to be accepted;
    // sessions still START in 'default' — this only unlocks the switch.
    allowDangerouslySkipPermissions: true,
    includePartialMessages: true,
    canUseTool: (toolName, toolInput, callOpts) =>
      new Promise<PermissionResult>((resolve) => {
        if (disposed) {
          resolve({ behavior: 'deny', message: 'Session closed.' });
          return;
        }
        pendingPermissions.set(callOpts.requestId, resolve);
        send({
          type: 'chat-permission-request',
          agentId,
          requestId: callOpts.requestId,
          toolName,
          title: callOpts.title,
          description: callOpts.description,
          input: toolInput,
        });
        callOpts.signal.addEventListener('abort', () => {
          if (pendingPermissions.delete(callOpts.requestId)) {
            send({ type: 'chat-permission-resolved', agentId, requestId: callOpts.requestId });
            resolve({ behavior: 'deny', message: 'Cancelled.' });
          }
        });
      }),
  };

  void (async () => {
    try {
      const sdk = await loadSdk();
      query = sdk.query({ prompt: input.iterable, options: sdkOptions });
      for await (const msg of query) {
        if (disposed) break;
        try {
          handleMessage(msg);
        } catch (err) {
          console.error(`[Pixel Agents] Chat ${agentId}: bad message`, err);
        }
      }
    } catch (err) {
      if (!disposed) {
        console.error(`[Pixel Agents] Chat ${agentId} session error:`, err);
        emit({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      setBusy(false);
      if (!disposed) {
        emit({ kind: 'status', text: 'Session ended' });
        opts.onExit();
      }
    }
  })();

  console.log(
    `[Pixel Agents] Chat agent ${agentId}: session ${sessionId} in ${path.basename(cwd)}`,
  );
  return session;
}
