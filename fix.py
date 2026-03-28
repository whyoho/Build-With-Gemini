import re

with open('public/app.tsx', 'r') as f:
    content = f.read()

# Replace panel label
content = re.sub(
    r'<Html position=\{\[0, 0\.5, 0\]\} center>\s*<div className="panel-label">\{comp\.name\}</div>\s*</Html>',
    r'<Text position={[0, 0.45, 0.03]} fontSize={0.05} color="#aaa" anchorY="bottom">{comp.name}</Text>',
    content
)

# Replace cut indicator
content = re.sub(
    r'<Html position=\{\[0, 0, 0\.1\]\} center>\s*<div className="cut-indicator">✂</div>\s*</Html>',
    r'<Text position={[0, 0, 0.05]} fontSize={0.06} color="white">✂</Text>',
    content
)

# Replace symbol buttons
content = re.sub(
    r'<Html key=\{s\.id\} position=\{\[0, i \* 0\.2 - 0\.3, 0\.06\]\} center transform>\s*<button\s*className=\{\`symbol-btn \$\{s\.active \? "symbol-btn--active" : ""\}\`\}\s*onClick=\{\(\) => \{\s*playToggle\(\);\s*onToggleSymbol\(s\.id\);\s*\}\}\s*>\s*\{s\.icon\}\s*</button>\s*</Html>',
    r'''<group key={s.id} position={[0, i * 0.2 - 0.3, 0.06]}>
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
                </group>''',
    content
)

# Replace timer
content = re.sub(
    r'<Html transform distanceFactor=\{1\.2\} position=\{\[0, 0, 0\.01\]\}>\s*<div className="diegetic-timer">\s*\{Math\.floor\(bomb\.timeLeft / 60\)\}:\{String\(bomb\.timeLeft % 60\)\.padStart\(2, "0"\)\}\s*</div>\s*</Html>',
    r'''<Text
                  position={[0, 0, 0.015]}
                  fontSize={0.2}
                  color={bomb.timeLeft <= 30 ? "#ff2244" : "#00e87a"}
                  anchorX="center"
                  anchorY="middle"
                >
                  {Math.floor(bomb.timeLeft / 60)}:{String(bomb.timeLeft % 60).padStart(2, "0")}
                </Text>''',
    content
)

# Replace screw tooltip
content = re.sub(
    r'<Html distanceFactor=\{1\.5\} position=\{\[0, 0\.1, 0\]\}>\s*\{hovered && <div className="tooltip">HOLD TO UNSCREW</div>\}\s*</Html>',
    r'''{hovered && (
        <Text position={[0, 0.12, 0]} fontSize={0.06} color="white" outlineWidth={0.005} outlineColor="black" anchorY="bottom">
          HOLD TO UNSCREW
        </Text>
      )}''',
    content
)

with open('public/app.tsx', 'w') as f:
    f.write(content)
