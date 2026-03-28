import indexHtml from "./public/index.html";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { type ServerWebSocket } from "bun";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

// ── Types ────────────────────────────────────────────────────────────────────
type WSData = { sessionId: string; roomId: string | null };

interface Wire {
  id: string;
  color: string;
  cut: boolean;
}

interface BombSymbol {
  id: string;
  name: string;
  icon: string;
  active: boolean;
}

interface Bomb {
  wires: Wire[];
  symbols: BombSymbol[];
  timeLeft: number;
}

interface Solution {
  sequence: Array<{ type: "wire" | "symbol"; id: string }>;
}

interface Player {
  ws: ServerWebSocket<WSData>;
  role: "mute" | "deaf" | null;
  sessionId: string;
}

interface Room {
  id: string;
  players: Map<string, Player>;
  phase: "waiting" | "playing" | "success" | "failed";
  bomb: Bomb;
  solution: Solution;
  instructions: string[];
  currentStepIndex: number;
  timer?: ReturnType<typeof setInterval>;
  chatHistory: Array<{ role: string; parts: Array<{ text: string }> }>;
  geminiLiveWs?: WebSocket;
}

// ── Game logic ───────────────────────────────────────────────────────────────
const rooms = new Map<string, Room>();

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}

function generateRoomId(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createGame(): { bomb: Bomb; solution: Solution; instructions: string[] } {
  const wireColors = ["blue", "red", "green", "white"];
  const symbolData = [
    { name: "alpha", icon: "α" },
    { name: "pi", icon: "π" },
    { name: "lambda", icon: "λ" },
  ];

  const wires: Wire[] = wireColors.map((color, i) => ({ id: `wire-${i}`, color, cut: false }));
  const symbols: BombSymbol[] = symbolData.map((s, i) => ({
    id: `symbol-${i}`,
    name: s.name,
    icon: s.icon,
    active: false,
  }));

  const bomb: Bomb = { wires, symbols, timeLeft: 180 };

  const wiresToCut = shuffle(wires.map((w) => w.id)).slice(0, 2);
  const symbolsToActivate = shuffle(symbols.map((s) => s.id)).slice(0, 2);

  // Interleave wires and symbols for a mixed sequence
  const combinedActions = [
    ...wiresToCut.map(id => ({ type: "wire" as const, id })),
    ...symbolsToActivate.map(id => ({ type: "symbol" as const, id }))
  ];
  const sequence = shuffle(combinedActions);

  const instructions = sequence.map((action, i) => {
    if (action.type === "wire") {
      const wire = wires.find(w => w.id === action.id)!;
      return `${i + 1}. Cut the ${wire.color} wire`;
    } else {
      const sym = symbols.find(s => s.id === action.id)!;
      return `${i + 1}. Toggle the ${sym.name} symbol ON`;
    }
  });

  return { bomb, solution: { sequence }, instructions };
}

function broadcastAll(room: Room, data: object) {
  const msg = JSON.stringify(data);
  for (const player of room.players.values()) player.ws.send(msg);
}

function broadcast(room: Room, data: object, excludeId: string) {
  const msg = JSON.stringify(data);
  for (const [id, player] of room.players) {
    if (id !== excludeId) player.ws.send(msg);
  }
}

function checkWin(room: Room): boolean {
  return room.currentStepIndex === room.solution.sequence.length;
}

async function handleGeminiChat(room: Room, userMessage: string): Promise<string> {
  if (!genAI) return `[Agent] Relay: ${userMessage}`;

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      systemInstruction: `You are the Blind Agent in a tense bomb defusal game. You cannot see the bomb.

You mediate between two players:
- DEAF player: has the instruction manual, types to you, cannot hear
- MUTE player: can see the bomb and act on it, cannot speak

Your job: receive the DEAF player's instructions and relay them as urgent, precise commands to the MUTE player.

STRICT SEQUENCE: The MUTE player must follow instructions in the EXACT ORDER provided. Emphasize this.

Rules:
- Keep responses to 1-2 short sentences MAX
- Be URGENT — there's a live bomb
- Use clear format: "Cut the [COLOR] wire" or "Toggle the [SYMBOL] symbol ON/OFF"
- Never ask questions, just relay the instruction clearly`,
    });

    const chat = model.startChat({ history: room.chatHistory });
    const result = await chat.sendMessage(userMessage);
    const response = result.response.text();

    room.chatHistory.push(
      { role: "user", parts: [{ text: userMessage }] },
      { role: "model", parts: [{ text: response }] }
    );

    return response;
  } catch (err) {
    console.error("Gemini error:", err);
    return `[Agent] Relay: ${userMessage}`;
  }
}

