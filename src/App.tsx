import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Activity, Bot, Braces, Check, ChevronDown, CircleDot, Clock3, Code2,
  Command, Filter, GitBranch, Globe2, Layers3, MessageSquareText, Moon,
  Network, PanelRightClose, Play, Radio, RotateCcw, Search, Sparkles, Sun,
  Terminal, Zap
} from "lucide-react";
import { events, kindLabel, sessions, toolNames, type EventKind, type TraceEvent } from "./data";
import { registerFlowTraceTools } from "./webmcp";
import { useTheme } from "./theme";

const kindIcon: Record<EventKind, typeof Activity> = {
  user: Bot, webmcp: Braces, network: Network, state: CircleDot, render: Layers3, console: Terminal
};

/** One hue per runtime boundary, the way a logic analyser colours its probes. */
const channel = (kind: EventKind): CSSProperties =>
  ({ "--chan": `var(--ch-${kind === "user" ? "intent" : kind})` }) as CSSProperties;

const NODE_W = 170;
const nodeGeometry = [
  { id: "evt_001", x: 26, y: 70 },
  { id: "call_checkout_01", x: 226, y: 70 },
  { id: "req_checkout_42", x: 426, y: 70 },
  { id: "state_payment_07", x: 626, y: 70 },
  { id: "render_checkout_12", x: 826, y: 70 },
  { id: "error_type_01", x: 826, y: 246 }
];

const getEvent = (id: string) => events.find((event) => event.id === id)!;

/* -- timeline maths: every event placed at its true offset from the trigger -- */
const toMs = (timestamp: string) => {
  const [hours, minutes, seconds] = timestamp.split(":");
  return ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000;
};
const originMs = toMs(events[0].timestamp);
const offsetsMs = events.map((event) => toMs(event.timestamp) - originMs);
const spanMs = offsetsMs[offsetsMs.length - 1];
const ratios = offsetsMs.map((offset) => offset / spanMs);

/** The widest silence in the trace — here, the 1.19s the payment provider stalled. */
const widestGap = offsetsMs.slice(1).reduce(
  (widest, offset, index) =>
    offset - offsetsMs[index] > widest.ms
      ? { ms: offset - offsetsMs[index], from: index, to: index + 1 }
      : widest,
  { ms: 0, from: 0, to: 1 }
);

const formatMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`);

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <span /><span /><span />
    </div>
  );
}

function StatusDot({ status }: { status: "ok" | "error" | "warning" }) {
  return <span className={`status-dot ${status}`} />;
}

function ThemeToggle({ theme, onToggle }: { theme: "light" | "dark"; onToggle: () => void }) {
  return (
    <button
      className="theme-toggle"
      onClick={onToggle}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
    >
      {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}

/** The signal spine: every event at its real temporal offset, so the stall that
 *  caused the failure is visible as a gap rather than described in a tooltip. */
function SignalSpine({
  selected, replaying, onSelect
}: { selected: string; replaying: boolean; onSelect: (id: string) => void }) {
  const index = Math.max(0, events.findIndex((event) => event.id === selected));
  const cursor = ratios[index];
  const cursorStyle: CSSProperties =
    cursor > 0.75 ? { left: `${cursor * 100}%`, transform: "translateX(-100%)" }
      : cursor < 0.25 ? { left: `${cursor * 100}%` }
        : { left: `${cursor * 100}%`, transform: "translateX(-50%)" };

  return (
    <div className={`signal-spine ${replaying ? "replaying" : ""}`}>
      <div className="spine-head">
        <span className="lbl">Signal spine · to scale</span>
        <b>{formatMs(spanMs)} · {events.length} events</b>
      </div>
      <div className="spine-track">
        <span className="spine-rail" />
        <span
          className="spine-gap"
          style={{
            left: `${ratios[widestGap.from] * 100}%`,
            width: `${(ratios[widestGap.to] - ratios[widestGap.from]) * 100}%`
          }}
        >
          <span>{formatMs(widestGap.ms)} waiting on the network</span>
        </span>
        {events.map((event, i) => (
          <button
            key={event.id}
            className={`spine-tick ${selected === event.id ? "on" : ""}`}
            style={{ left: `${ratios[i] * 100}%`, ...channel(event.kind) }}
            onClick={() => onSelect(event.id)}
            aria-label={`${event.title} at +${formatMs(offsetsMs[i])}`}
            title={`${event.title} · +${formatMs(offsetsMs[i])}`}
          >
            <i />
          </button>
        ))}
        <span className="spine-cursor" style={cursorStyle}>+{formatMs(offsetsMs[index])}</span>
      </div>
    </div>
  );
}

function TraceNode({ event, index, active, muted, onClick }: {
  event: TraceEvent; index: number; active: boolean; muted: boolean; onClick: () => void;
}) {
  const Icon = kindIcon[event.kind];
  return (
    <button
      className={`trace-node ${active ? "active" : ""} ${muted ? "muted" : ""}`}
      style={{ ...channel(event.kind), "--i": index } as CSSProperties}
      onClick={onClick}
    >
      <span className="node-kicker"><Icon size={12} strokeWidth={2.2} />{kindLabel[event.kind]}</span>
      <strong>{event.title}</strong>
      <small>{event.detail}</small>
      <span className="node-footer"><StatusDot status={event.status} />{event.timestamp}<b>{event.duration}</b></span>
    </button>
  );
}

function TraceGraph({ highlighted, selected, onSelect }: {
  highlighted: string[]; selected: string; onSelect: (id: string) => void;
}) {
  const hasFocus = highlighted.length > 0;
  const [zoom, setZoom] = useState(100);
  return (
    <div className="graph-wrap">
      <div className="graph-toolbar">
        <div className="legend">
          <span><i className="legend-line solid" />caused</span>
          <span><i className="legend-line dash" />agent focus</span>
        </div>
        <div className="zoom-control">
          <button aria-label="Zoom out" disabled={zoom === 80} onClick={() => setZoom((value) => Math.max(80, value - 10))}>−</button>
          <span>{zoom}%</span>
          <button aria-label="Zoom in" disabled={zoom === 140} onClick={() => setZoom((value) => Math.min(140, value + 10))}>+</button>
        </div>
      </div>
      <svg className="trace-svg" style={{ width: `${zoom}%` }} viewBox="0 0 1050 390" role="img" aria-label="Checkout failure causal graph">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
          </marker>
        </defs>
        <g className="lane-dividers">
          {[211, 411, 811].map((x) => <line key={x} className="lane-divider" x1={x} y1="40" x2={x} y2="376" />)}
        </g>
        <g className="lane-labels">
          <text x="26" y="26">AGENT INTENT</text>
          <text x="226" y="26">TOOL BOUNDARY</text>
          <text x="426" y="26">APPLICATION</text>
          <text x="826" y="26">USER IMPACT</text>
        </g>

        <g className={`connectors ${hasFocus ? "focused" : ""}`}>
          {nodeGeometry.slice(1, 5).map((node, index) => {
            const from = nodeGeometry[index];
            const hot = highlighted.includes(node.id);
            return (
              <path
                key={node.id}
                className={hot ? "hot" : ""}
                style={channel(getEvent(node.id).kind)}
                d={`M ${from.x + NODE_W + 2} 129 L ${node.x - 4} 129`}
                markerEnd="url(#arrow)"
              />
            );
          })}
          <path
            className={highlighted.includes("error_type_01") ? "hot" : ""}
            style={channel("console")}
            d="M 911 192 L 911 240"
            markerEnd="url(#arrow)"
          />
        </g>

        {nodeGeometry.map(({ id, x, y }, index) => (
          <foreignObject key={id} x={x} y={y} width={NODE_W + 2} height="122">
            <TraceNode
              event={getEvent(id)}
              index={index}
              active={selected === id || highlighted.includes(id)}
              muted={hasFocus && !highlighted.includes(id)}
              onClick={() => onSelect(id)}
            />
          </foreignObject>
        ))}

        {/* Anchored under the network call — the event the agent names as the cause. */}
        <g className="root-cause-tag" transform="translate(426 204)">
          <rect width="120" height="26" rx="13" />
          <circle cx="15" cy="13" r="3" />
          <text x="26" y="17">ROOT CAUSE</text>
        </g>
      </svg>
    </div>
  );
}

type AgentState = "idle" | "thinking" | "done";

function App() {
  const [selected, setSelected] = useState("req_checkout_42");
  const [highlighted, setHighlighted] = useState<string[]>([]);
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [webmcp, setWebmcp] = useState<"checking" | "native" | "preview">("checking");
  const [eventFilter, setEventFilter] = useState<EventKind | "all">("all");
  const [activePanel, setActivePanel] = useState<"agent" | "event">("agent");
  const [replaying, setReplaying] = useState(false);
  const selectedEvent = useMemo(() => getEvent(selected), [selected]);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    registerFlowTraceTools().then((result) => setWebmcp(result.supported ? "native" : "preview"));
    const handleFocus = (raw: Event) => {
      const detail = (raw as CustomEvent<{ ids: string[] }>).detail;
      setHighlighted(detail.ids);
      if (detail.ids.length) setSelected(detail.ids[0]);
    };
    window.addEventListener("flowtrace:focus", handleFocus);
    return () => window.removeEventListener("flowtrace:focus", handleFocus);
  }, []);

  const explainFailure = async () => {
    setAgentState("thinking");
    setHighlighted([]);
    await new Promise((resolve) => setTimeout(resolve, 650));
    await window.flowTrace?.invoke("explain_failure", { sessionId: "session_8291" });
    setAgentState("done");
  };

  const replay = async () => {
    setAgentState("idle");
    setHighlighted([]);
    setReplaying(true);
    for (const event of events) {
      setSelected(event.id);
      await new Promise((resolve) => setTimeout(resolve, 240));
    }
    setSelected("error_type_01");
    setReplaying(false);
  };

  const filterEvents = async (kind: EventKind | "all") => {
    setEventFilter(kind);
    if (kind === "all") setHighlighted([]);
    else await window.flowTrace?.invoke("filter_events", { type: kind, sessionId: "session_8291" });
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><BrandMark /><span>FLOWTRACE</span><em>α</em></div>
        <button className="project-switcher"><span className="project-icon">M</span><div><small>Project</small><strong>Mercury Storefront</strong></div><ChevronDown size={14} /></button>
        <div className="header-actions">
          <span className={`mcp-status ${webmcp}`}><Radio size={12} />{webmcp === "native" ? "WebMCP live" : webmcp === "preview" ? "WebMCP preview" : "Connecting"}</span>
          <button className="icon-button" aria-label="Open command menu"><Command size={15} /><kbd>K</kbd></button>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <div className="avatar">AK</div>
        </div>
      </header>

      <div className="sessionbar">
        <div className="breadcrumb"><Activity size={14} /><span>Sessions</span><b>/</b><strong>session_8291</strong></div>
        <div className="session-meta">
          <span><Clock3 size={12} /> started 10:42:17</span>
          <span>1.84s total</span>
          <span className="failed"><i />Failed</span>
          <button onClick={replay}><RotateCcw size={13} /> Replay trace</button>
        </div>
      </div>

      <main className="workspace">
        <aside className="left-panel">
          <div className="panel-title"><span className="lbl">Trace sessions</span><button aria-label="Filter sessions"><Filter size={13} /></button></div>
          <label className="search-box"><Search size={13} /><input aria-label="Search traces" placeholder="Search traces" /><kbd>/</kbd></label>
          <div className="date-label lbl">Today · 3 runs</div>
          <div className="session-list">
            {sessions.map((session) => (
              <button key={session.id} className={`session-row ${session.id === "session_8291" ? "selected" : ""}`}>
                <span className={`session-state ${session.status}`}><GitBranch size={13} /></span>
                <span className="session-copy"><strong>{session.label}</strong><small>{session.id} · {session.startedAt}</small></span>
                <span className="session-time">{session.duration}{session.errorCount > 0 && <b>{session.errorCount}</b>}</span>
              </button>
            ))}
          </div>
          <div className="sources">
            <div className="date-label lbl">Capture sources</div>
            {(["webmcp", "network", "state", "render", "console"] as EventKind[]).map((kind) => {
              const Icon = kindIcon[kind];
              return (
                <button
                  key={kind}
                  className={eventFilter === kind ? "active" : ""}
                  style={channel(kind)}
                  onClick={() => filterEvents(eventFilter === kind ? "all" : kind)}
                >
                  <Icon size={14} />
                  <span>{kind === "webmcp" ? "WebMCP calls" : kind[0].toUpperCase() + kind.slice(1)}</span>
                  <b>{events.filter((event) => event.kind === kind).length}</b>
                </button>
              );
            })}
          </div>
          <div className="capture-card">
            <span><Radio size={13} />Capture active</span>
            <strong>localhost:3000</strong>
            <small>Listening for application events</small>
          </div>
        </aside>

        <section className="canvas-panel">
          <div className="canvas-header">
            <div>
              <span className="lbl">Causal trace / checkout</span>
              <h1>One failure. <span>Every cause.</span></h1>
            </div>
            <div className="canvas-actions">
              <button><Filter size={13} />All events<ChevronDown size={12} /></button>
              <button className="play-button" onClick={replay}><Play size={12} fill="currentColor" />Play</button>
            </div>
          </div>

          <div className="insight-strip">
            <Zap size={14} fill="currentColor" />
            <strong>FlowTrace detected a causal chain</strong>
            <span>5 correlated events across 4 runtime boundaries</span>
            <button onClick={explainFailure}>Ask agent to explain <span>→</span></button>
          </div>

          <SignalSpine selected={selected} replaying={replaying} onSelect={(id) => { setSelected(id); setActivePanel("event"); }} />

          <TraceGraph highlighted={highlighted} selected={selected} onSelect={(id) => { setSelected(id); setActivePanel("event"); }} />
        </section>

        <aside className="right-panel">
          <div className="right-tabs">
            <button className={activePanel === "agent" ? "active" : ""} onClick={() => setActivePanel("agent")}><Sparkles size={13} />Agent</button>
            <button className={activePanel === "event" ? "active" : ""} onClick={() => setActivePanel("event")}><Code2 size={13} />Event</button>
            <button className="collapse" aria-label="Collapse panel"><PanelRightClose size={15} /></button>
          </div>

          {activePanel === "agent" ? (
            <div className="agent-panel">
              <div className="agent-heading">
                <span className="agent-orb"><Sparkles size={15} /></span>
                <div><strong>FlowTrace Agent</strong><small>Shares your live trace context</small></div>
              </div>
              <div className="chat-thread">
                <div className="user-message">Why did checkout fail?</div>
                {agentState === "idle" && (
                  <div className="agent-empty">
                    <MessageSquareText size={20} />
                    <p>Ask the agent to investigate. It reads the graph through WebMCP — not screenshots.</p>
                    <button onClick={explainFailure}><Sparkles size={13} />Run investigation</button>
                  </div>
                )}
                {agentState !== "idle" && (
                  <div className="tool-call-card">
                    <div className="tool-call-head">
                      <span><Braces size={13} />explain_failure</span>
                      {agentState === "done" ? <b><Check size={12} />184ms</b> : <b className="running"><i />running</b>}
                    </div>
                    <pre>{`{ "sessionId": "session_8291" }`}</pre>
                  </div>
                )}
                {agentState === "thinking" && <div className="thinking"><i /><i /><i /><span>Tracing causes</span></div>}
                {agentState === "done" && (
                  <div className="agent-response">
                    <p>The checkout failed at <button onClick={() => setSelected("req_checkout_42")}>POST /api/checkout</button>. The payment provider timed out during token exchange and returned <code>500</code>.</p>
                    <p>That left <button onClick={() => setSelected("state_payment_07")}>paymentToken</button> undefined. <code>CheckoutForm</code> then tried to call <code>.slice()</code> on it and crashed.</p>
                    <div className="root-summary">
                      <span>Root cause</span>
                      <strong>Missing failure guard after token exchange</strong>
                      <small>CheckoutForm.tsx · line 87</small>
                    </div>
                    <div className="agent-actions">
                      <button onClick={() => setActivePanel("event")}><Code2 size={12} />Open source event</button>
                      <button>Copy summary</button>
                    </div>
                  </div>
                )}
              </div>
              <div className="prompt-area">
                <div className="prompt-chips">
                  <button onClick={explainFailure}>Explain failure</button>
                  <button onClick={() => window.flowTrace?.invoke("get_causal_chain", { eventId: selected })}>Trace selected</button>
                </div>
                <div className="prompt-box">
                  <textarea defaultValue="Why did checkout fail?" aria-label="Ask FlowTrace Agent" />
                  <button aria-label="Send message"><span>↗</span></button>
                </div>
                <small><CircleDot size={9} /> Agent can invoke {toolNames.length} read-only WebMCP tools</small>
              </div>
            </div>
          ) : (
            <div className="event-inspector">
              <div className="inspector-kind">
                <span className="kind-chip" style={channel(selectedEvent.kind)}>{kindLabel[selectedEvent.kind]}</span>
                <span>{selectedEvent.timestamp}</span>
              </div>
              <h2>{selectedEvent.title}</h2>
              <p>{selectedEvent.detail}</p>
              <div className="property-list">
                {Object.entries(selectedEvent.meta).map(([key, value]) => (
                  <div key={key}><span>{key}</span><code>{typeof value === "object" ? JSON.stringify(value) : String(value)}</code></div>
                ))}
              </div>
              <button className="causal-button" onClick={() => window.flowTrace?.invoke("get_causal_chain", { eventId: selectedEvent.id })}>
                <GitBranch size={14} />Focus causal chain
              </button>
              <div className="event-json">
                <div><span>Structured event</span><button>Copy</button></div>
                <pre>{JSON.stringify({ id: selectedEvent.id, type: selectedEvent.kind, status: selectedEvent.status, parentId: selectedEvent.parentId ?? null }, null, 2)}</pre>
              </div>
            </div>
          )}
        </aside>
      </main>

      <footer className="statusbar">
        <span><i className="live-dot" />Live capture</span>
        <span><Globe2 size={11} />localhost:3000</span>
        <span><Activity size={11} />{events.length} events</span>
        <span><Clock3 size={11} />1.84s</span>
        <b>FlowTrace SDK v0.1.0</b>
      </footer>
    </div>
  );
}

export default App;
