import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Float, ContactShadows, PresentationControls, Text, Html, PerspectiveCamera, Environment } from "@react-three/drei";
import "./styles.css";

// ── Audio Context ─────────────────────────────────────────────────────────────
let audioCtx: AudioContext | null = null;
const getAudioCtx = () => {
  if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
};

const playTone = (freq: number, type: OscillatorType, duration: number, vol: number = 0.1) => {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {}
};

const playTick = (urgent: boolean) => playTone(urgent ? 800 : 400, "sine", 0.1, urgent ? 0.2 : 0.05);
const playCut = () => { playTone(200, "sawtooth", 0.2, 0.2); playTone(800, "square", 0.1, 0.1); };
const playToggle = () => playTone(600, "sine", 0.15, 0.1);
const playExplosion = () => { playTone(100, "sawtooth", 2.0, 0.5); playTone(50, "square", 2.0, 0.5); };
const playWin = () => { playTone(400, "sine", 0.2, 0.1); setTimeout(() => playTone(600, "sine", 0.4, 0.1), 200); };
const playMsg = () => playTone(800, "sine", 0.05, 0.05);

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

interface Screw {
  id: string;
  removed: boolean;
}

interface Compartment {
  id: string;
  name: string;
  isOpen: boolean;
  screws: Screw[];
  contents: string[];
}

interface Bomb {
  wires: Wire[];
  symbols: BombSymbol[];
  compartments: Compartment[];
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

// ── Speech Recognition ────────────────────────────────────────────────────────
function useSpeechRecognition(onResult: (text: string, isFinal: boolean) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false; // Stop automatically on pause
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onresult = (event: any) => {
        let interimTranscript = "";
        let finalTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
        
        if (finalTranscript) {
          onResult(finalTranscript, true);
        } else if (interimTranscript) {
          onResult(interimTranscript, false);
        }
      };

      recognition.onerror = (event: any) => {
        console.error("Speech recognition error", event.error);
        setError(`Mic error: ${event.error}`);
        setIsRecording(false);
      };

      recognition.onend = () => {
        setIsRecording(false);
        onResult("", false);
      };

      recognitionRef.current = recognition;
    }
  }, [onResult]);

  const startRecording = useCallback(async () => {
    if (recognitionRef.current && !isRecording) {
      setError(null);
      try {
        recognitionRef.current.start();
        setIsRecording(true);
      } catch (e: any) {
        console.error("Speech recognition start error", e);
        setError(e.message || "Failed to start mic");
        setIsRecording(false);
      }
    }
  }, [isRecording]);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current && isRecording) {
      try {
        recognitionRef.current.stop();
        setIsRecording(false);
      } catch (err) {
        // ignore
      }
    }
  }, [isRecording]);

  return { isRecording, startRecording, stopRecording, error, supported: !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) };
}

// ── Timer ────────────────────────────────────────────────────────────────────
function Timer({ timeLeft }: { timeLeft: number }) {
  const m = Math.floor(timeLeft / 60);
  const s = timeLeft % 60;
  const urgent = timeLeft <= 30;

  useEffect(() => {
    if (timeLeft > 0 && timeLeft < 180) {
      playTick(urgent);
    }
  }, [timeLeft, urgent]);

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
  const onFrameRef = useRef(onFrame);

  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

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
              onFrameRef.current(base64.split(",")[1] || ""); // Strip prefix
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
  }, []);

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

