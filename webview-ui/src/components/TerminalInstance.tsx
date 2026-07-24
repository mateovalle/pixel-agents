import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { getElectronAPI } from '../vscodeApi.js';

interface TerminalInstanceProps {
  ptyId: string;
  visible: boolean;
}

export function TerminalInstance({ ptyId, visible }: TerminalInstanceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const api = getElectronAPI();
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"Menlo", "Monaco", "Courier New", monospace',
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: '#585b70',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#f5c2e7',
        cyan: '#94e2d5',
        white: '#bac2de',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#f5c2e7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    termRef.current = term;
    fitRef.current = fitAddon;

    // Fit after a brief delay to let layout settle
    setTimeout(() => fitAddon.fit(), 50);

    // Forward user input to PTY
    term.onData((data) => {
      api?.ptyInput?.(ptyId, data);
    });

    // Forward resize to PTY (debounced)
    term.onResize(({ cols, rows }) => {
      api?.ptyResize?.(ptyId, cols, rows);
    });

    // Listen for PTY output
    const handler = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'pty-output' && msg.ptyId === ptyId) {
        term.write(msg.data);
      } else if (msg.type === 'pty-exit' && msg.ptyId === ptyId) {
        term.write(`\r\n\x1b[90m[Process exited with code ${msg.exitCode}]\x1b[0m\r\n`);
      }
    };
    window.addEventListener('message', handler);

    // ResizeObserver for container
    const observer = new ResizeObserver(() => {
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = setTimeout(() => {
        try {
          fitAddon.fit();
        } catch {
          // Terminal may not be visible
        }
      }, 100);
    });
    observer.observe(container);

    return () => {
      window.removeEventListener('message', handler);
      observer.disconnect();
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      term.dispose();
    };
  }, [ptyId]);

  // Re-fit when visibility changes
  useEffect(() => {
    if (visible && fitRef.current) {
      setTimeout(() => {
        try {
          fitRef.current?.fit();
        } catch {
          // ignore
        }
      }, 50);
    }
  }, [visible]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        display: visible ? 'block' : 'none',
      }}
    />
  );
}
