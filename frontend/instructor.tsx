import { useState } from "react";
console.log("INSTRUCTOR FROM frontend/src LOADED");

type Props = {
  socket: WebSocket | null;
  roomId: string;
  instructions: string[];
};

function Instructor({ socket, instructions }: Props) {
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("Ready");

  const startSpeechRecognition = () => {
    try {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        setStatus("Socket not connected");
        return;
      }

      const SpeechRecognition =
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition;

      if (!SpeechRecognition) {
        setStatus("Speech recognition not supported in this browser");
        return;
      }

      const recognition = new SpeechRecognition();

      recognition.lang = "en-US";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        console.log("🎤 Speech recognition started");
        setListening(true);
        setStatus("Listening...");
      };

      recognition.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript?.trim();

        if (!transcript) {
          setStatus("Could not understand speech");
          return;
        }

        console.log("📝 Transcript:", transcript);

        if (!socket || socket.readyState !== WebSocket.OPEN) {
          setStatus("Socket disconnected before send");
          return;
        }

        socket.send(
          JSON.stringify({
            type: "chat",
            content: transcript,
          })
        );

        console.log("✅ Transcript sent to backend");
        setStatus(`Sent: "${transcript}"`);
      };

      recognition.onerror = (event: any) => {
        console.error("Speech recognition error:", event);
        setListening(false);

        if (event?.error === "not-allowed") {
          setStatus("Mic permission denied");
        } else if (event?.error === "no-speech") {
          setStatus("No speech detected");
        } else {
          setStatus(`Speech error: ${event?.error || "unknown"}`);
        }
      };

      recognition.onend = () => {
        console.log("🛑 Speech recognition ended");
        setListening(false);
      };

      recognition.start();
    } catch (err) {
      console.error(err);
      setListening(false);
      setStatus("Failed to start speech recognition");
    }
  };

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
      <h2 style={{ color: "#ffcc00", marginTop: 0 }}>Instructor</h2>

      <div style={{ marginBottom: "20px" }}>
        {instructions.map((instruction, index) => (
          <div
            key={index}
            style={{
              background: "#2a2a2a",
              padding: "12px",
              borderRadius: "10px",
              marginBottom: "10px",
              borderLeft: "4px solid #ffcc00",
            }}
          >
            <strong style={{ color: "#ffcc00" }}>{index + 1}.</strong>{" "}
            <span>{instruction}</span>
          </div>
        ))}
      </div>

      <button
        onClick={startSpeechRecognition}
        disabled={listening}
        style={{
          width: "100%",
          height: "68px",
          border: "none",
          borderRadius: "12px",
          backgroundColor: listening ? "#00d084" : "#ff234f",
          color: "white",
          fontSize: "20px",
          fontWeight: "bold",
          cursor: listening ? "not-allowed" : "pointer",
          opacity: listening ? 0.85 : 1,
        }}
      >
        {listening ? "🎙️ LISTENING..." : "🎤 CLICK TO SPEAK"}
      </button>

      <div style={{ marginTop: "14px", fontSize: "14px", color: "#ccc" }}>
        {status}
      </div>
    </div>
  );
}

export default Instructor;