// ── 3D Bomb Components ──────────────────────────────────────────────────────
function ScrewModel({ screw, onUnscrew }: { screw: Screw; onUnscrew: () => void }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHover] = useState(false);
  const [holding, setHolding] = useState(false);
  const holdProgress = useRef(0);

  useFrame((state, delta) => {
    if (meshRef.current && !screw.removed) {
      if (holding) {
        meshRef.current.rotation.y += 15 * delta;
        holdProgress.current += delta;
        meshRef.current.position.z = holdProgress.current * 0.08;
        if (holdProgress.current > 1.0) {
          setHolding(false);
          onUnscrew();
        }
      } else {
        holdProgress.current = Math.max(0, holdProgress.current - delta * 2);
        meshRef.current.position.z = holdProgress.current * 0.08;
        meshRef.current.rotation.y += hovered ? 0.05 : 0;
      }
    }
  });

  if (screw.removed) return null;

  return (
    <group
      onPointerOver={() => setHover(true)}
      onPointerOut={() => {
        setHover(false);
        // Only stop holding if pointer leaves but NOT if it's captured
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        (e.target as any).setPointerCapture(e.pointerId);
        setHolding(true);
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        (e.target as any).releasePointerCapture(e.pointerId);
        setHolding(false);
      }}
    >
      {/* Invisible larger hitbox for easier interaction */}
      <mesh visible={false} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.12, 0.12, 0.1, 16]} />
      </mesh>

      <mesh ref={meshRef} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 0.04, 16]} />
        <meshStandardMaterial color={holding ? "#fff" : hovered ? "gold" : "#888"} roughness={0.1} metalness={1} />
        {/* Slot for screw */}
        <mesh position={[0, 0.021, 0]}>
          <boxGeometry args={[0.06, 0.005, 0.005]} />
          <meshStandardMaterial color="#222" />
        </mesh>
      </mesh>

      {hovered && (
        <Text position={[0, 0.08, 0.02]} fontSize={0.03} color={holding ? "#00e87a" : "white"} outlineWidth={0.003} outlineColor="black" anchorY="bottom">
          {holding ? `UNSCREWING... ${Math.floor(holdProgress.current * 100)}%` : "HOLD TO UNSCREW"}
        </Text>
      )}
    </group>
  );
}

function CompartmentModel({
  comp,
  wires,
  symbols,
  onCutWire,
  onToggleSymbol,
  onUnscrewScrew,
}: {
  comp: Compartment;
  wires: Wire[];
  symbols: BombSymbol[];
  onCutWire: (id: string) => void;
  onToggleSymbol: (id: string) => void;
  onUnscrewScrew: (id: string) => void;
}) {
  const [zoom, setZoom] = useState(false);

  return (
    <group position={comp.id === "left-panel" ? [-0.4, 0, -0.2] : [0.4, 0, -0.2]} rotation={[0, Math.PI, 0]}>
      {/* The Panel/Hatch */}
      {!comp.isOpen && (
        <mesh onClick={() => setZoom(!zoom)}>
          <boxGeometry args={[0.5, 0.8, 0.05]} />
          <meshStandardMaterial color="#222" metalness={0.8} roughness={0.2} />
          
          {/* Screws */}
          {comp.screws.map((s, i) => (
            <group key={s.id} position={[0, i === 0 ? 0.3 : -0.3, 0.025]}>
              <ScrewModel screw={s} onUnscrew={() => onUnscrewScrew(s.id)} />
            </group>
          ))}
          
          <Text position={[0, 0.45, 0.03]} fontSize={0.05} color="#aaa" anchorY="bottom">
            {comp.name}
          </Text>
        </mesh>
      )}

      {/* Internal Contents */}
      {comp.isOpen && (
        <group position={[0, 0, -0.05]}>
          <mesh>
            <boxGeometry args={[0.6, 0.9, 0.1]} />
            <meshStandardMaterial color="#111" />
          </mesh>
          
          {comp.contents.map((cid, i) => {
            const w = wires.find((w) => w.id === cid);
            const s = symbols.find((s) => s.id === cid);
            
            if (w) {
              return (
                <mesh
                  key={w.id}
                  position={[0, i * 0.2 - 0.3, 0.06]}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!w.cut) {
                      playCut();
                      onCutWire(w.id);
                    }
                  }}
                >
                  <boxGeometry args={[0.4, 0.05, 0.05]} />
                  <meshStandardMaterial color={w.cut ? "#333" : w.color} />
                  {w.cut && (
                     <Text position={[0, 0, 0.05]} fontSize={0.06} color="white">
                       ✂
                     </Text>
                  )}
                </mesh>
              );
            }
            if (s) {
              return (
                <group key={s.id} position={[0, i * 0.2 - 0.3, 0.06]}>
                  <mesh
                    onClick={(e) => {
                      e.stopPropagation();
                      playToggle();
                      onToggleSymbol(s.id);
                    }}
                  >
                    <boxGeometry args={[0.2, 0.15, 0.02]} />
                    <meshStandardMaterial color={s.active ? "#00e87a" : "#222"} metalness={0.5} roughness={0.5} />
                  </mesh>
                  <Text position={[0, 0, 0.015]} fontSize={0.08} color={s.active ? "black" : "white"}>
                    {s.icon}
                  </Text>
                </group>
              );
            }
            return null;
          })}
        </group>
      )}
    </group>
  );
}

