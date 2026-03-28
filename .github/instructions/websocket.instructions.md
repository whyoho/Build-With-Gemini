---
name: WebSocket Best Practices
description: "Use when: creating, editing, or debugging WebSocket connections, real-time sync, or socket event handlers."
applyTo: "**/*.ts, **/*.tsx"
---
# WebSocket Guidelines

When working with WebSockets in this project, strictly follow these rules to prevent memory leaks and ghost state:

- **Always Clean Up**: Implement `onclose` and `onerror` handlers to clean up resources, remove disconnected players from maps, and delete empty rooms.
- **Clear Timers**: Never orphan a `setInterval` or `setTimeout`. Always store the timer reference and explicitly call `clearInterval` when the socket disconnects, the player leaves, or the game state ends.
- **Graceful Disconnects**: When a player disconnects, broadcast the event to the remaining players so the UI can update accordingly.
- **State Validation**: Before sending a message or broadcasting to a room, always verify the room exists and the socket `readyState === WebSocket.OPEN`.
- **Deduplicate Event Listeners**: Ensure you aren't attaching multiple identical event listeners (or spawning duplicate timers) if a user reconnects or rejoins a room.
