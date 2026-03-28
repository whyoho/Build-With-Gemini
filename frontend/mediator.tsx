import { useEffect, useRef, useState } from "react";
console.log("MEDIATOR FROM frontend/src LOADED");

type Props = {
  socket: WebSocket | null;
  roomId: string;
};

function Mediator({ socket }: Props) {
  const [status, setStatus] = useState("Waiting for voice...");
  const [lastUrl, setLastUrl] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!socket) return;

    const handler = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "voice" && msg.dataUrl) {
          console.log("📨 Mediator received voice through WebSocket");

          setLastUrl(msg.dataUrl);
          setStatus("Voice received from other side");

          if (audioRef.current) {
            audioRef.current.src = msg.dataUrl;
          }
        }
      } catch (err) {
        console.error("Mediator parse error:", err);
      }
    };

    socket.addEventListener("message", handler);
    return () => socket.removeEventListener("message", handler);
  }, [socket]);

  return (
    <div
      style={{
        width: "420px",
        background: "#1b1b1b",
        borderRadius: "16px",
        padding: "20px",
        boxShadow: "0 0 20px rgba(0,0,0,0.35)",
      }}
    >
      <h2 style={{ color: "#66d9ff", marginTop: 0 }}>Mediator</h2>

      <div
        style={{
          background: "#2a2a2a",
          borderRadius: "12px",
          padding: "16px",
          minHeight: "180px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        <div style={{ color: "#ddd" }}>
          Status: <span style={{ color: "#fff" }}>{status}</span>
        </div>

        <audio ref={audioRef} controls style={{ width: "100%" }} />

        <button
          onClick={() => {
            if (audioRef.current && lastUrl) {
              audioRef.current.src = lastUrl;
              audioRef.current.play().catch((err) => console.error("Play failed:", err));
            }
          }}
          style={{
            width: "100%",
            height: "48px",
            border: "none",
            borderRadius: "10px",
            background: "#66d9ff",
            color: "#111",
            fontWeight: "bold",
            cursor: "pointer",
          }}
        >
          ▶ Play Last Voice
        </button>
      </div>
    </div>
  );
}

export default Mediator;