function Bomb3D({
  bomb,
  onCutWire,
  onToggleSymbol,
  onUnscrewScrew,
}: {
  bomb: Bomb;
  onCutWire: (id: string) => void;
  onToggleSymbol: (id: string) => void;
  onUnscrewScrew: (id: string) => void;
}) {
  return (
    <div className="bomb-canvas-container">
      <Canvas shadows camera={{ position: [0, 0, 2.5], fov: 50 }}>
        <color attach="background" args={["#080810"]} />
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} intensity={1} castShadow />
        <pointLight position={[-10, 10, -10]} intensity={1} />
        <spotLight position={[-10, 10, 10]} angle={0.15} penumbra={1} />
        
        <PresentationControls
          global
          snap={false}
          rotation={[0, 0.3, 0]}
          polar={[-Math.PI / 3, Math.PI / 3]}
          azimuth={[-Math.PI * 1.5, Math.PI * 1.5]}
        >
          <Float speed={1.5} rotationIntensity={0.5} floatIntensity={0.5}>
            <group>
              {/* Main Body */}
              <mesh castShadow receiveShadow>
                <boxGeometry args={[1.5, 1, 0.4]} />
                <meshStandardMaterial color="#333" metalness={0.5} roughness={0.5} />
              </mesh>

              {/* Central Timer Display */}
              <mesh position={[0, 0, 0.21]}>
                <boxGeometry args={[0.6, 0.3, 0.02]} />
                <meshStandardMaterial color="#000" />
                <Text
                  position={[0, 0, 0.015]}
                  fontSize={0.2}
                  color={bomb.timeLeft <= 30 ? "#ff2244" : "#00e87a"}
                  anchorX="center"
                  anchorY="middle"
                >
                  {Math.floor(bomb.timeLeft / 60)}:{String(bomb.timeLeft % 60).padStart(2, "0")}
                </Text>
              </mesh>

              {/* Decorative Wires */}
              {[...Array(8)].map((_, i) => (
                <mesh key={i} position={[(i % 3 - 1) * 0.5, 0.45, (i % 2 - 0.5) * 0.3]}>
                  <torusGeometry args={[0.1, 0.01, 8, 16]} />
                  <meshStandardMaterial color={i % 2 === 0 ? "red" : "black"} />
                </mesh>
              ))}

              {/* Compartments */}
              {bomb.compartments.map((comp) => (
                <CompartmentModel
                  key={comp.id}
                  comp={comp}
                  wires={bomb.wires}
                  symbols={bomb.symbols}
                  onCutWire={onCutWire}
                  onToggleSymbol={onToggleSymbol}
                  onUnscrewScrew={onUnscrewScrew}
                />
              ))}
            </group>
          </Float>
        </PresentationControls>

        <ContactShadows position={[0, -0.8, 0]} opacity={0.4} scale={10} blur={2.5} far={2} />
        <Environment preset="city" />
      </Canvas>
      <div className="canvas-hint">DRAG TO ROTATE • SCROLL TO ZOOM</div>
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
  agentReady,
}: {
  messages: ChatMessage[];
  onSend: (msg: string) => void;
  role: Role;
  agentTyping: boolean;
  agentReady: boolean;
}) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const [interimText, setInterimText] = useState("");

  const { isRecording, startRecording, stopRecording, error, supported } = useSpeechRecognition(
    useCallback((text, isFinal) => {
      if (isFinal) {
        setInput((prev) => (prev ? prev + " " + text.trim() : text.trim()));
        setInterimText("");
      } else {
        setInterimText(text.trim());
      }
    }, [])
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, agentTyping, interimText]);

  const submit = () => {
    if (!agentReady) return;
    const t = input.trim();
    if (t) {
      onSend(t);
      setInput("");
      setInterimText("");
    }
  };

  return (
    <div className="chat">
      <div className="chat__header">
        <span className={`chat__led ${agentReady ? "chat__led--ready" : ""}`} />
        <span>BLIND AGENT — {agentReady ? "SECURE CHANNEL" : "INITIALIZING..."}</span>
      </div>

      <div className="chat__feed">
        {messages.length === 0 && !interimText && (
          <div className="chat__empty">No transmissions yet…</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`cmsg cmsg--${m.from}`}>
            <span className="cmsg__who">
              {m.from === "deaf" ? (role === "deaf" ? "YOU" : "DEAF") : m.from === "agent" ? "◉ AGENT" : "SYS"}
            </span>
            <p className="cmsg__body">{m.content}</p>
          </div>
        ))}
        {interimText && role === "deaf" && (
          <div className="cmsg cmsg--deaf">
            <span className="cmsg__who">YOU (Speaking)</span>
            <p className="cmsg__body" style={{ fontStyle: "italic", opacity: 0.7 }}>
              {interimText}
            </p>
          </div>
        )}
        {error && role === "deaf" && (
          <div className="cmsg cmsg--system" style={{ color: "var(--red)" }}>
            <span className="cmsg__who">MIC ERROR</span>
            <p className="cmsg__body">{error}</p>
          </div>
        )}
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

      <div className="chat__input-row">
        {role === "deaf" && supported && agentReady && (
          <button
            className={`chat__mic ${isRecording ? "chat__mic--recording" : ""}`}
            onClick={isRecording ? stopRecording : startRecording}
            title={isRecording ? "Stop recording" : "Click to speak"}
          >
            🎤
          </button>
        )}
        <input
          className="chat__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={agentReady ? (role === "deaf" ? (isRecording ? "Listening..." : "Type or click 🎤 to speak...") : "Read only...") : "Waiting for agent..."}
          disabled={role !== "deaf" || !agentReady}
        />
        {role === "deaf" && <button className="chat__send" onClick={submit} disabled={!agentReady || !input.trim()}>SEND</button>}
      </div>
    </div>
  );
}

