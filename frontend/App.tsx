import { useState, useEffect } from 'react';
import Instructor from './instructor';
import Mediator from './mediator';
console.log("APP FROM frontend/src LOADED");
console.log("REAL APP LOADED");
document.body.style.border = "8px solid red";


function App() {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [roomId] = useState("B8T5DR");
  const [instructions] = useState([
    "Cut the red wire first",
    "Toggle the star symbol ON"
  ]);

  useEffect(() => {
  const ws = new WebSocket("ws://localhost:3000/ws");

  ws.onopen = () => {
    console.log("✅ FRONTEND CONNECTED TO BACKEND");
  };

  ws.onclose = () => {
    console.log("❌ FRONTEND DISCONNECTED");
  };

  ws.onerror = (err) => {
    console.log("⚠️ SOCKET ERROR", err);
  };

  ws.onmessage = (msg) => {
    console.log("📨 MESSAGE FROM SERVER:", msg.data);
  };

  setSocket(ws);

  return () => {
    ws.close();
  };
}, []);

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "voice" && msg.dataUrl) {
          const audio = new Audio(msg.dataUrl);
          audio.play().catch((err) => console.error("play failed", err));
        }
      } catch (err) {
        console.error(err);
      }
    };

    socket.addEventListener("message", handleMessage);
    return () => socket.removeEventListener("message", handleMessage);
  }, [socket]);

  
  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#111',
        color: 'white',
        padding: '20px'
      }}
    >
      <h1 style={{ textAlign: 'center', color: '#ffcc00', marginBottom: '30px' }}>
        Bomb Communication Game
      </h1>

      <div
        style={{
          display: 'flex',
          gap: '20px',
          justifyContent: 'center',
          alignItems: 'flex-start',
          flexWrap: 'wrap'
        }}
      >
        <Instructor
          socket={socket}
          roomId={roomId}
          instructions={instructions}
        />

        <Mediator
          socket={socket}
          roomId={roomId}
        />
      </div>
    </div>
  );
}


export default App;