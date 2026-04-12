import { useState, useEffect, useRef, useCallback } from "react";

const TYPE_COLORS = {
  context: { bg: "#E8F0FE", border: "#4A7BF7", icon: "📋" },
  escalation: { bg: "#FFF3E0", border: "#F5921B", icon: "📈" },
  conflict: { bg: "#FEECEC", border: "#E74C3C", icon: "⚡" },
  action: { bg: "#E8F5E9", border: "#43A047", icon: "🎬" },
  reaction: { bg: "#F3E5F5", border: "#8E24AA", icon: "💬" },
  verdict: { bg: "#FFF9C4", border: "#F9A825", icon: "⚖️" },
};

const SAMPLE_JSON = `{
  "title": "AITA for refusing to cook for my roommate's girlfriend?",
  "subreddit": "r/AmItheAsshole",
  "author": "u/throwaway_cook99",
  "verdict": "NTA",
  "nodes": [
    { "id": 1, "text": "OP lives with roommate Jake. They split groceries 50/50.", "type": "context", "parent": null },
    { "id": 2, "text": "Jake's girlfriend Mia starts staying over 4-5 nights a week.", "type": "escalation", "parent": 1 },
    { "id": 3, "text": "Groceries vanish fast. Mia eats OP's food without asking.", "type": "conflict", "parent": 2 },
    { "id": 4, "text": "Mia expects OP to cook for her too since OP is a great cook.", "type": "conflict", "parent": 2 },
    { "id": 5, "text": "OP tells Jake that Mia needs to chip in for groceries.", "type": "action", "parent": 3 },
    { "id": 6, "text": "OP refuses to make extra portions for Mia.", "type": "action", "parent": 4 },
    { "id": 7, "text": "Jake calls OP selfish. Says it is just a little extra food.", "type": "reaction", "parent": 5 },
    { "id": 8, "text": "Mia posts passive-aggressive story about toxic roommates.", "type": "reaction", "parent": 6 },
    { "id": 9, "text": "OP labels all food and only grocery shops for one person.", "type": "action", "parent": 7 },
    { "id": 10, "text": "Jake and Mia give OP the silent treatment for two weeks.", "type": "reaction", "parent": 9 },
    { "id": 11, "text": "VERDICT: NTA. Mia pays no rent or groceries. Jake should step up.", "type": "verdict", "parent": 10 }
  ]
}`;

function autoLayout(nodes) {
  if (!nodes || nodes.length === 0) return [];

  const childMap = {};
  nodes.forEach((n) => {
    if (n.parent !== null) {
      if (!childMap[n.parent]) childMap[n.parent] = [];
      childMap[n.parent].push(n.id);
    }
  });

  const depths = {};
  const depthGroups = {};

  function assignDepth(id, depth) {
    depths[id] = depth;
    if (!depthGroups[depth]) depthGroups[depth] = [];
    depthGroups[depth].push(id);
    if (childMap[id]) {
      childMap[id].forEach((cid) => assignDepth(cid, depth + 1));
    }
  }

  const roots = nodes.filter((n) => n.parent === null);
  roots.forEach((r) => assignDepth(r.id, 0));

  const maxDepth = Math.max(...Object.values(depths));
  const positioned = [];

  nodes.forEach((n) => {
    const d = depths[n.id];
    const group = depthGroups[d];
    const idx = group.indexOf(n.id);
    const count = group.length;

    const yPadding = 6;
    const usableY = 100 - yPadding * 2;
    const y = yPadding + (usableY / (maxDepth + 1)) * (d + 0.5);

    const xPadding = 15;
    const usableX = 100 - xPadding * 2;
    let x;
    if (count === 1) {
      x = 50;
    } else {
      x = xPadding + (usableX / (count - 1)) * idx;
    }

    positioned.push({ ...n, x, y });
  });

  return positioned;
}

function getNodeCenter(node, w, h) {
  return { x: (node.x / 100) * w, y: (node.y / 100) * h };
}

