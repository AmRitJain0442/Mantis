import { useEffect, useMemo, useState } from "react";
import {
  Activity, Bot, Braces, Check, ChevronDown, CircleDot, Clock3, Code2,
  Command, Filter, GitBranch, Globe2, Layers3, MessageSquareText, Network,
  PanelRightClose, Play, Radio, RotateCcw, Search, Sparkles, Terminal, Zap
} from "lucide-react";
import { events, kindLabel, sessions, toolNames, type EventKind, type TraceEvent } from "./data";
import { registerFlowTraceTools } from "./webmcp";

const kindIcon: Record<EventKind, typeof Activity> = {
  user: Bot, webmcp: Braces, network: Network, state: CircleDot, render: Layers3, console: Terminal
};

const nodeGeometry = [
  { id: "evt_001", x: 26, y: 214 },
  { id: "call_checkout_01", x: 226, y: 214 },
  { id: "req_checkout_42", x: 426, y: 214 },
  { id: "state_payment_07", x: 626, y: 214 },
  { id: "render_checkout_12", x: 826, y: 214 },
  { id: "error_type_01", x: 826, y: 390 }
];

const getEvent = (id: string) => events.find((event) => event.id === id)!;

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

function TraceNode({ event, active, muted, onClick }: { event: TraceEvent; active: boolean; muted: boolean; onClick: () => void }) {
  const Icon = kindIcon[event.kind];
  return (
    <button className={`trace-node node-${event.kind} ${active ? "active" : ""} ${muted ? "muted" : ""}`} onClick={onClick}>
      <span className="node-kicker"><Icon size={12} strokeWidth={2.2} />{kindLabel[event.kind]}</span>
      <strong>{event.title}</strong>
      <small>{event.detail}</small>
      <span className="node-footer"><StatusDot status={event.status} />{event.timestamp}<b>{event.duration}</b></span>
    </button>
  );
}