// ── Mute player view ──────────────────────────────────────────────────────────
function LatestInstruction({ message }: { message?: ChatMessage }) {
  if (!message) return null;
  return (
    <div className="latest-instruction">
      <div className="latest-instruction__label">AGENT COMMAND</div>
      <div className="latest-instruction__content">{message.content}</div>
    </div>
  );
}

function MuteView({
  bomb,
  messages,
  timeLeft,
  agentTyping,
  agentReady,
  onCutWire,
  onToggleSymbol,
  onUnscrewScrew,
  onWebcamFrame,
}: {
  bomb: Bomb;
  messages: ChatMessage[];
  timeLeft: number;
  agentTyping: boolean;
  agentReady: boolean;
  onCutWire: (id: string) => void;
  onToggleSymbol: (id: string) => void;
  onUnscrewScrew: (id: string) => void;
  onWebcamFrame: (frame: string) => void;
}) {
  const latestAgentMsg = [...messages].reverse().find(m => m.from === "agent");

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
          <LatestInstruction message={latestAgentMsg} />
          <Bomb3D bomb={bomb} onCutWire={onCutWire} onToggleSymbol={onToggleSymbol} onUnscrewScrew={onUnscrewScrew} />
          <WebcamCapture onFrame={(frame) => { if (agentReady) onWebcamFrame(frame); }} />
        </div>
        <Chat messages={messages} onSend={() => {}} role="mute" agentTyping={agentTyping} agentReady={agentReady} />
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
  agentReady,
  onSend,
  partnerFrame,
}: {
  instructions: string[];
  messages: ChatMessage[];
  timeLeft: number;
  agentTyping: boolean;
  agentReady: boolean;
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
        <Chat messages={messages} onSend={onSend} role="deaf" agentTyping={agentTyping} agentReady={agentReady} />
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
  onSelectRole: (r: Role | null) => void;
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
              {muteTaken && <div className="role-pick__badge">PARTNER</div>}
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
              {deafTaken && <div className="role-pick__badge">PARTNER</div>}
            </button>
          </div>
        </div>
      ) : (
        <div className="waiting__selected">
          <div className="waiting__selected-badge">
            {myRole === "mute" ? "🔇 MUTE" : "🔕 DEAF"}
          </div>
          <p className="waiting__selected-hint">Role locked in</p>
          <button className="btn btn--ghost btn--sm" onClick={() => onSelectRole(null)}>
            CHANGE ROLE / CANCEL
          </button>
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

// ── Mock Veo Generator ────────────────────────────────────────────────────────
function useMockVeoVideo() {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);

  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    let animationId: number;

    const draw = () => {
      frame++;
      
      // Manila paper background
      ctx.fillStyle = "#e8dcc5";
      ctx.fillRect(0, 0, 1024, 1024);

      // Faded grid
      ctx.strokeStyle = "rgba(0, 0, 0, 0.05)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 1024; i += 32) {
        ctx.moveTo(i, 0); ctx.lineTo(i, 1024);
        ctx.moveTo(0, i); ctx.lineTo(1024, i);
      }
      ctx.stroke();

      // Top Secret Stamp
      ctx.save();
      ctx.translate(512, 300);
      ctx.rotate(-0.1);
      ctx.fillStyle = "rgba(200, 30, 30, 0.6)";
      ctx.font = "bold 90px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.fillText("TOP SECRET", 0, 0);
      
      // Stamp box
      ctx.strokeStyle = "rgba(200, 30, 30, 0.6)";
      ctx.lineWidth = 8;
      ctx.strokeRect(-280, -80, 560, 110);
      ctx.restore();

      // Bomb Schematic Circles
      ctx.save();
      ctx.translate(512, 700);
      ctx.rotate(frame * 0.005);
      ctx.strokeStyle = "rgba(40, 40, 40, 0.6)";
      ctx.lineWidth = 3;
      ctx.setLineDash([15, 10]);
      ctx.beginPath();
      ctx.arc(0, 0, 200, 0, Math.PI * 2);
      ctx.stroke();

      ctx.rotate(-frame * 0.01);
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, 150, 0, Math.PI * 2);
      ctx.stroke();
      
      // Crosshairs
      ctx.beginPath();
      ctx.moveTo(-220, 0); ctx.lineTo(220, 0);
      ctx.moveTo(0, -220); ctx.lineTo(0, 220);
      ctx.stroke();
      ctx.restore();

      // Typewriter text
      ctx.fillStyle = "rgba(40, 40, 40, 0.8)";
      ctx.font = "bold 24px 'Courier New', monospace";
      ctx.textAlign = "left";
      ctx.fillText("DEFUSAL MANUAL v1.4.2", 80, 120);
      ctx.fillText("MODULE ID: " + Math.floor(frame / 10 % 99999).toString().padStart(5, '0'), 80, 160);
      ctx.fillText("WARNING: HANDLE WITH EXTREME CARE", 80, 200);
      
      // Animated noise/dirt (simulate worn paper)
      for (let i = 0; i < 500; i++) {
        ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.04})`;
        ctx.fillRect(Math.random() * 1024, Math.random() * 1024, 3, 3);
      }

      animationId = requestAnimationFrame(draw);
    };
    draw();

    // Type casting needed as TS doesn't know about captureStream on HTMLCanvasElement in some environments
    const stream = (canvas as any).captureStream(30);
    const vid = document.createElement("video");
    vid.srcObject = stream;
    vid.crossOrigin = "Anonymous";
    vid.loop = true;
    vid.muted = true;
    vid.playsInline = true;
    vid.play().catch(() => console.log("Video play blocked"));
    
    setVideo(vid);

    return () => {
      cancelAnimationFrame(animationId);
      vid.pause();
      vid.srcObject = null;
    };
  }, []);

  return video;
}

// ── Veo 3D Background Components ──────────────────────────────────────────────
function VeoScreen({ video }: { video: HTMLVideoElement }) {
  const groupRef = useRef<THREE.Group>(null);
  const [videoTexture, setVideoTexture] = useState<THREE.VideoTexture | null>(null);

  useEffect(() => {
    if (video) {
      const tex = new THREE.VideoTexture(video);
      tex.colorSpace = THREE.SRGBColorSpace;
      setVideoTexture(tex);
    }
  }, [video]);

  useFrame((state, delta) => {
    if (groupRef.current) {
      // Gentle floating animation to give it a 3D presence without being distracting
      groupRef.current.position.y = Math.sin(state.clock.elapsedTime * 0.5) * 0.3;
      groupRef.current.position.x = Math.sin(state.clock.elapsedTime * 0.3) * 0.1;
      groupRef.current.rotation.x = -0.1 + Math.sin(state.clock.elapsedTime * 0.4) * 0.05;
      groupRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.2) * 0.05;
      groupRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.1) * 0.02;
    }
  });

  if (!videoTexture) return null;

  return (
    <group ref={groupRef} position={[0, 0, -4]}>
      {/* The main document page */}
      <mesh>
        <planeGeometry args={[14, 14]} />
        <meshBasicMaterial map={videoTexture} />
      </mesh>
      
      {/* A second page slightly offset behind it for depth */}
      <mesh position={[0.2, -0.2, -0.5]} rotation={[0, 0, -0.05]}>
        <planeGeometry args={[14, 14]} />
        <meshBasicMaterial color="#d4c5ab" />
      </mesh>
    </group>
  );
}

function VeoBackground() {
  const video = useMockVeoVideo();
  return (
    <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", zIndex: -1, pointerEvents: "none", opacity: 0.15 }}>
      <Canvas camera={{ position: [0, 0, 5], fov: 60 }}>
        <ambientLight intensity={1} />
        {video && <VeoScreen video={video} />}
      </Canvas>
    </div>
  );
}

// Wrap it under App:
function App() {
  const [phase, setPhase] = useState<GamePhase>("home");
  const [roomId, setRoomId] = useState("");
  const [myRole, setMyRole] = useState<Role | null>(null);
  const [mySessionId, setMySessionId] = useState<string>("");
  const [partnerJoined, setPartnerJoined] = useState(false);
  const [partnerRole, setPartnerRole] = useState<Role | null>(null);
  const [bomb, setBomb] = useState<Bomb | null>(null);
  const [timeLeft, setTimeLeft] = useState(180);
  const [instructions, setInstructions] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [agentTyping, setAgentTyping] = useState(false);
  const [agentReady, setAgentReady] = useState(false);
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
      case "welcome":
        setMySessionId(msg.sessionId);
        break;
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
      case "room-status":
        const partner = msg.players.find((p: any) => p.sessionId !== mySessionId);
        if (partner) {
          setPartnerRole(partner.role);
          setPartnerJoined(true);
        } else {
          setPartnerRole(null);
          setPartnerJoined(false);
        }
        const me = msg.players.find((p: any) => p.sessionId === mySessionId);
        if (me) setMyRole(me.role);
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
        setBomb((prev) => (prev ? { ...prev, timeLeft: msg.timeLeft } : null));
        break;
      case "gemini-ready":
        setAgentReady(true);
        addMsg("system", "Blind Agent is ready. You may now communicate and send video.");
        break;
      case "game-over":
        setGameWon(msg.won);
        setPhase("game-over");
        if (msg.won) playWin(); else playExplosion();
        break;
      case "bomb-updated":
        setBomb(msg.bomb);
        break;
      case "wire-cut":
        setBomb((prev) => {
          if (!prev) return prev;
          const wires = prev.wires.map((w) => w.id === msg.wireId ? { ...w, cut: true } : w);
          return { ...prev, wires };
        });
        break;
      case "symbol-toggled":
        setBomb((prev) => {
          if (!prev) return prev;
          const symbols = prev.symbols.map((s) => s.id === msg.symbolId ? { ...s, active: msg.active } : s);
          return { ...prev, symbols };
        });
        break;
      case "chat-message":
        addMsg(msg.from, msg.content);
        if (msg.from !== "system") playMsg();
        break;
      case "agent-typing":
        setAgentTyping(msg.typing);
        break;
      case "webcam-frame":
        setPartnerFrame(msg.frame);
        break;
      case "player-disconnected":
        addMsg("system", "Your partner disconnected.");
        setPartnerJoined(false);
        setPartnerRole(null);
        break;
      case "error":
        showError(msg.message);
        break;
    }
  });

  const reset = () => {
    if (roomId) {
      send({ type: "leave-room" });
    }
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
    setAgentReady(false);
    setPartnerFrame(null);
  };

  return (
    <>
      <VeoBackground />
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
          agentReady={agentReady}
          onCutWire={(id) => send({ type: "cut-wire", wireId: id })}
          onToggleSymbol={(id) => send({ type: "toggle-symbol", symbolId: id })}
          onUnscrewScrew={(id) => send({ type: "unscrew-screw", screwId: id })}
          onWebcamFrame={(frame) => {
            if (agentReady) {
              send({ type: "webcam-frame", frame });
            }
          }}
        />
      )}

      {phase === "playing" && bomb && myRole === "deaf" && (
        <DeafView
          instructions={instructions}
          messages={messages}
          timeLeft={timeLeft}
          agentTyping={agentTyping}
          agentReady={agentReady}
          onSend={(content) => {
            if (agentReady) {
              send({ type: "chat-message", content });
            }
          }}
          partnerFrame={partnerFrame}
        />
      )}

      {phase === "game-over" && <GameOverScreen won={gameWon} onPlayAgain={reset} />}
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
