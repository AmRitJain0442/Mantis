import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Activity, Bot, Braces, Check, CircleDot, Code2, Crosshair, Filter, Globe2,
  Layers3, Lock, Maximize2, MessageSquareText, Moon, Network, PanelRightClose,
  Play, RotateCcw, Search, Send, ShieldAlert, Sparkles, Sun, Terminal, Wrench
} from "lucide-react";
import { events, kindLabel, sessions, type EventKind, type TraceEvent } from "./data";
import { toolNames, type DiscoveredTool } from "./webmcp";
import { useWebMCP } from "./useWebMCP";
import { useTheme } from "./theme";
import { useWorkspaceScale } from "./scale";
import { useCanvas } from "./canvas";
import {
  NODE_H, NODE_W, boundaries, boundaryOf, edges, enclosureRect, nodeRect,
  portsFor, routeEdge, worldBounds, type BoundaryId, type Positions, type Rect
} from "./layout";

const kindIcon: Record<EventKind, typeof Activity> = {
  user: Bot, webmcp: Braces, network: Network, state: CircleDot, render: Layers3, console: Terminal
};

/** Colour follows the runtime boundary, not the event kind: a cool-to-warm ramp
 *  from agent intent to user impact, so failure arrives at the warm end. */
const tone = (boundary: BoundaryId): CSSProperties =>
  ({ "--tone": `var(--t-${boundary})` }) as CSSProperties;

const getEvent = (id: string) => events.find((event) => event.id === id)!;

/** Arguments the Tools panel uses when running a tool against this session. */
const defaultInputFor = (name: string): Record<string, unknown> => {
  if (name === "trace_request") return { requestId: "req_checkout_42" };
  if (name === "inspect_webmcp_call") return { callId: "call_checkout_01" };
  if (name === "get_causal_chain" || name === "select_event") return { eventId: "req_checkout_42" };
  if (name === "filter_events") return { type: "network", sessionId: "session_8291" };
  if (name === "set_source_filter") return { type: "all" };
  if (name === "frame_trace") return { mode: "fit" };
  if (name === "list_sessions") return {};
  return { sessionId: "session_8291" };
};

/** Rect carries w/h; SVG attributes want width/height. */
const svgRect = (rect: Rect) => ({ x: rect.x, y: rect.y, width: rect.w, height: rect.h });

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>;
}

function ThemeToggle({ theme, onToggle }: { theme: "light" | "dark"; onToggle: () => void }) {
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button className="ghost-button" onClick={onToggle} aria-label={label} title={label}>
      {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
}

function Minimap({ positions, viewport, frame }: {
  positions: Positions;
  viewport: { x: number; y: number; k: number };
  frame: { w: number; h: number };
}) {
  const world = worldBounds(positions);
  const view = {
    x: -viewport.x / viewport.k,
    y: -viewport.y / viewport.k,
    w: frame.w / viewport.k,
    h: frame.h / viewport.k
  };
  const pad = 30;
  const left = Math.min(world.x, view.x) - pad;
  const top = Math.min(world.y, view.y) - pad;
  const box = {
    x: left,
    y: top,
    w: Math.max(world.x + world.w, view.x + view.w) + pad - left,
    h: Math.max(world.y + world.h, view.y + view.h) + pad - top
  };
  return (
    <div className="minimap" aria-hidden="true">
      <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} preserveAspectRatio="xMidYMid meet">
        {boundaries.map((boundary) => {
          const rect = enclosureRect(boundary.nodes, positions);
          return <rect key={boundary.id} className="mm-enc" style={tone(boundary.id)} {...svgRect(rect)} rx="4" />;
        })}
        {Object.entries(positions).map(([id, point]) => (
          <rect key={id} className="mm-node" style={tone(boundaryOf(id))} x={point.x} y={point.y} width={NODE_W} height={NODE_H} rx="3" />
        ))}
        <rect className="mm-view" {...svgRect(view)} />
      </svg>
    </div>
  );
}

/** What the browser actually has registered, with the guarantees each tool
 *  declares. Reads live through `getTools()`, so it reflects the browser's
 *  registry rather than this module's intentions. */
