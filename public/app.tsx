import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

// ── Types ────────────────────────────────────────────────────────────────────
type Role = "mute" | "deaf";
type GamePhase = "home" | "waiting" | "playing" | "game-over";

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

interface ChatMessage {
  id: string;
  from: "deaf" | "agent" | "system";
  content: string;
}

// ── WebSocket hook ────────────────────────────────────────────────────────────
function useGameWS(onMessage: (msg: Record<string, any>) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const onMsgRef = useRef(onMessage);
  onMsgRef.current = onMessage;

  const send = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    ws.onmessage = (e) => {
      try {
        onMsgRef.current(JSON.parse(e.data));
      } catch {}
    };
    wsRef.current = ws;
    return () => ws.close();
  }, []);

  return { send };
}

// ── Timer ────────────────────────────────────────────────────────────────────
function Timer({ timeLeft }: { timeLeft: number }) {
  const m = Math.floor(timeLeft / 60);
  const s = timeLeft % 60;
  const urgent = timeLeft <= 30;
  return (
    <div className={`timer ${urgent ? "timer--urgent" : ""}`}>
      <span className="timer__display">
        {String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
      </span>
      <span className="timer__label">TIME REMAINING</span>
    </div>
  );
}

// ── Webcam Capture (Mute player) ─────────────────────────────────────────────
function WebcamCapture({ onFrame }: { onFrame: (base64: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let interval: ReturnType<typeof setInterval>;

    async function setup() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240, frameRate: 5 },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        interval = setInterval(() => {
          if (videoRef.current && canvasRef.current) {
            const ctx = canvasRef.current.getContext("2d");
            if (ctx) {
              ctx.drawImage(videoRef.current, 0, 0, 320, 240);
              const base64 = canvasRef.current.toDataURL("image/jpeg", 0.5);
              onFrame(base64.split(",")[1]); // Strip prefix
            }
          }
        }, 1000); // 1 FPS for Gemini
      } catch (err) {
        console.error("Webcam error:", err);
      }
    }

    setup();
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
      clearInterval(interval);
    };
  }, [onFrame]);

  return (
    <div className="webcam-box webcam-box--capture">
      <div className="webcam-box__label">LIVE TRANSMISSION</div>
      <video ref={videoRef} autoPlay playsInline muted className="webcam-video" />
      <canvas ref={canvasRef} width={320} height={240} style={{ display: "none" }} />
      <div className="webcam-box__status">● STREAMING</div>
    </div>
  );
}

// ── Webcam Display (Deaf player) ─────────────────────────────────────────────
function WebcamDisplay({ frame }: { frame: string | null }) {
  return (
    <div className="webcam-box webcam-box--display">
      <div className="webcam-box__label">PARTNER FEED — ENCRYPTED</div>
      {frame ? (
        <img src={`data:image/jpeg;base64,${frame}`} className="webcam-video" alt="Partner webcam" />
      ) : (
        <div className="webcam-placeholder">
          <div className="webcam-placeholder__icon">📷</div>
          <div className="webcam-placeholder__text">Waiting for signal…</div>
        </div>
      )}
      <div className="webcam-box__status">● {frame ? "RECEIVING" : "NO SIGNAL"}</div>
    </div>
  );
}

