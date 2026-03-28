import indexHtml from "./public/index.html";
import { type ServerWebSocket } from "bun";
import type { WSData, Room } from "./src/types";
import { generateRoomId, createGame, broadcastAll, broadcast, syncRoom, cleanupRoomPartial, checkWin } from "./src/game";
import { handleGeminiChat, initGeminiLive } from "./src/gemini";

const rooms = new Map<string, Room>();

const server = Bun.serve<WSData>({
  routes: {
    "/": indexHtml,
    "/ws": (req: Request, server: ReturnType<typeof Bun.serve>) => {
      const ok = server.upgrade(req, {
        data: { sessionId: crypto.randomUUID(), roomId: null },
      });
      if (ok) return undefined as unknown as Response;
      return new Response("WebSocket upgrade required", { status: 426 });
    },
  },

  websocket: {
    open(ws) {
      ws.send(JSON.stringify({ type: "welcome", sessionId: ws.data.sessionId }));
    },

    async message(ws, raw) {
      let msg: Record<string, any>;
      try {
        msg = JSON.parse(raw as string);
      } catch {
        return;
      }

      const { sessionId, roomId } = ws.data;

      switch (msg.type) {
        // ── Room management ──────────────────────────────────────────────────
        case "leave-room": {
          if (!ws.data.roomId) return;
          const room = rooms.get(ws.data.roomId);
          if (!room) return;

          room.players.delete(sessionId);
          ws.data.roomId = null;
          cleanupRoomPartial(room);

          if (room.players.size === 0) {
            rooms.delete(room.id);
          } else {
            broadcast(room, { type: "player-disconnected" }, sessionId);
            syncRoom(room);
          }
          break;
        }

        case "create-room": {
          const id = generateRoomId();
          const { bomb, solution, instructions } = createGame();
          const room: Room = {
            id,
            players: new Map(),
            phase: "waiting",
            bomb,
            solution,
            instructions,
            currentStepIndex: 0,
            chatHistory: [],
            geminiReady: false,
          };
          room.players.set(sessionId, { ws, role: null, sessionId });
          rooms.set(id, room);
          ws.data.roomId = id;
          ws.send(JSON.stringify({ type: "room-created", roomId: id }));
          break;
        }

        case "join-room": {
          const room = rooms.get(msg.roomId);
          if (!room) {
            ws.send(JSON.stringify({ type: "error", message: "Room not found" }));
            return;
          }
          if (room.players.size >= 2) {
            ws.send(JSON.stringify({ type: "error", message: "Room is full" }));
            return;
          }
          room.players.set(sessionId, { ws, role: null, sessionId });
          ws.data.roomId = msg.roomId;
          ws.send(JSON.stringify({ type: "room-joined", roomId: msg.roomId }));
          broadcast(room, { type: "player-joined" }, sessionId);
          syncRoom(room);
          break;
        }

        // ── Role selection ───────────────────────────────────────────────────
        case "select-role": {
          const room = rooms.get(ws.data.roomId!);
          if (!room || room.phase === "playing" || room.phase === "failed") return;

          const player = room.players.get(sessionId);
          if (!player) return;

          if (msg.role !== null) {
            const roleTaken = [...room.players.values()].some(
              (p) => p.role === msg.role && p.sessionId !== sessionId
            );
            if (roleTaken) {
              ws.send(JSON.stringify({ type: "error", message: "Role taken" }));
              return;
            }
          }

          player.role = msg.role;
          syncRoom(room);

          const allReady =
            room.players.size === 2 &&
            [...room.players.values()].every((p) => p.role !== null);

          if (allReady) {
            room.phase = "playing";
            initGeminiLive(room);
            broadcastAll(room, { type: "chat-message", from: "system", content: "Agent initializing..." });
            for (const p of room.players.values()) {
              p.ws.send(
                JSON.stringify({
                  type: "game-started",
                  role: p.role,
                  bomb: room.bomb,
                  instructions: p.role === "deaf" ? room.instructions : null,
                })
              );
            }
            if (room.timer) clearInterval(room.timer);
            room.timer = setInterval(() => {
              room.bomb.timeLeft--;
              broadcastAll(room, { type: "tick", timeLeft: room.bomb.timeLeft });
              if (room.bomb.timeLeft <= 0) {
                clearInterval(room.timer);
                room.timer = undefined;
                room.phase = "failed";
                broadcastAll(room, { type: "game-over", won: false });
              }
            }, 1000);
          }
          break;
        }

        // ── Bomb actions (mute player) ────────────────────────────────────────
        case "cut-wire": {
          const room = rooms.get(ws.data.roomId!);
          if (!room || room.phase !== "playing") return;
          const wire = room.bomb.wires.find((w) => w.id === msg.wireId);
          if (!wire || wire.cut) return;

          const expected = room.solution.sequence[room.currentStepIndex];
          if (!expected || expected.type !== "wire" || expected.id !== msg.wireId) {
            if (room.timer) { clearInterval(room.timer); room.timer = undefined; }
            room.phase = "failed";
            broadcastAll(room, { type: "game-over", won: false });
            return;
          }

          wire.cut = true;
          room.currentStepIndex++;
          broadcastAll(room, { type: "wire-cut", wireId: msg.wireId });
          
          if (room.geminiLiveWs && room.geminiLiveWs.readyState === WebSocket.OPEN) {
            room.geminiLiveWs.send(JSON.stringify({
              client_content: {
                turns: [{ role: "user", parts: [{ text: `[SYSTEM] The Mute player has successfully cut the ${wire.color} wire.` }] }],
                turn_complete: true
              }
            }));
          }

          if (checkWin(room)) {
            if (room.timer) { clearInterval(room.timer); room.timer = undefined; }
            room.phase = "success";
            broadcastAll(room, { type: "game-over", won: true });
          }
          break;
        }

        case "toggle-symbol": {
          const room = rooms.get(ws.data.roomId!);
          if (!room || room.phase !== "playing") return;
          const symbol = room.bomb.symbols.find((s) => s.id === msg.symbolId);
          if (!symbol) return;

          const expected = room.solution.sequence[room.currentStepIndex];
          if (symbol.active) {
             // Deactivating is an error
             if (room.timer) { clearInterval(room.timer); room.timer = undefined; }
             room.phase = "failed";
             broadcastAll(room, { type: "game-over", won: false });
             return;
          }

          if (!expected || expected.type !== "symbol" || expected.id !== msg.symbolId) {
            if (room.timer) { clearInterval(room.timer); room.timer = undefined; }
            room.phase = "failed";
            broadcastAll(room, { type: "game-over", won: false });
            return;
          }

          symbol.active = true;
          room.currentStepIndex++;
          broadcastAll(room, { type: "symbol-toggled", symbolId: msg.symbolId, active: true });
          
          if (room.geminiLiveWs && room.geminiLiveWs.readyState === WebSocket.OPEN) {
            room.geminiLiveWs.send(JSON.stringify({
              client_content: {
                turns: [{ role: "user", parts: [{ text: `[SYSTEM] The Mute player has successfully toggled the ${symbol.name} symbol.` }] }],
                turn_complete: true
              }
            }));
          }

          if (checkWin(room)) {
            if (room.timer) { clearInterval(room.timer); room.timer = undefined; }
            room.phase = "success";
            broadcastAll(room, { type: "game-over", won: true });
          }
          break;
        }

        case "unscrew-screw": {
          const room = rooms.get(ws.data.roomId!);
          if (!room || room.phase !== "playing") return;

          let openedComp: string | null = null;
          for (const comp of room.bomb.compartments) {
            const screw = comp.screws.find(s => s.id === msg.screwId);
            if (screw) {
              screw.removed = true;
              if (comp.screws.every(s => s.removed) && !comp.isOpen) {
                comp.isOpen = true;
                openedComp = comp.name;
              }
              break;
            }
          }
          broadcastAll(room, { type: "bomb-updated", bomb: room.bomb });
          
          if (openedComp && room.geminiLiveWs && room.geminiLiveWs.readyState === WebSocket.OPEN) {
             room.geminiLiveWs.send(JSON.stringify({
               client_content: {
                 turns: [{ role: "user", parts: [{ text: `[SYSTEM] The Mute player has opened the ${openedComp}.` }] }],
                 turn_complete: true
               }
             }));
          }
          break;
        }

        // ── Chat & Webcam ────────────────────────────────────────────────────
        case "chat-message": {
          const room = rooms.get(ws.data.roomId!);
          if (!room || room.phase !== "playing") return;
          if (msg.content) {
            broadcastAll(room, { type: "chat-message", from: "deaf", content: msg.content });
            if (!room.geminiReady) return;
            
            if (room.geminiLiveWs && room.geminiLiveWs.readyState === WebSocket.OPEN) {
              room.geminiLiveWs.send(JSON.stringify({
                client_content: {
                  turns: [{ role: "user", parts: [{ text: msg.content }] }],
                  turn_complete: true
                }
              }));
            } else {
              broadcastAll(room, { type: "agent-typing", typing: true });
              const response = await handleGeminiChat(room, msg.content);
              broadcastAll(room, { type: "agent-typing", typing: false });
              broadcastAll(room, { type: "chat-message", from: "agent", content: response });
            }
          }
          break;
        }

        case "webcam-frame": {
          const room = rooms.get(ws.data.roomId!);
          if (!room || room.phase !== "playing" || !room.geminiReady) return;
          broadcast(room, { type: "webcam-frame", frame: msg.frame }, sessionId);
          if (room.geminiLiveWs && room.geminiLiveWs.readyState === WebSocket.OPEN) {
            room.geminiLiveWs.send(JSON.stringify({
              realtime_input: { media_chunks: [{ data: msg.frame, mime_type: "image/jpeg" }] }
            }));
          }
          break;
        }
      }
    },

    close(ws) {
      const { sessionId, roomId } = ws.data;
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;
      room.players.delete(sessionId);
      cleanupRoomPartial(room);
      if (room.players.size === 0) {
        rooms.delete(roomId);
      } else {
        broadcast(room, { type: "player-disconnected" }, "");
        syncRoom(room);
      }
    },
  },
  development: { hmr: true, console: true },
});

console.log(`Server running at http://localhost:${server.port}`);
export { server, rooms };