function ToolRegistry({ tools, connection, onRun, busy }: {
  tools: DiscoveredTool[];
  connection: string;
  onRun: (name: string) => void;
  busy: string | null;
}) {
  return (
    <div className="registry">
      <p className="registry-note">
        {connection === "native"
          ? `${tools.length} tools registered with this browser through document.modelContext.`
          : `${tools.length} tools served through the local model-context shim. Enable the Chrome origin trial to register them with the browser.`}
      </p>
      {tools.map((tool) => (
        <div key={tool.name} className="tool-card">
          <div className="tool-card-head">
            <strong>{tool.name}</strong>
            <button className="quiet-button" disabled={busy === tool.name} onClick={() => onRun(tool.name)}>
              {busy === tool.name ? "Running" : "Run"}
            </button>
          </div>
          <p>{tool.description}</p>
          <div className="tool-hints">
            <span className={tool.annotations?.readOnlyHint ? "hint read" : "hint write"}>
              {tool.annotations?.readOnlyHint ? <><Lock size={9} />read-only</> : <><Wrench size={9} />writes UI state</>}
            </span>
            {tool.annotations?.untrustedContentHint && (
              <span className="hint untrusted"><ShieldAlert size={9} />untrusted content</span>
            )}
            {tool.origin && <span className="hint origin">{tool.origin.replace(/^https?:\/\//, "")}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

type AgentState = "idle" | "thinking" | "done";

function App() {
  const [selected, setSelected] = useState("req_checkout_42");
  const [highlighted, setHighlighted] = useState<string[]>([]);
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [eventFilter, setEventFilter] = useState<EventKind | "all">("all");
  const [panel, setPanel] = useState<"agent" | "event" | "tools">("agent");
  const [busyTool, setBusyTool] = useState<string | null>(null);
  const [surge, setSurge] = useState(false);
  const [frame, setFrame] = useState({ w: 1000, h: 620 });

  const canvas = useCanvas();
  const { theme, toggleTheme } = useTheme();
  const ui = useWorkspaceScale();
  const mcp = useWebMCP();
  const selectedEvent = useMemo(() => getEvent(selected), [selected]);
  const focused = highlighted.length > 0;

  useEffect(() => {
    const handleFocus = (raw: Event) => {
      const detail = (raw as CustomEvent<{ ids: string[] }>).detail;
      setHighlighted(detail.ids);
      if (detail.ids.length) setSelected(detail.ids[0]);
    };
    window.addEventListener("flowtrace:focus", handleFocus);
    return () => window.removeEventListener("flowtrace:focus", handleFocus);
  }, []);

  // The minimap needs the viewport in world units, so it needs the frame size.
  useEffect(() => {
    const element = canvas.frameRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setFrame({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, [canvas.frameRef]);

  // Changing the interface scale changes how much room the canvas has, so the
  // trace is re-framed rather than left parked off-centre.
  const lastScale = useRef(ui.scale);
  useEffect(() => {
    if (lastScale.current === ui.scale) return;
    lastScale.current = ui.scale;
    const id = requestAnimationFrame(() => canvas.fit());
    return () => cancelAnimationFrame(id);
  }, [ui.scale, canvas]);

  useEffect(() => {
    const onCommand = (raw: Event) => {
      const detail = (raw as CustomEvent<Record<string, string>>).detail;
      if (detail.action === "select") { setSelected(detail.eventId); setPanel("event"); }
      else if (detail.action === "filter") { setEventFilter(detail.filter as EventKind | "all"); if (detail.filter === "all") setHighlighted([]); }
      else if (detail.action === "frame") { if (detail.mode === "reset") canvas.reset(); else canvas.fit(); }
      else if (detail.action === "replay") void replay();
    };
    window.addEventListener("flowtrace:command", onCommand);
    return () => window.removeEventListener("flowtrace:command", onCommand);
  });

  const runTool = async (name: string, input: Record<string, unknown> = {}) => {
    setBusyTool(name);
    try {
      return await mcp.call(name, input);
    } finally {
      setBusyTool(null);
    }
  };

  const explainFailure = async () => {
    setAgentState("thinking");
    setHighlighted([]);
    setSurge(false);
    await new Promise((resolve) => setTimeout(resolve, 620));
    await runTool("explain_failure", { sessionId: "session_8291" });
    setAgentState("done");
    setSurge(true);
    setTimeout(() => setSurge(false), 1600);
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
    else await runTool("filter_events", { type: kind, sessionId: "session_8291" });
  };

  const select = (id: string) => { setSelected(id); setPanel("event"); };

  const enclosures = boundaries.map((boundary) => ({
    ...boundary,
    rect: enclosureRect(boundary.nodes, canvas.positions)
  }));

  const wires = edges.map((edge, index) => {
    const from = boundaryOf(edge.from);
    const to = boundaryOf(edge.to);
    const route = routeEdge(nodeRect(canvas.positions[edge.from]), nodeRect(canvas.positions[edge.to]), edge.axis);
    const crossing = from !== to;
    // A bent hop carries its timing over the middle of the run; a straight one
    // sets it alongside, so the label never sits on the wire.
    const bent = edge.axis === "h"
      ? Math.abs(route.from.y - route.to.y) > 1
      : Math.abs(route.from.x - route.to.x) > 1;
    const label = edge.axis === "h"
      ? { x: (route.from.x + route.to.x) / 2, y: route.from.y - 10, anchor: "middle" as const }
      : bent
        ? { x: (route.from.x + route.to.x) / 2, y: (route.from.y + route.to.y) / 2 - 8, anchor: "middle" as const }
        : { x: route.from.x + 12, y: (route.from.y + route.to.y) / 2 + 3, anchor: "start" as const };
    return {
      ...edge, index, route, crossing, label, tone: to,
      ports: crossing
        ? portsFor(edge.axis, route,
          enclosures.find((e) => e.id === from)!.rect,
          enclosures.find((e) => e.id === to)!.rect)
        : [],
      live: highlighted.includes(edge.to)
    };
  });

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="brand"><BrandMark />FLOWTRACE<em>α</em></span>
        <span className="topbar-divider" />
        <span className="breadcrumb">session_8291<b>·</b><strong>Checkout · agent run</strong></span>
        <span className="run-chip"><i />Failed</span>
        <span className="run-meta"><span>10:42:17</span><span>1.84s</span><span>6 events</span></span>
        <div className="topbar-actions">
          <span className={`mcp-chip ${mcp.connection}`} title={`${mcp.registered.length} tools registered`}>
            <CircleDot size={11} />
            {mcp.connection === "native" ? `WebMCP live · ${mcp.registered.length}` : mcp.connection === "preview" ? "WebMCP preview" : "Connecting"}
          </span>
          <div className="ui-scale">
            <span className="stencil">UI</span>
            <button aria-label="Shrink interface" title="Shrink interface (Alt −)" disabled={!ui.canZoomOut} onClick={ui.zoomOut}>−</button>
            <button className="ui-scale-level" onDoubleClick={ui.resetScale} title="Double-click to reset (Alt 0)">{Math.round(ui.scale * 100)}%</button>
            <button aria-label="Enlarge interface" title="Enlarge interface (Alt +)" disabled={!ui.canZoomIn} onClick={ui.zoomIn}>+</button>
          </div>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <span className="avatar">AK</span>
        </div>
      </header>

      <main className="workspace">
        <aside className="rail">
          <div className="rail-section">
            <div className="rail-head"><span className="stencil">Trace sessions</span><button aria-label="Filter sessions"><Filter size={12} /></button></div>
            <form
              className="search-box"
              toolname="search_traces"
              tooldescription="Search FlowTrace debugging sessions by name or session ID."
              onSubmit={(e) => e.preventDefault()}
            >
              <Search size={12} />
              <input
                name="query"
                aria-label="Search traces"
                placeholder="Search traces"
                toolparamdescription="Text to match against session names and IDs."
              />
              <kbd>/</kbd>
            </form>
            {sessions.map((session) => (
              <button key={session.id} className={`session-row ${session.id === "session_8291" ? "on" : ""}`}>
                <strong>{session.label}</strong>
                <span>{session.duration}{session.errorCount > 0 && <b>{session.errorCount}</b>}</span>
                <small>{session.id} · {session.startedAt}</small>
              </button>
            ))}
          </div>

          <div className="rail-section">
            <div className="rail-head"><span className="stencil">Capture sources</span></div>
            {(["webmcp", "network", "state", "render", "console"] as EventKind[]).map((kind) => {
              const owner = boundaryOf(events.find((event) => event.kind === kind)!.id);
              return (
                <button
                  key={kind}
                  className={`source-row ${eventFilter === kind ? "on" : ""}`}
                  style={tone(owner)}
                  onClick={() => filterEvents(eventFilter === kind ? "all" : kind)}
                >
                  <i />
                  <span>{kind === "webmcp" ? "WebMCP calls" : kind[0].toUpperCase() + kind.slice(1)}</span>
                  <b>{events.filter((event) => event.kind === kind).length}</b>
                </button>
              );
            })}
          </div>

          <div className="rail-section capture">
            <span><i className="capture-dot" />Capture active</span>
            <strong>localhost:3000</strong>
            <small>Listening for application events</small>
          </div>
        </aside>

        <section className="stage">
          <div
            ref={canvas.frameRef}
            className={`canvas-frame ${canvas.panning ? "panning" : ""}`}
            onWheel={canvas.onWheel}
            onPointerDown={canvas.startPan}
          >
            <div
              className="canvas-world"
              style={{ transform: `translate(${canvas.viewport.x}px, ${canvas.viewport.y}px) scale(${canvas.viewport.k})` }}
            >
              <svg className={`canvas-wires wires ${focused ? "focused" : ""}`} width="2400" height="1400">
                {enclosures.map((enclosure) => (
                  <g
                    key={enclosure.id}
                    className={`enclosure ${focused && !enclosure.nodes.some((id) => highlighted.includes(id)) ? "dim" : ""}`}
                    style={tone(enclosure.id)}
                  >
                    <rect {...svgRect(enclosure.rect)} rx="4" />
                    <rect className="tab" x={enclosure.rect.x} y={enclosure.rect.y} width={enclosure.label.length * 6.6 + 38} height="22" rx="4" />
                    <text x={enclosure.rect.x + 10} y={enclosure.rect.y + 15}>{enclosure.label}</text>
                    <text className="count" x={enclosure.rect.x + enclosure.label.length * 6.6 + 22} y={enclosure.rect.y + 15}>{enclosure.nodes.length}</text>
                  </g>
                ))}

                {wires.map((wire) => (
                  <g key={`${wire.from}-${wire.to}`} style={tone(wire.tone)}>
                    <path className="wire-halo" d={wire.route.d} />
                    <path className={`wire ${wire.live ? "live" : ""}`} d={wire.route.d} />
                    <circle className={`wire-head ${wire.live ? "live" : ""}`} cx={wire.route.to.x} cy={wire.route.to.y} r="3" />
                    {/* Ports mark where causality punches through a boundary wall. */}
                    {wire.ports.map((port, i) => (
                      <g key={i} className={`port ${wire.live ? "live" : ""}`}>
                        <line
                          x1={wire.axis === "h" ? port.x : port.x - 6}
                          y1={wire.axis === "h" ? port.y - 6 : port.y}
                          x2={wire.axis === "h" ? port.x : port.x + 6}
                          y2={wire.axis === "h" ? port.y + 6 : port.y}
                        />
                        <circle cx={port.x} cy={port.y} r="3.5" />
                      </g>
                    ))}
                    {(
                      <text
                        className={`hop-label ${wire.hop.endsWith("s") ? "slow" : ""}`}
                        x={wire.label.x}
                        y={wire.label.y}
                        textAnchor={wire.label.anchor}
                      >{wire.hop}</text>
                    )}
                    {surge && (
                      <path
                        className="surge"
                        d={wire.route.d}
                        style={{ "--len": "460", "--step": wire.index } as CSSProperties}
                      />
                    )}
                  </g>
                ))}
              </svg>

              {events.map((event, index) => {
                const point = canvas.positions[event.id];
                const boundary = boundaryOf(event.id);
                const Icon = kindIcon[event.kind];
                const active = selected === event.id || highlighted.includes(event.id);
                return (
                  <button
                    key={event.id}
                    className={`trace-node ${active ? "active" : ""} ${focused && !highlighted.includes(event.id) ? "muted" : ""} ${canvas.dragging === event.id ? "held" : ""}`}
                    style={{ ...tone(boundary), left: point.x, top: point.y, width: NODE_W, height: NODE_H, "--i": index } as CSSProperties}
                    onPointerDown={(e) => canvas.startNodeDrag(e, event.id, () => select(event.id))}
                    // Pointer selection runs through the drag handler; detail 0 is a keyboard press.
                    onClick={(e) => { if (e.detail === 0) select(event.id); }}
                  >
                    <span className="node-top">
                      <span className="node-kind"><Icon size={11} strokeWidth={2.2} />{kindLabel[event.kind]}</span>
                      <span className="node-dur">{event.duration}</span>
                    </span>
                    <strong>{event.title}</strong>
                    <small>{event.detail}</small>
                    <span className="node-state"><i className={`dot ${event.status}`} />{event.timestamp}</span>
                  </button>
                );
              })}

              <span
                className="fault-tag"
                style={{
                  left: canvas.positions.req_checkout_42.x,
                  top: canvas.positions.req_checkout_42.y + NODE_H + 10
                }}
              >Root cause</span>
            </div>
          </div>

          <div className="stage-bar">
            <div className="stage-title">
              <h1>One failure. <span>Every cause.</span></h1>
              <p>Five events across four runtime boundaries — <b>1.19s</b> of it spent crossing one.</p>
            </div>
            <div className="deck">
              <button className="primary" onClick={explainFailure}><Sparkles size={13} />Explain</button>
              <span className="sep" />
              <button onClick={replay} aria-label="Replay trace" title="Replay trace"><RotateCcw size={13} /></button>
              <button onClick={replay} aria-label="Play trace" title="Play trace"><Play size={13} /></button>
            </div>
          </div>

          <div className="deck stage-deck">
            <button aria-label="Zoom out" disabled={canvas.viewport.k <= 0.4} onClick={() => canvas.zoomBy(-0.1)}>−</button>
            <button className="zoom-level">{Math.round(canvas.viewport.k * 100)}%</button>
            <button aria-label="Zoom in" disabled={canvas.viewport.k >= 2} onClick={() => canvas.zoomBy(0.1)}>+</button>
            <span className="sep" />
            <button onClick={canvas.fit} aria-label="Fit to view" title="Fit to view"><Maximize2 size={13} /></button>
            <button onClick={canvas.reset} aria-label="Reset layout" title="Reset layout"><Crosshair size={13} /></button>
          </div>

          <Minimap positions={canvas.positions} viewport={canvas.viewport} frame={frame} />
        </section>

        <aside className="dock">
          <div className="dock-tabs">
            <button className={panel === "agent" ? "on" : ""} onClick={() => setPanel("agent")}><Sparkles size={12} />Agent</button>
            <button className={panel === "event" ? "on" : ""} onClick={() => setPanel("event")}><Code2 size={12} />Event</button>
            <button className={panel === "tools" ? "on" : ""} onClick={() => setPanel("tools")}><Braces size={12} />Tools</button>
            <button className="collapse" aria-label="Collapse panel"><PanelRightClose size={14} /></button>
          </div>

          {panel === "tools" ? (
            <ToolRegistry
              tools={mcp.registered}
              connection={mcp.connection}
              busy={busyTool}
              onRun={(name) => void runTool(name, defaultInputFor(name))}
            />
          ) : panel === "agent" ? (
            <div className="agent">
              <div className="agent-id">
                <span className="agent-glyph"><Sparkles size={14} /></span>
                <div><strong>FlowTrace Agent</strong><small>Reads the same trace you do</small></div>
              </div>
              <div className="thread">
                <div className="ask">Why did checkout fail?</div>
                {agentState === "idle" && (
                  <div className="empty">
                    <MessageSquareText size={19} />
                    <p>Ask the agent to investigate. It reads the graph through WebMCP — not screenshots.</p>
                    <button className="solid-button" onClick={explainFailure}><Sparkles size={13} />Run investigation</button>
                  </div>
                )}
                {agentState !== "idle" && (
                  <div className="call">
                    <div className="call-head">
                      <span><Braces size={12} />explain_failure</span>
                      {agentState === "done" ? <b><Check size={11} />184ms</b> : <b className="running"><i />running</b>}
                    </div>
                    <pre>{`{ "sessionId": "session_8291" }`}</pre>
                  </div>
                )}
                {agentState === "thinking" && <div className="working"><i /><i /><i /><span>Tracing causes</span></div>}
                {agentState === "done" && (
                  <div className="answer">
                    <p>The checkout failed at <button onClick={() => setSelected("req_checkout_42")}>POST /api/checkout</button>. The payment provider timed out during token exchange and returned <code>500</code>.</p>
                    <p>That left <button onClick={() => setSelected("state_payment_07")}>paymentToken</button> undefined. <code>CheckoutForm</code> then tried to call <code>.slice()</code> on it and crashed.</p>
                    <div className="verdict">
                      <span>Root cause</span>
                      <strong>Missing failure guard after token exchange</strong>
                      <small>CheckoutForm.tsx · line 87</small>
                    </div>
                    <div className="answer-actions">
                      <button className="quiet-button" onClick={() => setPanel("event")}><Code2 size={12} />Open source event</button>
                      <button className="quiet-button">Copy summary</button>
                    </div>
                  </div>
                )}
              </div>
              <div className="composer">
                <div className="chips">
                  <button onClick={explainFailure}>Explain failure</button>
                  <button onClick={() => void runTool("get_causal_chain", { eventId: selected })}>Trace selected</button>
                  <button onClick={() => void runTool("find_errors", { sessionId: "session_8291" })}>Find errors</button>
                </div>
                <div className="composer-box">
                  <textarea defaultValue="Why did checkout fail?" aria-label="Ask FlowTrace Agent" />
                  <button aria-label="Send message"><Send size={13} /></button>
                </div>
                <small>
                  <CircleDot size={9} />
                  Agent can invoke {toolNames.length} WebMCP tools
                  {mcp.lastCall && <> · last: {mcp.lastCall.name} {mcp.lastCall.ms}ms</>}
                </small>
              </div>
            </div>
          ) : (
            <div className="inspector">
              <div className="inspector-top">
                <span className="kind-tag" style={tone(boundaryOf(selectedEvent.id))}>{kindLabel[selectedEvent.kind]}</span>
                <span>{selectedEvent.timestamp}</span>
              </div>
              <h2>{selectedEvent.title}</h2>
              <p>{selectedEvent.detail}</p>
              <div className="props">
                {Object.entries(selectedEvent.meta).map(([key, value]) => (
                  <div key={key}><span>{key}</span><code>{typeof value === "object" ? JSON.stringify(value) : String(value)}</code></div>
                ))}
              </div>
              <button className="solid-button wide-button" onClick={() => void runTool("get_causal_chain", { eventId: selectedEvent.id })}>
                <Crosshair size={13} />Focus causal chain
              </button>
              <div className="json">
                <div><span className="stencil">Structured event</span><button>Copy</button></div>
                <pre>{JSON.stringify({ id: selectedEvent.id, type: selectedEvent.kind, boundary: boundaryOf(selectedEvent.id), status: selectedEvent.status, parentId: selectedEvent.parentId ?? null }, null, 2)}</pre>
              </div>
            </div>
          )}
        </aside>
      </main>

      <footer className="statusbar">
        <span><i className="dot ok" />Live capture</span>
        <span><Globe2 size={11} />localhost:3000</span>
        <span><Activity size={11} />{events.length} events</span>
        <b>FlowTrace SDK v0.1.0</b>
      </footer>
    </div>
  );
}

export default App;