// ── Bomb view (mute player) ───────────────────────────────────────────────────
function BombView({
  bomb,
  onCutWire,
  onToggleSymbol,
}: {
  bomb: Bomb;
  onCutWire: (id: string) => void;
  onToggleSymbol: (id: string) => void;
}) {
  return (
    <div className="bomb">
      <div className="bomb__header">
        <div className="bomb__led" />
        <span>EXPLOSIVE DEVICE — HANDLE WITH CARE</span>
        <div className="bomb__led" />
      </div>

      <div className="bomb__section">
        <h3 className="bomb__section-title">WIRES — click to cut</h3>
        <div className="bomb__wires">
          {bomb.wires.map((wire) => (
            <button
              key={wire.id}
              className={`wire wire--${wire.color} ${wire.cut ? "wire--cut" : ""}`}
              onClick={() => !wire.cut && onCutWire(wire.id)}
              disabled={wire.cut}
            >
              <span className="wire__dot" />
              <div className="wire__track">
                <div className="wire__line" />
                {wire.cut && <div className="wire__snip">✂</div>}
              </div>
              <span className="wire__label">{wire.color}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="bomb__section">
        <h3 className="bomb__section-title">SYMBOLS — click to toggle</h3>
        <div className="bomb__symbols">
          {bomb.symbols.map((sym) => (
            <button
              key={sym.id}
              className={`symbol-btn ${sym.active ? "symbol-btn--active" : ""}`}
              onClick={() => onToggleSymbol(sym.id)}
            >
              <span className="symbol-btn__icon">{sym.icon}</span>
              <span className="symbol-btn__name">{sym.name}</span>
              <span className={`symbol-btn__state ${sym.active ? "on" : "off"}`}>
                {sym.active ? "ON" : "OFF"}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Instruction cards (deaf player) ──────────────────────────────────────────
function InstructionCards({ instructions }: { instructions: string[] }) {
  return (
    <div className="instructions">
      <div className="instructions__badge">⚠ CLASSIFIED — DO NOT SHOW OTHER PLAYER</div>
      <h3 className="instructions__title">DEFUSAL INSTRUCTIONS</h3>
      <p className="instructions__sub">
        Read these to the Agent. They will relay them to the Mute player.
      </p>
      <div className="instructions__list">
        {instructions.map((text, i) => (
          <div key={i} className="icard">
            <span className="icard__num">{i + 1}</span>
            <span className="icard__text">{text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Chat ─────────────────────────────────────────────────────────────────────
function Chat({
  messages,
  onSend,
  role,
  agentTyping,
}: {
  messages: ChatMessage[];
  onSend: (msg: string) => void;
  role: Role;
  agentTyping: boolean;
}) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, agentTyping]);

  const submit = () => {
    const t = input.trim();
    if (t) {
      onSend(t);
      setInput("");
    }
  };

  return (
    <div className="chat">
      <div className="chat__header">
        <span className="chat__led" />
        <span>BLIND AGENT — SECURE CHANNEL</span>
      </div>

      <div className="chat__feed">
        {messages.length === 0 && (
          <div className="chat__empty">No transmissions yet…</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`cmsg cmsg--${m.from}`}>
            <span className="cmsg__who">
              {m.from === "deaf" ? "YOU" : m.from === "agent" ? "◉ AGENT" : "SYS"}
            </span>
            <p className="cmsg__body">{m.content}</p>
          </div>
        ))}
        {agentTyping && (
          <div className="cmsg cmsg--agent">
            <span className="cmsg__who">◉ AGENT</span>
            <p className="cmsg__body typing-dots">
              <span />
              <span />
              <span />
            </p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {role === "deaf" && (
        <div className="chat__input-row">
          <input
            className="chat__input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Tell the Agent what the instructions say…"
          />
          <button className="chat__send" onClick={submit}>
            SEND
          </button>
        </div>
      )}
      {role === "mute" && (
        <div className="chat__muted-notice">🔇 You are mute — you cannot send messages</div>
      )}
    </div>
  );
}

// ── Mute player view ──────────────────────────────────────────────────────────
function MuteView({
  bomb,
  messages,
  timeLeft,
  agentTyping,
  onCutWire,
  onToggleSymbol,
  onWebcamFrame,
}: {
  bomb: Bomb;
  messages: ChatMessage[];
  timeLeft: number;
  agentTyping: boolean;
  onCutWire: (id: string) => void;
  onToggleSymbol: (id: string) => void;
  onWebcamFrame: (frame: string) => void;
}) {
  return (
    <div className="game-view">
      <header className="game-header">
        <div className="role-badge role-badge--mute">
          <span className="role-badge__icon">🔇</span>
          <div>
            <div className="role-badge__name">MUTE</div>
            <div className="role-badge__hint">You see the bomb — follow Agent's orders</div>
          </div>
        </div>
        <Timer timeLeft={timeLeft} />
      </header>
      <div className="game-body">
        <div className="game-main">
          <BombView bomb={bomb} onCutWire={onCutWire} onToggleSymbol={onToggleSymbol} />
          <WebcamCapture onFrame={onWebcamFrame} />
        </div>
        <Chat messages={messages} onSend={() => {}} role="mute" agentTyping={agentTyping} />
      </div>
    </div>
  );
}

// ── Deaf player view ──────────────────────────────────────────────────────────
function DeafView({
  instructions,
  messages,
  timeLeft,
  agentTyping,
  onSend,
  partnerFrame,
}: {
  instructions: string[];
  messages: ChatMessage[];
  timeLeft: number;
  agentTyping: boolean;
  onSend: (msg: string) => void;
  partnerFrame: string | null;
}) {
  return (
    <div className="game-view">
      <header className="game-header">
        <div className="role-badge role-badge--deaf">
          <span className="role-badge__icon">🔕</span>
          <div>
            <div className="role-badge__name">DEAF</div>
            <div className="role-badge__hint">You have the manual — tell the Agent</div>
          </div>
        </div>
        <Timer timeLeft={timeLeft} />
      </header>
      <div className="game-body">
        <div className="game-main">
          <InstructionCards instructions={instructions} />
          <WebcamDisplay frame={partnerFrame} />
        </div>
        <Chat messages={messages} onSend={onSend} role="deaf" agentTyping={agentTyping} />
      </div>
    </div>
  );
}

// ── Home screen ───────────────────────────────────────────────────────────────
function HomeScreen({
  onCreateRoom,
  onJoinRoom,
}: {
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
}) {
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState("");

  return (
    <div className="home">
      <div className="home__hero">
        <div className="home__bomb">💣</div>
        <h1 className="home__title">DEFUSE</h1>
        <p className="home__tagline">
          A 2-player communication challenge. One sees the bomb. One has the instructions.
          <br />
          Neither can do it alone.
        </p>
      </div>

      <div className="home__actions">
        <button className="btn btn--danger btn--lg" onClick={onCreateRoom}>
          CREATE ROOM
        </button>
        <div className="home__sep">— or —</div>
        {!joining ? (
          <button className="btn btn--ghost btn--lg" onClick={() => setJoining(true)}>
            JOIN ROOM
          </button>
        ) : (
          <div className="home__join-row">
            <input
              className="input input--code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
              onKeyDown={(e) => e.key === "Enter" && code.length === 6 && onJoinRoom(code)}
              placeholder="ROOM CODE"
              maxLength={6}
              autoFocus
            />
            <button
              className="btn btn--danger"
              onClick={() => onJoinRoom(code)}
              disabled={code.length !== 6}
            >
              JOIN
            </button>
          </div>
        )}
      </div>

      <div className="home__roles">
        <div className="hcard">
          <span className="hcard__icon">🔇</span>
          <h3 className="hcard__title">MUTE</h3>
          <p className="hcard__desc">
            You see the bomb and can interact with it — but you cannot speak. Follow the Agent's
            relayed instructions exactly.
          </p>
        </div>
        <div className="hcard hcard--center">
          <span className="hcard__icon">🤖</span>
          <h3 className="hcard__title">BLIND AGENT</h3>
          <p className="hcard__desc">
            Powered by Gemini AI. Receives instructions from the Deaf player and relays them to the
            Mute player in real time.
          </p>
        </div>
        <div className="hcard">
          <span className="hcard__icon">🔕</span>
          <h3 className="hcard__title">DEAF</h3>
          <p className="hcard__desc">
            You have the defusal manual — but you cannot hear. Type what you read to the Agent, who
            will pass it along.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Waiting / role-selection screen ──────────────────────────────────────────
function WaitingScreen({
  roomId,
  myRole,
  partnerJoined,
  partnerRole,
  onSelectRole,
}: {
  roomId: string;
  myRole: Role | null;
  partnerJoined: boolean;
  partnerRole: Role | null;
  onSelectRole: (r: Role) => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(roomId).catch(() => fallbackCopy(roomId));
    } else {
      fallbackCopy(roomId);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fallbackCopy = (text: string) => {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  };

  const muteTaken = partnerRole === "mute";
  const deafTaken = partnerRole === "deaf";

  return (
    <div className="waiting">
      <div className="waiting__code-block">
        <span className="waiting__code-label">ROOM CODE</span>
        <button className="waiting__code" onClick={copy}>
          {roomId}
          <span className="waiting__copy-btn">{copied ? "✓" : "COPY"}</span>
        </button>
        <span className="waiting__code-hint">Share with your partner to let them join</span>
      </div>

      {!myRole ? (
        <div className="waiting__role-select">
          <h3 className="waiting__select-title">
            {partnerJoined
              ? "Your partner is here — choose your role:"
              : "Choose your role (your partner can still join):"}
          </h3>
          <div className="waiting__role-cards">
            <button
              className={`role-pick ${muteTaken ? "role-pick--taken" : ""}`}
              onClick={() => !muteTaken && onSelectRole("mute")}
              disabled={muteTaken}
            >
              <span className="role-pick__icon">🔇</span>
              <span className="role-pick__name">MUTE</span>
              <span className="role-pick__desc">
                {muteTaken ? "Taken by partner" : "I'll operate the bomb"}
              </span>
            </button>
            <button
              className={`role-pick ${deafTaken ? "role-pick--taken" : ""}`}
              onClick={() => !deafTaken && onSelectRole("deaf")}
              disabled={deafTaken}
            >
              <span className="role-pick__icon">🔕</span>
              <span className="role-pick__name">DEAF</span>
              <span className="role-pick__desc">
                {deafTaken ? "Taken by partner" : "I'll have the instructions"}
              </span>
            </button>
          </div>
        </div>
      ) : (
        <div className="waiting__selected">
          <div className="waiting__selected-badge">
            {myRole === "mute" ? "🔇 MUTE" : "🔕 DEAF"}
          </div>
          <p className="waiting__selected-hint">Role locked in</p>
          <div className="waiting__status">
            {!partnerJoined ? (
              <span className="waiting__pulse">Waiting for your partner to join…</span>
            ) : partnerRole === null ? (
              <span className="waiting__pulse">Waiting for your partner to select a role…</span>
            ) : (
              <span className="waiting__pulse">Starting game…</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Game over screen ──────────────────────────────────────────────────────────
function GameOverScreen({ won, onPlayAgain }: { won: boolean; onPlayAgain: () => void }) {
  return (
    <div className="gameover">
      <div className={`gameover__card ${won ? "gameover__card--won" : "gameover__card--lost"}`}>
        <div className="gameover__icon">{won ? "✅" : "💥"}</div>
        <h1 className="gameover__title">{won ? "DEFUSED!" : "BOOM!"}</h1>
        <p className="gameover__sub">
          {won
            ? "The bomb has been defused. Excellent teamwork!"
            : "The bomb exploded. Better communication next time."}
        </p>
        <button className="btn btn--danger btn--lg" onClick={onPlayAgain}>
          PLAY AGAIN
        </button>
      </div>
    </div>
  );
}

// ── Error toast ───────────────────────────────────────────────────────────────
function Toast({ message }: { message: string }) {
  return <div className="toast">{message}</div>;
}

// ── Main App ──────────────────────────────────────────────────────────────────
function App() {
  const [phase, setPhase] = useState<GamePhase>("home");
  const [roomId, setRoomId] = useState("");
  const [myRole, setMyRole] = useState<Role | null>(null);
  const [partnerJoined, setPartnerJoined] = useState(false);
  const [partnerRole, setPartnerRole] = useState<Role | null>(null);
  const [bomb, setBomb] = useState<Bomb | null>(null);
  const [timeLeft, setTimeLeft] = useState(180);
  const [instructions, setInstructions] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [agentTyping, setAgentTyping] = useState(false);
  const [gameWon, setGameWon] = useState(false);
  const [error, setError] = useState("");
  const [partnerFrame, setPartnerFrame] = useState<string | null>(null);

  const addMsg = (from: ChatMessage["from"], content: string) =>
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), from, content }]);

  const showError = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(""), 3000);
  };

  const { send } = useGameWS((msg) => {
    switch (msg.type) {
      case "room-created":
        setRoomId(msg.roomId);
        setPhase("waiting");
        break;
      case "room-joined":
        setRoomId(msg.roomId);
        setPhase("waiting");
        break;
      case "player-joined":
        setPartnerJoined(true);
        break;
      case "partner-role-selected":
        setPartnerRole(msg.role);
        break;
      case "game-started":
        setMyRole(msg.role);
        setBomb(msg.bomb);
        setTimeLeft(msg.bomb.timeLeft);
        if (msg.instructions) setInstructions(msg.instructions);
        setPhase("playing");
        addMsg(
          "system",
          msg.role === "mute"
            ? "Game started. Wait for the Agent's instructions, then act on the bomb."
            : "Game started. Read your instruction cards to the Agent."
        );
        break;
      case "tick":
        setTimeLeft(msg.timeLeft);
        break;
      case "wire-cut":
        setBomb((prev) =>
          prev
            ? { ...prev, wires: prev.wires.map((w) => (w.id === msg.wireId ? { ...w, cut: true } : w)) }
            : null
        );
        break;
      case "symbol-toggled":
        setBomb((prev) =>
          prev
            ? {
                ...prev,
                symbols: prev.symbols.map((s) =>
                  s.id === msg.symbolId ? { ...s, active: msg.active } : s
                ),
              }
            : null
        );
        break;
      case "chat-message":
        addMsg(msg.from, msg.content);
        break;
      case "agent-typing":
        setAgentTyping(msg.typing);
        break;
      case "game-over":
        setGameWon(msg.won);
        setPhase("game-over");
        break;
      case "webcam-frame":
        setPartnerFrame(msg.frame);
        break;
      case "player-disconnected":
        addMsg("system", "⚠ Your partner disconnected.");
        break;
      case "error":
        showError(msg.message);
        break;
    }
  });

  const reset = () => {
    setPhase("home");
    setRoomId("");
    setMyRole(null);
    setPartnerJoined(false);
    setPartnerRole(null);
    setBomb(null);
    setTimeLeft(180);
    setInstructions([]);
    setMessages([]);
    setAgentTyping(false);
    setPartnerFrame(null);
  };

  return (
    <div className="app">
      {error && <Toast message={error} />}

      {phase === "home" && (
        <HomeScreen
          onCreateRoom={() => send({ type: "create-room" })}
          onJoinRoom={(code) => send({ type: "join-room", roomId: code })}
        />
      )}

      {phase === "waiting" && (
        <WaitingScreen
          roomId={roomId}
          myRole={myRole}
          partnerJoined={partnerJoined}
          partnerRole={partnerRole}
          onSelectRole={(r) => {
            setMyRole(r);
            send({ type: "select-role", role: r });
          }}
        />
      )}

      {phase === "playing" && bomb && myRole === "mute" && (
        <MuteView
          bomb={bomb}
          messages={messages}
          timeLeft={timeLeft}
          agentTyping={agentTyping}
          onCutWire={(id) => send({ type: "cut-wire", wireId: id })}
          onToggleSymbol={(id) => send({ type: "toggle-symbol", symbolId: id })}
          onWebcamFrame={(frame) => send({ type: "webcam-frame", frame })}
        />
      )}

      {phase === "playing" && bomb && myRole === "deaf" && (
        <DeafView
          instructions={instructions}
          messages={messages}
          timeLeft={timeLeft}
          agentTyping={agentTyping}
          onSend={(content) => send({ type: "chat", content })}
          partnerFrame={partnerFrame}
        />
      )}

      {phase === "game-over" && <GameOverScreen won={gameWon} onPlayAgain={reset} />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
