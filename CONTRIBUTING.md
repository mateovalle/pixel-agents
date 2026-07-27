# Contributing

Thanks for your interest! This project is young — issues, ideas and PRs are all welcome.

## Dev setup

```sh
npm install
cd webview-ui && npm install && cd ..
npm run dev      # Vite dev server + Electron with hot reload
```

Requires Node 22+ and a logged-in [Claude Code](https://claude.com/claude-code) (`claude` on PATH) to exercise agent features.

## Before you open a PR

```sh
npm run check    # typecheck (src, electron, webview) + lint
npm test         # core engine tests (vitest)
```

All three targets must stay green; CI enforces them. Husky runs lint-staged on commit.

## Ground rules

- **`shared/protocol.ts` is the contract** between the main process and the UI — add new message types there first; all targets typecheck against it.
- **No magic numbers inline** — constants live in `src/core/constants.ts`, `electron/main.ts` (top), or `webview-ui/src/constants.ts`.
- TypeScript strict everywhere; no `enum` (erasableSyntaxOnly); `import type` for type-only imports.
- Pixel aesthetic in UI: sharp corners, 2px borders, hard offset shadows, `--pixel-*` CSS vars.
- [CLAUDE.md](CLAUDE.md) is the architecture map — keep it updated when you change structure. It's also great context if you contribute using Claude Code itself.

## Good starting points

Check issues labeled `good first issue`. The broad roadmap: checkpoint/rewind buttons in chat, slash-command palette, `@`-file autocomplete, achievement-unlocked furniture, a free (CC0) office sprite pack to replace the private assets.