function TraceGraph({ highlighted, selected, onSelect }: { highlighted: string[]; selected: string; onSelect: (id: string) => void }) {
  const hasFocus = highlighted.length > 0;
  const [zoom, setZoom] = useState(100);
  return (
    <div className="graph-wrap">
      <div className="graph-toolbar">
        <div className="legend">
          <span><i className="legend-line solid" />caused</span>
          <span><i className="legend-line dash" />correlated</span>
        </div>
        <div className="zoom-control">
          <button aria-label="Zoom out" disabled={zoom === 80} onClick={() => setZoom((value) => Math.max(80, value - 10))}>−</button>
          <span>{zoom}%</span>
          <button aria-label="Zoom in" disabled={zoom === 140} onClick={() => setZoom((value) => Math.min(140, value + 10))}>+</button>
        </div>
      </div>
      <svg className="trace-svg" style={{ width: `${zoom}%` }} viewBox="0 0 1050 560" role="img" aria-label="Checkout failure causal graph">
        <defs>
          <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#24282d" strokeWidth="0.7" opacity=".5" />
          </pattern>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#4b525b" />
          </marker>
          <marker id="arrow-hot" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#e8ff65" />
          </marker>
        </defs>
        <rect width="1050" height="560" fill="url(#grid)" />
        <g className={`connectors ${hasFocus ? "focused" : ""}`}>
          {[126, 326, 526, 726].map((x, index) => (
            <path key={x} className={highlighted.includes(nodeGeometry[index + 1].id) ? "hot" : ""} d={`M ${x + 74} 273 C ${x + 95} 273, ${x + 80} 273, ${x + 100} 273`} markerEnd={highlighted.includes(nodeGeometry[index + 1].id) ? "url(#arrow-hot)" : "url(#arrow)"} />
          ))}
          <path className={highlighted.includes("error_type_01") ? "hot" : ""} d="M 916 332 C 916 352, 916 360, 916 385" markerEnd={highlighted.includes("error_type_01") ? "url(#arrow-hot)" : "url(#arrow)"} />
        </g>
        <g className="lane-labels">
          <text x="26" y="65">AGENT INTENT</text>
          <text x="226" y="65">TOOL BOUNDARY</text>
          <text x="426" y="65">APPLICATION</text>
          <text x="826" y="65">USER IMPACT</text>
        </g>
        <g className="time-spine"><line x1="27" y1="139" x2="1004" y2="139" /><circle cx="27" cy="139" r="3" /><circle cx="1004" cy="139" r="3" /><text x="27" y="123">10:42:17.082</text><text x="926" y="123">+1.232s</text></g>
        {nodeGeometry.map(({ id, x, y }) => {
          const event = getEvent(id);
          return (
            <foreignObject key={id} x={x} y={y} width="180" height="126">
              <TraceNode event={event} active={selected === id || highlighted.includes(id)} muted={hasFocus && !highlighted.includes(id)} onClick={() => onSelect(id)} />
            </foreignObject>
          );
        })}
        <g className="root-cause-tag" transform="translate(448 372)">
          <rect width="156" height="28" rx="14" />
          <circle cx="15" cy="14" r="3" />
          <text x="26" y="18">ROOT CAUSE</text>
        </g>
      </svg>
      <div className="minimap" aria-hidden="true">
        <span className="mini-line" />
        {events.map((event, i) => <i key={event.id} className={`mini-dot ${event.status}`} style={{ left: `${8 + i * 16}%` }} />)}
        <b />
      </div>
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
  const selectedEvent = useMemo(() => getEvent(selected), [selected]);

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
    for (const event of events) {
      setSelected(event.id);
      await new Promise((resolve) => setTimeout(resolve, 240));
    }
    setSelected("error_type_01");
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
        <div className="project-switcher"><span className="project-icon">M</span><div><small>PROJECT</small><strong>Mercury Storefront</strong></div><ChevronDown size={14} /></div>
        <div className="header-actions">
          <span className={`mcp-status ${webmcp}`}><Radio size={12} />{webmcp === "native" ? "WEBMCP LIVE" : webmcp === "preview" ? "WEBMCP PREVIEW" : "CONNECTING"}</span>
          <button className="icon-button" aria-label="Open command menu"><Command size={16} /><kbd>⌘ K</kbd></button>
          <div className="avatar">AK</div>
        </div>
      </header>

      <div className="sessionbar">
        <div className="breadcrumb"><Activity size={14} /><span>SESSIONS</span><b>/</b><strong>session_8291</strong></div>
        <div className="session-meta"><span><Clock3 size={12} /> started 10:42:17</span><span>1.84s total</span><span className="failed"><i />FAILED</span><button onClick={replay}><RotateCcw size={13} /> Replay trace</button></div>
      </div>

      <main className="workspace">
        <aside className="left-panel">
          <div className="panel-title"><span>TRACE SESSIONS</span><button><Filter size={13} /></button></div>
          <label className="search-box"><Search size={13} /><input aria-label="Search traces" placeholder="Search traces" /><kbd>/</kbd></label>
          <div className="date-label">TODAY · 3 RUNS</div>
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
            <div className="date-label">CAPTURE SOURCES</div>
            {(["webmcp", "network", "state", "render", "console"] as EventKind[]).map((kind) => {
              const Icon = kindIcon[kind];
              return <button key={kind} className={eventFilter === kind ? "active" : ""} onClick={() => filterEvents(eventFilter === kind ? "all" : kind)}><Icon size={13} /><span>{kind === "webmcp" ? "WebMCP calls" : kind[0].toUpperCase() + kind.slice(1)}</span><b>{events.filter((event) => event.kind === kind).length}</b></button>;
            })}
          </div>
          <div className="capture-card"><span><Radio size={13} />CAPTURE ACTIVE</span><strong>localhost:3000</strong><small>Listening for application events</small></div>
        </aside>

        <section className="canvas-panel">
          <div className="canvas-header">
            <div><span className="eyebrow">CAUSAL TRACE / CHECKOUT</span><h1>One failure. Every cause.</h1></div>
            <div className="canvas-actions"><button><Filter size={13} />All events<ChevronDown size={12} /></button><button className="play-button" onClick={replay}><Play size={12} fill="currentColor" />Play</button></div>
          </div>
          <div className="insight-strip">
            <Zap size={14} fill="currentColor" />
            <strong>FlowTrace detected a causal chain</strong>
            <span>5 correlated events across 4 runtime boundaries</span>
            <button onClick={explainFailure}>Ask agent to explain <span>→</span></button>
          </div>
          <TraceGraph highlighted={highlighted} selected={selected} onSelect={(id) => { setSelected(id); setActivePanel("event"); }} />
        </section>

        <aside className="right-panel">
          <div className="right-tabs">
            <button className={activePanel === "agent" ? "active" : ""} onClick={() => setActivePanel("agent")}><Sparkles size={13} />AGENT</button>
            <button className={activePanel === "event" ? "active" : ""} onClick={() => setActivePanel("event")}><Code2 size={13} />EVENT</button>
            <button className="collapse" aria-label="Collapse panel"><PanelRightClose size={15} /></button>
          </div>

          {activePanel === "agent" ? (
            <div className="agent-panel">
              <div className="agent-heading"><span className="agent-orb"><Sparkles size={15} /></span><div><strong>FlowTrace Agent</strong><small>Shares your live trace context</small></div></div>
              <div className="chat-thread">
                <div className="user-message">Why did checkout fail?</div>
                {agentState === "idle" && (
                  <div className="agent-empty"><MessageSquareText size={20} /><p>Ask the agent to investigate. It reads the graph through WebMCP—not screenshots.</p><button onClick={explainFailure}><Sparkles size={13} />Run investigation</button></div>
                )}
                {agentState !== "idle" && (
                  <div className="tool-call-card">
                    <div className="tool-call-head"><span><Braces size={13} />explain_failure</span>{agentState === "done" ? <b><Check size={12} />184ms</b> : <b className="running"><i />running</b>}</div>
                    <pre>{`{ "sessionId": "session_8291" }`}</pre>
                  </div>
                )}
                {agentState === "thinking" && <div className="thinking"><i /><i /><i /><span>Tracing causes</span></div>}
                {agentState === "done" && (
                  <div className="agent-response">
                    <p>The checkout failed at <button onClick={() => setSelected("req_checkout_42")}>POST /api/checkout</button>. The payment provider timed out during token exchange and returned <code>500</code>.</p>
                    <p>That left <button onClick={() => setSelected("state_payment_07")}>paymentToken</button> undefined. <code>CheckoutForm</code> then tried to call <code>.slice()</code> on it and crashed.</p>
                    <div className="root-summary"><span>ROOT CAUSE</span><strong>Missing failure guard after token exchange</strong><small>CheckoutForm.tsx · line 87</small></div>
                    <div className="agent-actions"><button onClick={() => setActivePanel("event")}><Code2 size={12} />Open source event</button><button>Copy summary</button></div>
                  </div>
                )}
              </div>
              <div className="prompt-area">
                <div className="prompt-chips"><button onClick={explainFailure}>Explain failure</button><button onClick={() => window.flowTrace?.invoke("get_causal_chain", { eventId: selected })}>Trace selected</button></div>
                <div className="prompt-box"><textarea defaultValue="Why did checkout fail?" aria-label="Ask FlowTrace Agent" /><button onClick={explainFailure}><span>↗</span></button></div>
                <small><CircleDot size={9} /> Agent can invoke {toolNames.length} read-only WebMCP tools</small>
              </div>
            </div>
          ) : (
            <div className="event-inspector">
              <div className="inspector-kind"><span className={`kind-chip ${selectedEvent.kind}`}>{kindLabel[selectedEvent.kind]}</span><span>{selectedEvent.timestamp}</span></div>
              <h2>{selectedEvent.title}</h2><p>{selectedEvent.detail}</p>
              <div className="property-list">
                {Object.entries(selectedEvent.meta).map(([key, value]) => <div key={key}><span>{key}</span><code>{typeof value === "object" ? JSON.stringify(value) : String(value)}</code></div>)}
              </div>
              <button className="causal-button" onClick={() => window.flowTrace?.invoke("get_causal_chain", { eventId: selectedEvent.id })}><GitBranch size={14} />Focus causal chain</button>
              <div className="event-json"><div><span>STRUCTURED EVENT</span><button>Copy</button></div><pre>{JSON.stringify({ id: selectedEvent.id, type: selectedEvent.kind, status: selectedEvent.status, parentId: selectedEvent.parentId ?? null }, null, 2)}</pre></div>
            </div>
          )}
        </aside>
      </main>

      <footer className="statusbar">
        <span><i className="live-dot" />LIVE CAPTURE</span><span><Globe2 size={11} />localhost:3000</span><span><Activity size={11} />6 events</span><span><GaugeIcon />1.84s</span><b>FlowTrace SDK v0.1.0</b>
      </footer>
    </div>
  );
}

function GaugeIcon() { return <Activity size={11} />; }

export default App;