function TreeCanvas({ story, speed }) {
  const [visibleCount, setVisibleCount] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const timerRef = useRef(null);
  const containerRef = useRef(null);
  const [dims, setDims] = useState({ w: 900, h: 900 });

  const nodes = story._positioned || [];

  useEffect(() => {
    setVisibleCount(0);
    setIsPlaying(false);
  }, [story]);

  useEffect(() => {
    const updateDims = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const h = Math.max(600, nodes.length * 75);
        setDims({ w: rect.width, h });
      }
    };
    updateDims();
    window.addEventListener("resize", updateDims);
    return () => window.removeEventListener("resize", updateDims);
  }, [nodes.length]);

  useEffect(() => {
    if (isPlaying && visibleCount < nodes.length) {
      timerRef.current = setTimeout(() => setVisibleCount((c) => c + 1), speed);
    } else if (visibleCount >= nodes.length) {
      setIsPlaying(false);
    }
    return () => clearTimeout(timerRef.current);
  }, [isPlaying, visibleCount, speed, nodes.length]);

  const play = () => {
    if (visibleCount >= nodes.length) setVisibleCount(0);
    setIsPlaying(true);
  };

  const visibleNodes = nodes.slice(0, visibleCount);
  const lines = visibleNodes
    .filter((n) => n.parent !== null)
    .map((n) => {
      const parent = nodes.find((p) => p.id === n.parent);
      if (!parent || !visibleNodes.find((v) => v.id === parent.id)) return null;
      const from = getNodeCenter(parent, dims.w, dims.h);
      const to = getNodeCenter(n, dims.w, dims.h);
      return { from, to, id: `${parent.id}-${n.id}` };
    })
    .filter(Boolean);

  return (
    <div>
      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button onClick={play} disabled={isPlaying} style={btnStyle(isPlaying)}>
          ▶ Play
        </button>
        <button onClick={() => setIsPlaying(false)} disabled={!isPlaying} style={btnStyle(!isPlaying)}>
          ⏸ Pause
        </button>
        <button
          onClick={() => visibleCount < nodes.length && setVisibleCount((c) => c + 1)}
          disabled={isPlaying || visibleCount >= nodes.length}
          style={btnStyle(isPlaying)}
        >
          ⏭ Step
        </button>
        <button onClick={() => { setIsPlaying(false); setVisibleCount(0); }} style={btnStyle(false)}>
          ↺ Reset
        </button>
        <div style={{ marginLeft: "auto", fontFamily: "Nunito, sans-serif", fontSize: 12, color: "#888" }}>
          {visibleCount} / {nodes.length} nodes
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ background: "#E0E0E0", borderRadius: 99, height: 5, overflow: "hidden", marginBottom: 12 }}>
        <div
          style={{
            width: `${(visibleCount / Math.max(nodes.length, 1)) * 100}%`,
            height: "100%",
            background: "linear-gradient(90deg, #FF4500, #F9A825)",
            borderRadius: 99,
            transition: "width 0.4s ease",
          }}
        />
      </div>

      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <div style={{ fontFamily: "Nunito, sans-serif", fontSize: 11, fontWeight: 700, color: "#FF4500", textTransform: "uppercase", letterSpacing: 2 }}>
          {story.subreddit} • {story.author}
        </div>
        <h2 style={{ fontFamily: "Nunito, sans-serif", fontSize: "clamp(15px, 2.8vw, 20px)", fontWeight: 700, color: "#1A1A1A", margin: "4px 0 0", lineHeight: 1.3 }}>
          {story.title}
        </h2>
      </div>

      {/* Whiteboard */}
      <div
        ref={containerRef}
        style={{
          position: "relative",
          width: "100%",
          height: dims.h,
          background: "white",
          borderRadius: 12,
          boxShadow: "0 2px 20px rgba(0,0,0,0.08)",
          border: "2px solid #E8E8E4",
          overflow: "hidden",
          backgroundImage: "radial-gradient(circle, #ddd 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      >
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
          <defs>
            <marker id="ah" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="#AAA" />
            </marker>
          </defs>
          {lines.map((l) => {
            const midY = (l.from.y + l.to.y) / 2;
            return (
              <path
                key={l.id}
                d={`M ${l.from.x} ${l.from.y} C ${l.from.x} ${midY}, ${l.to.x} ${midY}, ${l.to.x} ${l.to.y}`}
                fill="none"
                stroke="#BBB"
                strokeWidth="2"
                strokeDasharray="6 4"
                markerEnd="url(#ah)"
                style={{ animation: "drawLine 0.5s ease forwards" }}
              />
            );
          })}
        </svg>

        {visibleNodes.map((node) => {
          const colors = TYPE_COLORS[node.type] || TYPE_COLORS.context;
          const pos = getNodeCenter(node, dims.w, dims.h);
          const nodeW = Math.min(250, dims.w * 0.34);
          return (
            <div
              key={node.id}
              style={{
                position: "absolute",
                left: pos.x - nodeW / 2,
                top: pos.y - 28,
                width: nodeW,
                background: colors.bg,
                border: `2px solid ${colors.border}`,
                borderRadius: 10,
                padding: "8px 10px",
                boxShadow: "0 3px 12px rgba(0,0,0,0.08)",
                animation: "popIn 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards",
                opacity: 0,
                zIndex: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                <span style={{ fontSize: 17, flexShrink: 0 }}>{colors.icon}</span>
                <span
                  style={{
                    fontFamily: "Caveat, cursive",
                    fontSize: "clamp(13px, 2vw, 16px)",
                    color: "#1A1A1A",
                    lineHeight: 1.3,
                    fontWeight: node.type === "verdict" ? 700 : 400,
                  }}
                >
                  {node.text}
                </span>
              </div>
              <div
                style={{
                  position: "absolute",
                  top: -9,
                  right: 10,
                  background: colors.border,
                  color: "white",
                  fontSize: 9,
                  fontFamily: "Nunito, sans-serif",
                  fontWeight: 700,
                  padding: "1px 7px",
                  borderRadius: 99,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                {node.type}
              </div>
            </div>
          );
        })}

        {visibleCount === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ textAlign: "center", color: "#AAA", fontFamily: "Caveat, cursive", fontSize: 24 }}>
              Press Play to reveal the story ✨
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
        {Object.entries(TYPE_COLORS).map(([type, c]) => (
          <div key={type} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontFamily: "Nunito, sans-serif", color: "#555" }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: c.border, display: "inline-block" }} />
            {type}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function BreakdownTakes() {
  const [mode, setMode] = useState("input");
  const [jsonText, setJsonText] = useState(SAMPLE_JSON);
  const [story, setStory] = useState(null);
  const [error, setError] = useState("");
  const [speed, setSpeed] = useState(2000);

  const loadStory = useCallback(() => {
    try {
      const parsed = JSON.parse(jsonText);
      if (!parsed.nodes || !Array.isArray(parsed.nodes)) {
        setError("JSON must have a 'nodes' array");
        return;
      }
      if (!parsed.title) {
        setError("JSON must have a 'title' field");
        return;
      }
      parsed._positioned = autoLayout(parsed.nodes);
      setStory(parsed);
      setError("");
      setMode("preview");
    } catch (e) {
      setError("Invalid JSON: " + e.message);
    }
  }, [jsonText]);

  const loadSample = () => {
    setJsonText(SAMPLE_JSON);
    setError("");
  };

  return (
    <div style={{ background: "#FAFAF8", minHeight: "100vh", fontFamily: "Nunito, sans-serif", padding: 16 }}>
      <link
        href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;600;700&family=Nunito:wght@400;600;700;800&display=swap"
        rel="stylesheet"
      />

      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              background: "linear-gradient(135deg, #FF4500, #F9A825)",
              color: "white",
              fontWeight: 800,
              fontSize: 15,
              padding: "6px 14px",
              borderRadius: 8,
              letterSpacing: -0.5,
            }}
          >
            BT
          </div>
          <span style={{ fontWeight: 800, fontSize: 18, color: "#1A1A1A", letterSpacing: -0.5 }}>Breakdown Takes</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => setMode("input")}
            style={{
              ...tabStyle,
              background: mode === "input" ? "#1A1A1A" : "white",
              color: mode === "input" ? "white" : "#1A1A1A",
            }}
          >
            📝 Editor
          </button>
          <button
            onClick={() => story && setMode("preview")}
            disabled={!story}
            style={{
              ...tabStyle,
              background: mode === "preview" ? "#1A1A1A" : "white",
              color: mode === "preview" ? "white" : story ? "#1A1A1A" : "#CCC",
            }}
          >
            🎬 Preview
          </button>
        </div>
      </div>

      {mode === "input" && (
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#555", marginBottom: 6 }}>
              Paste the JSON from Claude below:
            </div>
            <textarea
              value={jsonText}
              onChange={(e) => { setJsonText(e.target.value); setError(""); }}
              spellCheck={false}
              style={{
                width: "100%",
                minHeight: 350,
                fontFamily: "monospace",
                fontSize: 13,
                padding: 14,
                borderRadius: 10,
                border: error ? "2px solid #E74C3C" : "2px solid #DDD",
                background: "white",
                resize: "vertical",
                lineHeight: 1.5,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            {error && (
              <div style={{ color: "#E74C3C", fontSize: 12, fontWeight: 600, marginTop: 4 }}>
                ⚠ {error}
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={loadStory} style={{ ...primaryBtnStyle }}>
              🌳 Generate Tree
            </button>
            <button onClick={loadSample} style={btnStyle(false)}>
              Load Sample
            </button>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#888" }}>Speed:</span>
              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                style={{ ...btnStyle(false), cursor: "pointer", fontSize: 12 }}
              >
                <option value={3000}>Slow</option>
                <option value={2000}>Normal</option>
                <option value={1000}>Fast</option>
                <option value={500}>Very Fast</option>
              </select>
            </div>
          </div>

          {/* Instructions */}
          <div
            style={{
              marginTop: 20,
              padding: 16,
              background: "white",
              borderRadius: 10,
              border: "1.5px solid #E8E8E4",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: "#1A1A1A" }}>How to use:</div>
            <div style={{ fontSize: 13, color: "#555", lineHeight: 1.8 }}>
              1. Open a new Claude chat and paste your Reddit story prompt<br />
              2. Feed it a Reddit post — Claude gives you a narration + JSON<br />
              3. Copy just the JSON block (everything between the curly braces)<br />
              4. Paste it here and click "Generate Tree"<br />
              5. Hit Play in the preview to watch the tree build<br />
              6. Screen record the preview for your video
            </div>
          </div>

          {/* Expected format */}
          <div
            style={{
              marginTop: 12,
              padding: 16,
              background: "white",
              borderRadius: 10,
              border: "1.5px solid #E8E8E4",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: "#1A1A1A" }}>Expected JSON format:</div>
            <pre
              style={{
                fontSize: 11,
                color: "#666",
                background: "#F8F8F6",
                padding: 12,
                borderRadius: 8,
                overflow: "auto",
                lineHeight: 1.5,
              }}
            >{`{
  "title": "Post title here",
  "subreddit": "r/SubredditName",
  "author": "u/username",
  "verdict": "NTA / YTA / ESH / null",
  "nodes": [
    {
      "id": 1,
      "text": "Short description",
      "type": "context|escalation|conflict|action|reaction|verdict",
      "parent": null   ← first node
    },
    {
      "id": 2,
      "text": "Next beat",
      "type": "escalation",
      "parent": 1   ← connects to node 1
    }
  ]
}`}</pre>
          </div>
        </div>
      )}

      {mode === "preview" && story && <TreeCanvas story={story} speed={speed} />}

      <style>{`
        @keyframes popIn {
          0% { opacity: 0; transform: scale(0.5); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes drawLine {
          0% { stroke-dashoffset: 500; opacity: 0; }
          100% { stroke-dashoffset: 0; opacity: 1; }
        }
      `}</style>
    </div>
  );
}

const tabStyle = {
  fontFamily: "Nunito, sans-serif",
  fontSize: 12,
  fontWeight: 700,
  padding: "6px 14px",
  borderRadius: 8,
  border: "1.5px solid #DDD",
  cursor: "pointer",
};

const primaryBtnStyle = {
  fontFamily: "Nunito, sans-serif",
  fontSize: 13,
  fontWeight: 700,
  padding: "8px 20px",
  borderRadius: 8,
  border: "none",
  background: "linear-gradient(135deg, #FF4500, #F9A825)",
  color: "white",
  cursor: "pointer",
};

function btnStyle(disabled) {
  return {
    fontFamily: "Nunito, sans-serif",
    fontSize: 12,
    fontWeight: 600,
    padding: "6px 14px",
    borderRadius: 8,
    border: "1.5px solid #DDD",
    background: disabled ? "#F0F0F0" : "white",
    color: disabled ? "#AAA" : "#333",
    cursor: disabled ? "default" : "pointer",
  };
}