async function initGeminiLive(room: Room) {
  if (!GEMINI_API_KEY) return;

  const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BiDiSession?key=${GEMINI_API_KEY}`;
  const ws = new WebSocket(url);

  ws.onopen = () => {
    console.log(`[Room ${room.id}] Gemini Live session opened`);
    const setup = {
      setup: {
        model: "models/gemini-2.0-flash-exp",
        generation_config: { response_modalities: ["text"] },
        system_instruction: {
          parts: [{ text: `You are the Blind Agent in a tense bomb defusal game. You cannot see the bomb, but you can see the Mute player via their webcam.

You mediate between two players:
- DEAF player: has the instruction manual, types to you, cannot hear
- MUTE player: can see the bomb and act on it, cannot speak. You see their face/motions via webcam.

STRICT SEQUENCE: The MUTE player must follow instructions in the EXACT ORDER provided. Emphasize this.

Your job: receive the DEAF player's instructions and relay them as urgent, precise commands to the MUTE player.

Rules:
- Keep responses to 1-2 short sentences MAX
- Be URGENT — there's a live bomb
- Use clear format: "Cut the [COLOR] wire" or "Toggle the [SYMBOL] symbol ON/OFF"
- Never ask questions, just relay the instruction clearly` }]
        }
      }
    };
    ws.send(JSON.stringify(setup));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string);
      if (msg.serverContent?.modelTurn?.parts?.[0]?.text) {
        const text = msg.serverContent.modelTurn.parts[0].text;
        console.log(`[Room ${room.id}] Gemini: ${text}`);
        broadcastAll(room, { type: "chat-message", from: "agent", content: text });
      }
    } catch (err) {
      console.error("Gemini Live message error:", err);
    }
  };

  ws.onerror = (err) => console.error(`[Room ${room.id}] Gemini Live error:`, err);
  ws.onclose = () => {
    console.log(`[Room ${room.id}] Gemini Live session closed`);
    room.geminiLiveWs = undefined;
  };

  room.geminiLiveWs = ws;
}

function syncRoom(room: Room) {
  const status = {
    type: "room-status",
    players: [...room.players.values()].map(p => ({ role: p.role, sessionId: p.sessionId })),
    phase: room.phase
  };
  broadcastAll(room, status);
}

// ── Server ───────────────────────────────────────────────────────────────────
const server = Bun.serve<WSData>({
  routes: {
    "/": indexHtml,
    "/assets/*": async (req: Request) => {
      const url = new URL(req.url);
      const file = Bun.file(`./public${decodeURIComponent(url.pathname)}`);
      if (await file.exists()) return new Response(file);
      return new Response("Not found", { status: 404 });
    },
    "/ws": (req: Request, server: ReturnType<typeof Bun.serve>) => {
      const ok = server.upgrade(req, {
        data: { sessionId: crypto.randomUUID(), roomId: null },
      });
      if (ok) return undefined as unknown as Response;
      return new Response("WebSocket upgrade required", { status: 426 });
    },
  },

  websocket: {
    open(ws) {},

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
          if (!room) return;

          const player = room.players.get(sessionId);
          if (!player) return;

          if (msg.role !== null) {
            const roleTaken = [...room.players.values()].some(
              (p) => p.role === msg.role && p.sessionId !== sessionId
            );
            if (roleTaken) {
              ws.send(JSON.stringify({ type: "error", message: "Role already taken by your partner" }));
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
            broadcastAll(room, { type: "chat-message", from: "system", content: "Initializing Blind Agent..." });
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
            room.timer = setInterval(() => {
              room.bomb.timeLeft--;
              broadcastAll(room, { type: "tick", timeLeft: room.bomb.timeLeft });
              if (room.bomb.timeLeft <= 0) {
                clearInterval(room.timer);
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

          // Validate sequence
          const expected = room.solution.sequence[room.currentStepIndex];
          if (!expected || expected.type !== "wire" || expected.id !== msg.wireId) {
            console.log(`[Room ${room.id}] Wrong wire or sequence! Expected: ${JSON.stringify(expected)}, Got: wire ${msg.wireId}`);
            clearInterval(room.timer);
            room.phase = "failed";
            broadcastAll(room, { type: "game-over", won: false });
            return;
          }

          wire.cut = true;
          room.currentStepIndex++;
          broadcastAll(room, { type: "wire-cut", wireId: msg.wireId });
          
          if (checkWin(room)) {
            clearInterval(room.timer);
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

          // Validate sequence
          const wasActive = symbol.active;
          const expected = room.solution.sequence[room.currentStepIndex];

          if (!wasActive) {
            // Turning ON
            if (!expected || expected.type !== "symbol" || expected.id !== msg.symbolId) {
              console.log(`[Room ${room.id}] Wrong symbol or sequence! Expected: ${JSON.stringify(expected)}, Got: symbol ${msg.symbolId}`);
              clearInterval(room.timer);
              room.phase = "failed";
              broadcastAll(room, { type: "game-over", won: false });
              return;
            }
            symbol.active = true;
            room.currentStepIndex++;
          } else {
            // Turning OFF is always an error per user rules
            console.log(`[Room ${room.id}] Symbol deactivated! BOOM.`);
            clearInterval(room.timer);
            room.phase = "failed";
            broadcastAll(room, { type: "game-over", won: false });
            return;
          }

          broadcastAll(room, {
            type: "symbol-toggled",
            symbolId: msg.symbolId,
            active: symbol.active,
          });

          if (checkWin(room)) {
            clearInterval(room.timer);
            room.phase = "success";
            broadcastAll(room, { type: "game-over", won: true });
          }
          break;
        }

        // ── Chat (deaf → Gemini → mute) ──────────────────────────────────────
        case "chat": {
          const room = rooms.get(ws.data.roomId!);
          if (!room || room.phase !== "playing") return;

          ws.send(JSON.stringify({ type: "chat-message", from: "deaf", content: msg.content }));
          
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
          break;
        }

        case "webcam-frame": {
          const room = rooms.get(ws.data.roomId!);
          if (!room || room.phase !== "playing") return;
          broadcast(room, { type: "webcam-frame", frame: msg.frame }, sessionId);
          if (room.geminiLiveWs && room.geminiLiveWs.readyState === WebSocket.OPEN) {
            room.geminiLiveWs.send(JSON.stringify({
              realtime_input: {
                media_chunks: [{
                  data: msg.frame,
                  mime_type: "image/jpeg"
                }]
              }
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
      if (room.players.size === 0) {
        clearInterval(room.timer);
        room.geminiLiveWs?.close();
        rooms.delete(roomId);
      } else {
        broadcast(room, { type: "player-disconnected" }, "");
      }
    },
  },

  development: { hmr: true, console: true },
});

console.log(`Server running at http://localhost:${server.port}`);
