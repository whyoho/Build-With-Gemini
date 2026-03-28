import { type ServerWebSocket } from "bun";

export type WSData = { sessionId: string; roomId: string | null };

export interface Wire {
  id: string;
  color: string;
  cut: boolean;
}

export interface BombSymbol {
  id: string;
  name: string;
  icon: string;
  active: boolean;
}

export interface Screw {
  id: string;
  removed: boolean;
}

export interface Compartment {
  id: string;
  name: string;
  isOpen: boolean;
  screws: Screw[];
  contents: string[]; // list of wire/symbol IDs
}

export interface Bomb {
  wires: Wire[];
  symbols: BombSymbol[];
  compartments: Compartment[];
  timeLeft: number;
}

export interface Solution {
  sequence: Array<{ type: "wire" | "symbol"; id: string }>;
}

export interface Player {
  ws: ServerWebSocket<WSData>;
  role: "mute" | "deaf" | null;
  sessionId: string;
}

export interface Room {
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
  geminiReady: boolean;
  isRelayMode?: boolean;
}
