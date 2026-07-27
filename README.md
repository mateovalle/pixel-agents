# Pixel Agents

**A pixel-art mission control for your Claude Code agents.** Every project is an office, every agent is a character you can watch work — and you orchestrate all of them from one campus.

> 🎬 _[demo GIF goes here — campus → click an office → assign a task → a character spawns and works → the task checks itself off]_

## What it does

- 🏢 **Campus view** — register your project folders as offices on one pannable pixel-art map. See at a glance who's working, who's waiting for you, and what each project is costing today.
- 💬 **Rich chat agents** — powered by the official Claude Agent SDK: streamed markdown, tool cards with real diffs, permission prompts as Allow/Deny buttons, permission modes (Ask / Accept Edits / Plan / Bypass), image paste & file drag-and-drop, session resume, exact per-turn cost.
- ✅ **Task orchestration** — per-workspace task lists shared between you and your agents. Assign a task with one click and an agent spawns to do it; agents can read the backlog, log discovered work, and check tasks off when they truly finish. Their live internal plans are mirrored in real time.
- 🤖 **The Assistant** — a campus-wide orchestrator with tools to read project status, backlogs and spending, and dispatch agents to any office by natural language.
- 💸 **Spend dashboard** — exact costs (from the SDK, not estimates) per turn, per day, per project; live on each office's label.
- 🏆 **Achievements** — milestones for shipped tasks, parallel agents and streaks (never for spend).
- 🎨 **Layout editor** — design each office: floors, walls, furniture, colors. Per-workspace layouts.

Sessions are **real Claude Code sessions** — same login, same config, same transcripts in `~/.claude/projects`. Start in the app, resume in your terminal, or vice versa. Nothing is locked in.

## Requirements

- [Claude Code](https://claude.com/claude-code) installed and logged in (`claude` on your PATH)
- Node.js 22+, macOS / Linux / Windows

## Quick start

```sh
npm install
cd webview-ui && npm install && cd ..
npm run dev        # Vite + Electron, hot reload
```

`npm start` builds and runs the production bundle; `npm run package` creates installers (dmg/AppImage/nsis).

> **Note on art assets:** some original sprite assets (floor patterns, furniture catalog) are privately licensed and not in this repo — offices render with basic tiles until a free asset pack lands ([issue #1](../../issues)). Characters and walls are included.

## Architecture (short version)

```
shared/protocol.ts   typed message protocol (host ↔ UI, discriminated unions)
src/core/            host-agnostic engine: transcript parsing, watchers, timers
electron/            main process: Agent SDK sessions, PTYs, workspaces, tasks, usage
webview-ui/          React + canvas: campus renderer, chat UI, layout editor
```

See [CLAUDE.md](CLAUDE.md) for the full map — it doubles as context if you contribute using Claude Code.

Gates: `npm run check` (types + lint), `npm test`. CI runs both plus builds.

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Good first issues are labeled; the roadmap lives in the issue tracker (checkpoint/rewind buttons, slash-command palette, `@`-file autocomplete, achievement furniture unlocks, free asset pack…).

## Credits & license

MIT. Started as a fork of [pablodelucca/pixel-agents](https://github.com/pablodelucca/pixel-agents) (the VS Code extension) — the office/character concept and pixel engine grew from that work; the desktop app, Agent SDK integration, campus, tasks and orchestration were built on top.
