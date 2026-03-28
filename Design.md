# Build-With-Gemini Design Document

## Overview

This app is a cooperative bomb-defusal game built on Bun with a WebSocket multiplayer model and optional Google Gemini live model + chat pipeline.

Players:
- `deaf`: has the text-based instruction list but cannot see the bomb.
- `mute`: can see the bomb state and can act (cut wire/toggle symbol) but cannot talk.
- `agent` (Gemini): receives `deaf` instructions, converts them into concise actionable steps for `mute`.

Game flow:
- User creates or joins a room.
- Two players select roles (`deaf`, `mute`).
- Game starts, timer counts down from 180 seconds.
- Deaf text instructions are routed through Gemini agent to Mute.
- Mute must execute actions exactly in sequence.
- Win when all actions complete before time runs out; lose on invalid move or timeout.

## Goals

- Real-time multiplayer coordination experience
- Demonstrate usage of Google Generative AI (`@google/generative-ai` and WebSocket BiDi session)
- Use Bun server with WebSocket and static route handling
- Provide configurable model endpoint and key from env var `GEMINI_API_KEY`

## File-level feature mapping

- `index.ts`: core server, game logic, WebSocket message handlers, Gemini integration
- `public/index.html`, `public/app.tsx`, `public/styles.css`: frontend UI

## Data models

- `WSData`: sessionId, roomId
- `Wire`, `BombSymbol`, `Bomb`, `Solution`, `Player`, `Room`

## Room lifecycle

1. `create-room` -> generate `Room` + game state + 1st player
2. `join-room` -> add second player
3. `select-role` -> assign roles, start game when both ready
4. `broadcastAll` and `syncRoom` for status updates
5. Timer and win/fail checks
6. Close cleanup (clear interval, close Gemini WS, remove room)

## Action flow

- `cut-wire`, `toggle-symbol`: validate expected sequence in `room.solution.sequence`, update state, broadcast events, check win.
- invalid action -> immediate fail.

## Chat flow

- `chat` message from deaf
- Send to Gemini live WebSocket if available, otherwise fallback to `handleGeminiChat` with `@google/generative-ai` client
- `handleGeminiChat` uses `gemini-2.0-flash` model + system instruction for urgent commands
- result returned to all players as agent message

## Gemini integrations

1. SDK: `GoogleGenerativeAI` init with env key; `model.startChat` style
2. WebSocket BiDi: `generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BiDiSession?key=<key>`
3. `initGeminiLive` sets up WS callbacks to forward agent text to `mute` and adds realtime frame updates by sending `realtime_input.media_chunks`.

## Configuration points (centralize next step)

- `GEMINI_API_KEY` env var
- Model names used in `handleGeminiChat` and `initGeminiLive`:
  - `gemini-2.0-flash`
  - `models/gemini-2.0-flash-exp`
- Timer length: 180s
- room id length 6

## Logging requirements (non-inline data)

- `console.log`, `console.error` are used, but should be improved with an info logger.
- track:
  - function entry/exit with params
  - Gemini API calls (model, prompt, config)
  - Gemini outputs

## Compliance with your guidelines

To align with your rules, recommended immediate refactors:
- create feature-specific files:
  - `src/game.ts` for game state + rules
  - `src/ws.ts` for socket handlers
  - `src/gemini.ts` for agent integration
  - `src/config.ts` for constants
- add docstrings for each function in TS
- add per-file header comments (done naturally in new file). In `index.ts` we’ll convert all functions into documented exports.
- maintain this `Design.md` at root (done).
- centralize model names, RW behaviors as constants in `config.ts`
- test script entrypoint e.g. `bun test` and in `tests/` to verify all logic without mutating production: room creation, sequence validation, win/loss.

## API / events list

WebSocket inbound event types:
- `create-room`, `join-room`, `select-role`, `cut-wire`, `toggle-symbol`, `chat`, `webcam-frame`

WebSocket outbound event types:
- `room-created`, `room-joined`, `player-joined`, `room-status`, `game-started`, `tick`, `game-over`, `wire-cut`, `symbol-toggled`, `chat-message`, `agent-typing`, `player-disconnected`

## Next implementation tasks

1. Add `src/config.ts` and move constants
2. Break `index.ts` into `game`, `gemini`, `websocket` modules with docstrings
3. Add request-level logger `src/logger.ts` using `console.info` for now
4. Add tests under `tests/` for game rule validation and chat fallback.

---

### Quick run

`bun install`
`bun run index.ts` or `bun --hot ./index.ts`

### Paths

- `/` serves `public/index.html`
- `/ws` upgrades to WebSocket
