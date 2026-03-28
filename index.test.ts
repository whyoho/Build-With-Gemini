import { test, expect, beforeAll, afterAll } from "bun:test";
import { server, rooms } from "./index";

const PORT = server.port;

test("Client receives welcome message with sessionId on connection", async () => {
  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === "welcome") {
          expect(msg.sessionId).toBeDefined();
          expect(typeof msg.sessionId).toBe("string");
          ws.close();
          resolve();
        }
      } catch (err) {
        reject(err);
      }
    };
    ws.onerror = reject;
    
    // Fallback timeout
    setTimeout(() => {
      ws.close();
      reject(new Error("Timeout waiting for welcome message"));
    }, 1000);
  });
});

test("Client can send leave-room message to clean up the room", async () => {
  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    
    let step = 0;
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === "welcome") {
          // Send create-room
          ws.send(JSON.stringify({ type: "create-room" }));
        } else if (msg.type === "room-created") {
          const roomId = msg.roomId;
          expect(rooms.has(roomId)).toBe(true);
          
          // Send leave-room
          ws.send(JSON.stringify({ type: "leave-room" }));
          
          setTimeout(() => {
            // Verify room is cleaned up
            expect(rooms.has(roomId)).toBe(false);
            ws.close();
            resolve();
          }, 100);
        }
      } catch (err) {
        reject(err);
      }
    };
    ws.onerror = reject;
    setTimeout(() => {
      ws.close();
      reject(new Error("Timeout in leave-room test"));
    }, 2000);
  });
});

test("Disconnecting one player from a 2-player game clears timer and closes Gemini WebSocket", async () => {
  const ws1 = new WebSocket(`ws://localhost:${PORT}/ws`);
  const ws2 = new WebSocket(`ws://localhost:${PORT}/ws`);

  let roomId: string | null = null;
  
  await new Promise<void>((resolve) => {
    let ws1Ready = false;
    let ws2Ready = false;
    ws1.onmessage = (e) => {
      const msg = JSON.parse(e.data as string);
      if (msg.type === "welcome") ws1.send(JSON.stringify({ type: "create-room" }));
      if (msg.type === "room-created") {
        roomId = msg.roomId;
        ws1Ready = true;
        if (ws1Ready && ws2Ready) resolve();
      }
    };
    ws2.onmessage = (e) => {
      const msg = JSON.parse(e.data as string);
      if (msg.type === "welcome") {
        ws2Ready = true;
        if (ws1Ready && ws2Ready) resolve();
      }
    };
  });

  ws2.send(JSON.stringify({ type: "join-room", roomId }));
  await new Promise<void>(resolve => {
    ws2.onmessage = (e) => {
      const msg = JSON.parse(e.data as string);
      if (msg.type === "room-joined") resolve();
    }
  });

  ws1.send(JSON.stringify({ type: "select-role", role: "mute" }));
  ws2.send(JSON.stringify({ type: "select-role", role: "deaf" }));
  
  await new Promise<void>(resolve => {
    ws1.onmessage = (e) => {
      const msg = JSON.parse(e.data as string);
      if (msg.type === "game-started") resolve();
    }
  });

  const room = rooms.get(roomId!)!;
  expect(room.phase).toBe("playing");
  expect(room.timer).toBeDefined();
  
  // mock gemini live ws to track close
  let closed = false;
  room.geminiLiveWs = { close: () => { closed = true; }, readyState: WebSocket.OPEN } as any;

  // disconnect ws2
  ws2.close();

  // wait a bit for close event to propagate
  await new Promise(resolve => setTimeout(resolve, 50));

  expect(room.players.size).toBe(1);
  expect(room.phase).toBe("waiting");
  expect(room.timer).toBeUndefined();
  expect(closed).toBe(true);
  expect(room.geminiLiveWs).toBeUndefined();
  
  ws1.close();
});

test("Game waits for gemini-ready before accepting frames/inputs", async () => {
  const ws1 = new WebSocket(`ws://localhost:${PORT}/ws`);
  const ws2 = new WebSocket(`ws://localhost:${PORT}/ws`);

  let roomId: string | null = null;
  
  await new Promise<void>((resolve) => {
    let ws1Ready = false;
    let ws2Ready = false;
    ws1.onmessage = (e) => {
      const msg = JSON.parse(e.data as string);
      if (msg.type === "welcome") ws1.send(JSON.stringify({ type: "create-room" }));
      if (msg.type === "room-created") {
        roomId = msg.roomId;
        ws1Ready = true;
        if (ws1Ready && ws2Ready) resolve();
      }
    };
    ws2.onmessage = (e) => {
      const msg = JSON.parse(e.data as string);
      if (msg.type === "welcome") {
        ws2Ready = true;
        if (ws1Ready && ws2Ready) resolve();
      }
    };
  });

  ws2.send(JSON.stringify({ type: "join-room", roomId }));
  await new Promise<void>(resolve => {
    ws2.onmessage = (e) => {
      const msg = JSON.parse(e.data as string);
      if (msg.type === "room-joined") resolve();
    }
  });

  ws1.send(JSON.stringify({ type: "select-role", role: "mute" }));
  ws2.send(JSON.stringify({ type: "select-role", role: "deaf" }));
  
  await new Promise<void>(resolve => {
    ws1.onmessage = (e) => {
      const msg = JSON.parse(e.data as string);
      if (msg.type === "game-started") resolve();
    }
  });

  const room = rooms.get(roomId!)!;
  room.geminiReady = false; // explicitly false

  // Track if we broadcasted anything in response to these messages
  let broadcasted = false;
  ws1.onmessage = (e) => {
    const msg = JSON.parse(e.data as string);
    // When a chat message is handled, it sends back a type: "chat-message" from "deaf" and "agent" or "agent-typing"
    if (msg.type === "chat-message" && msg.from === "deaf") {
      broadcasted = true;
    }
  };

  ws2.send(JSON.stringify({ type: "chat-message", content: "hello" }));
  ws1.send(JSON.stringify({ type: "webcam-frame", frame: "base64data" }));

  await new Promise(resolve => setTimeout(resolve, 50));

  expect(broadcasted).toBe(true);

  ws1.close();
  ws2.close();
});

