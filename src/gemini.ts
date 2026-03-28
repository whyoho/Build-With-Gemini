import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Room } from "./types";
import { GEMINI_API_KEY, GEMINI_MODEL_CHAT, GEMINI_MODEL_LIVE } from "./config";
import { broadcastAll } from "./game";

const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

const SYSTEM_INSTRUCTION = `You are the Agent in a tense bomb defusal game.

You mediate between two players:
- DEAF player: has the instruction manual, types to you, cannot hear. They are your eyes on the manual.
- MUTE player: can see the bomb and act on it, cannot speak. They are your eyes on the bomb.
  You see the MUTE player via their webcam. You can see the bomb through their camera.

The bomb components:
- Wires: blue, yellow, red, green, white
- Symbols: star, circle, triangle, diamond
- Compartments: PRIMARY_CIRCUIT_HATCH (contains wires/symbols), SECONDARY_SYMBOLS_CASE (contains wires/symbols)

Your job: receive the DEAF player's instructions and relay them as urgent, precise commands to the MUTE player.
Use the webcam feed to guide the Mute player. If they haven't opened the right compartment, tell them to unscrew it first.

STRICT SEQUENCE: The MUTE player must follow instructions in the EXACT ORDER provided. Emphasize this.

Rules:
- Keep responses to 1-2 short sentences MAX.
- Be URGENT — there's a live bomb.
- Use clear format: "Cut the [COLOR] wire" or "Toggle the [SYMBOL] symbol ON/OFF".
- Never ask questions, just relay the instruction clearly.
- If you see the Mute player acting correctly, confirm it (e.g., "I see you're on the red wire, cut it!").`;

export async function handleGeminiChat(room: Room, userMessage: string): Promise<string> {
  if (!genAI) {
    console.log(`[Room ${room.id}] Gemini SDK: API Key missing, falling back to Relay`);
    return `[Agent] Relay: ${userMessage}`;
  }

  try {
    console.log(`[Room ${room.id}] Gemini SDK Call | Model: ${GEMINI_MODEL_CHAT} | Msg: ${userMessage}`);
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL_CHAT,
      systemInstruction: SYSTEM_INSTRUCTION,
    });

    const chat = model.startChat({ history: room.chatHistory });
    const result = await chat.sendMessage(userMessage);
    const response = result.response.text();

    console.log(`[Room ${room.id}] Gemini SDK Output: ${response}`);
    room.chatHistory.push(
      { role: "user", parts: [{ text: userMessage }] },
      { role: "model", parts: [{ text: response }] }
    );

    return response;
  } catch (err) {
    console.error(`[Room ${room.id}] Gemini SDK Error:`, err);
    return `[Agent] Relay: ${userMessage}`;
  }
}

export async function initGeminiLive(room: Room) {
  if (!GEMINI_API_KEY) {
    console.log(`[Room ${room.id}] Gemini Live: API Key missing, using Relay Mode`);
    room.isRelayMode = true;
    room.geminiReady = true;
    broadcastAll(room, { type: "gemini-ready" });
    return;
  }

  const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BiDiSession?key=${GEMINI_API_KEY}`;
  console.log(`[Room ${room.id}] Gemini Live: Connecting to ${url.split("?")[0]}`);
  const ws = new WebSocket(url);

  ws.onopen = () => {
    console.log(`[Room ${room.id}] Gemini Live session opening`);
    const setup = {
      setup: {
        model: GEMINI_MODEL_LIVE,
        generation_config: { response_modalities: ["text"] },
        system_instruction: {
          parts: [{ text: SYSTEM_INSTRUCTION + " You may also see the Mute player via their webcam, but focus on the instructions." }]
        }
      }
    };
    ws.send(JSON.stringify(setup));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string);
      if (msg.setupComplete) {
        room.geminiReady = true;
        console.log(`[Room ${room.id}] Gemini Live setup complete`);
        broadcastAll(room, { type: "gemini-ready" });
        broadcastAll(room, { type: "chat-message", from: "system", content: "Agent online and listening." });
      }
      const textParts = msg.serverContent?.modelTurn?.parts;
      if (textParts) {
        const text = textParts.map((p: any) => p.text || "").join("");
        if (text) {
          console.log(`[Room ${room.id}] Gemini Agent: ${text}`);
          broadcastAll(room, { type: "chat-message", from: "agent", content: text });
        }
      }
    } catch (err) {
      console.error("Gemini Live message error:", err);
    }
  };

  ws.onerror = (err) => {
    console.error(`[Room ${room.id}] Gemini Live error:`, err);
    room.isRelayMode = true;
    room.geminiReady = true;
    broadcastAll(room, { type: "gemini-ready" });
  };
  
  ws.onclose = () => {
    console.log(`[Room ${room.id}] Gemini Live session closed`);
    room.geminiLiveWs = undefined;
  };

  room.geminiLiveWs = ws;
}
