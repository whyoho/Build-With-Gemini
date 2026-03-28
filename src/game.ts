import type { Bomb, BombSymbol, Room, Solution, Wire, Player, Compartment, Screw } from "./types";
import { GAME_TIMER_SECONDS } from "./config";

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}

export function generateRoomId(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export function createGame(): { bomb: Bomb; solution: Solution; instructions: string[] } {
  const wireColors = ["blue", "yellow", "red", "green", "white"];
  const symbolData = [
    { name: "star", icon: "★" },
    { name: "circle", icon: "●" },
    { name: "triangle", icon: "▲" },
    { name: "diamond", icon: "◆" },
  ];

  const wires: Wire[] = wireColors.map((color, i) => ({ id: `wire-${i}`, color, cut: false }));
  const symbols: BombSymbol[] = symbolData.map((s, i) => ({
    id: `symbol-${i}`,
    name: s.name,
    icon: s.icon,
    active: false,
  }));

  const compartments: Compartment[] = [
    {
      id: "left-panel",
      name: "PRIMARY_CIRCUIT_HATCH",
      isOpen: false,
      screws: [
        { id: "scr-1", removed: false },
        { id: "scr-2", removed: false },
      ],
      contents: ["wire-0", "wire-1", "symbol-0"],
    },
    {
      id: "right-panel",
      name: "SECONDARY_SYMBOLS_CASE",
      isOpen: false,
      screws: [
        { id: "scr-3", removed: false },
        { id: "scr-4", removed: false },
      ],
      contents: ["wire-2", "wire-3", "wire-4", "symbol-1", "symbol-2", "symbol-3"],
    },
  ];

  const bomb: Bomb = { wires, symbols, compartments, timeLeft: GAME_TIMER_SECONDS };

  const wiresToCut = shuffle(wires.map((w) => w.id)).slice(0, 3);
  const symbolsToActivate = shuffle(symbols.map((s) => s.id)).slice(0, 2);

  // Interleave wires and symbols for a mixed sequence
  const combinedActions = [
    ...wiresToCut.map(id => ({ type: "wire" as const, id })),
    ...symbolsToActivate.map(id => ({ type: "symbol" as const, id }))
  ];
  const sequence = shuffle(combinedActions);

  const instructions = sequence.map((action, i) => {
    const isWire = action.type === "wire";
    const component = isWire 
      ? wires.find(w => w.id === action.id)!
      : symbols.find(s => s.id === action.id)!;
    
    const compartment = compartments.find(c => c.contents.includes(action.id))!;
    const name = isWire ? (component as Wire).color + " wire" : (component as BombSymbol).name + " symbol";
    
    return `${i + 1}. Find ${name} inside ${compartment.name} and ${isWire ? "cut" : "activate"} it.`;
  });

  return { bomb, solution: { sequence }, instructions };
}

export function checkWin(room: Room): boolean {
  return room.currentStepIndex === room.solution.sequence.length;
}

export function broadcastAll(room: Room, data: object) {
  const msg = JSON.stringify(data);
  for (const player of room.players.values()) {
    player.ws.send(msg);
  }
}

export function broadcast(room: Room, data: object, excludeId: string) {
  const msg = JSON.stringify(data);
  for (const [id, player] of room.players) {
    if (id !== excludeId) player.ws.send(msg);
  }
}

export function syncRoom(room: Room) {
  const status = {
    type: "room-status",
    players: [...room.players.values()].map(p => ({ role: p.role, sessionId: p.sessionId })),
    phase: room.phase
  };
  broadcastAll(room, status);
}

export function cleanupRoomPartial(room: Room) {
  if (room.timer) {
    clearInterval(room.timer);
    room.timer = undefined;
  }
  if (room.geminiLiveWs) {
    room.geminiLiveWs.close();
    room.geminiLiveWs = undefined;
  }
  room.phase = "waiting";
  room.geminiReady = false;
  room.chatHistory = [];
}
