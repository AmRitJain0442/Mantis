import { causalIds, events, kindLabel, sessions, type EventKind, type TraceEvent } from "./data";

/* ============================================================================
   WebMCP integration.

   Tools are registered against `document.modelContext` per the WebMCP imperative
   API, and every result is returned in the MCP envelope agents expect:
   a `content` array for the model to read, plus `structuredContent` carrying
   the machine-readable payload.

   Where the API is unavailable — it is behind an origin trial in Chrome 149 —
   the same tool table is served through a shim exposing the same surface, so
   the application always talks WebMCP whether or not the browser implements it.
   ========================================================================= */

export type ToolAnnotations = {
  readOnlyHint: boolean;
  /** Set when a result carries data captured from the page under test.
   *  Console output and network bodies are authored elsewhere and must be
   *  treated as untrusted by anything downstream. */
  untrustedContentHint?: boolean;
};

export type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: unknown;
  isError?: boolean;
};

export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: ToolAnnotations;
  execute: (input: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<ToolResult>;
};

/** A tool as seen through discovery, from either the browser or the shim. */
export type DiscoveredTool = {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  origin?: string;
};

type RegisterOptions = { signal?: AbortSignal; exposedTo?: string[] };

declare global {
  interface Document {
    modelContext?: {
      registerTool: (tool: unknown, options?: RegisterOptions) => Promise<void> | void;
      getTools?: (options?: { fromOrigins?: string[] }) => Promise<DiscoveredTool[]>;
      executeTool?: (tool: DiscoveredTool, input: unknown, options?: { signal?: AbortSignal }) => Promise<ToolResult>;
      addEventListener?: (type: string, listener: () => void) => void;
      removeEventListener?: (type: string, listener: () => void) => void;
    };
  }
  interface Window {
    mantis?: ModelContextLike & {
      tools: ToolDefinition[];
      invoke: (name: string, input?: Record<string, unknown>) => Promise<ToolResult>;
    };
  }
}

/* -- declarative WebMCP: form annotations that make a form a tool. React does
      not type these yet, so they are declared here. ------------------------ */
declare module "react" {
  interface FormHTMLAttributes<T> extends AriaAttributes, DOMAttributes<T> {
    toolname?: string;
    tooldescription?: string;
    toolautosubmit?: boolean | "";
  }
  interface InputHTMLAttributes<T> extends AriaAttributes, DOMAttributes<T> {
    toolparamdescription?: string;
  }
  interface SelectHTMLAttributes<T> extends AriaAttributes, DOMAttributes<T> {
    toolparamdescription?: string;
  }
  interface TextareaHTMLAttributes<T> extends AriaAttributes, DOMAttributes<T> {
    toolparamdescription?: string;
  }
}

/** The slice of the WebMCP surface this app consumes, so the real API and the
 *  shim are interchangeable at the call site. */
export type ModelContextLike = {
  getTools: () => Promise<DiscoveredTool[]>;
  executeTool: (tool: DiscoveredTool, input: unknown, options?: { signal?: AbortSignal }) => Promise<ToolResult>;
};

/* -- guardrails from the WebMCP tool security guidance --------------------- */
const MAX_DESCRIPTION = 500;
const MAX_PARAM_DESCRIPTION = 150;
const MAX_OUTPUT = 1500;

const clamp = (text: string, limit: number) =>
  text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;

const objectSchema = (properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: "object", properties, required, additionalProperties: false
});

/** Build the MCP envelope: a readable summary plus the structured payload. */
const result = (summary: string, structuredContent?: unknown): ToolResult => ({
  content: [{ type: "text", text: clamp(summary, MAX_OUTPUT) }],
  structuredContent
});

const focus = (ids: string[], source: string, summary: string) => {
  window.dispatchEvent(new CustomEvent("mantis:focus", { detail: { ids, source, summary } }));
};

/** Commands from write tools — the UI listens and applies them. */
const command = (detail: Record<string, unknown>) => {
  window.dispatchEvent(new CustomEvent("mantis:command", { detail }));
};

const getEvent = (id: unknown) => events.find((event) => event.id === id);
const requireEvent = (id: unknown) => {
  const event = getEvent(id);
  if (!event) throw new Error(`Unknown event: ${String(id)}`);
  return event;
};

/** Honour cancellation between steps of a tool that does real work. */
const checkAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException("Tool execution aborted", "AbortError");
};

const chainFrom = (event: TraceEvent) => {
  const upstream: TraceEvent[] = [];
  let cursor: TraceEvent | undefined = event;
  while (cursor) {
    upstream.unshift(cursor);
    cursor = cursor.parentId ? getEvent(cursor.parentId) : undefined;
  }
  const descendants: TraceEvent[] = [];
  let parent = event.id;
  for (;;) {
    const child = events.find((candidate) => candidate.parentId === parent);
    if (!child) break;
    descendants.push(child);
    parent = child.id;
  }
  return [...upstream, ...descendants];
};

const asAgentEvent = (event: TraceEvent) => ({
  id: event.id,
  type: event.kind,
  label: event.title,
  detail: event.detail,
  status: event.status,
  timestamp: event.timestamp,
  parentId: event.parentId ?? null,
  metadata: event.meta
});

const listEvents = (list: TraceEvent[]) =>
  list.map((event) => `${event.timestamp} ${kindLabel[event.kind]} ${event.title} — ${event.detail}`).join("\n");

/* -- read-only tools ------------------------------------------------------- */
const readTools: ToolDefinition[] = [
  {
    name: "list_sessions", title: "List trace sessions",
    description: "List available Mantis debugging sessions with status and error counts. Use this to find the session to investigate.",
    inputSchema: objectSchema(), annotations: { readOnlyHint: true },
    execute: async () => result(
      sessions.map((s) => `${s.id} — ${s.label}, ${s.status}, ${s.errorCount} error(s), ${s.duration}`).join("\n"),
      { sessions }
    )
  },
  {
    name: "inspect_session", title: "Inspect a trace session",
    description: "Return the ordered application events in a debugging session and focus that session in the Mantis UI.",
    inputSchema: objectSchema({ sessionId: { type: "string", description: clamp("Session ID returned by list_sessions", MAX_PARAM_DESCRIPTION) } }, ["sessionId"]),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async ({ sessionId }) => {
      const matches = events.filter((event) => event.sessionId === sessionId);
      if (!matches.length) throw new Error(`Unknown session: ${String(sessionId)}`);
      focus(matches.map((event) => event.id), "inspect_session", `Inspecting ${String(sessionId)}`);
      return result(
        `${matches.length} events in ${String(sessionId)}:\n${listEvents(matches)}`,
        { session: sessions.find((session) => session.id === sessionId), events: matches.map(asAgentEvent) }
      );
    }
  },
  {
    name: "find_errors", title: "Find errors",
    description: "Find console, network, state, and rendering failures in a trace session. Returns stable event IDs for deeper inspection.",
    inputSchema: objectSchema({ sessionId: { type: "string" } }, ["sessionId"]),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async ({ sessionId }) => {
      const matches = events.filter((event) => event.sessionId === sessionId && event.status === "error");
      focus(matches.map((event) => event.id), "find_errors", `${matches.length} errors found`);
      return result(
        `${matches.length} failing events:\n${listEvents(matches)}`,
        { sessionId, errorCount: matches.length, errors: matches.map(asAgentEvent) }
      );
    }
  },
  {
    name: "trace_request", title: "Trace a network request",
    description: "Trace what triggered a network request and every downstream application effect caused by its result.",
    inputSchema: objectSchema({ requestId: { type: "string", description: clamp("Network request event ID", MAX_PARAM_DESCRIPTION) } }, ["requestId"]),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async ({ requestId }) => {
      const chain = chainFrom(requireEvent(requestId));
      focus(chain.map((event) => event.id), "trace_request", `Traced request ${String(requestId)}`);
      return result(
        `${chain.length} events in the chain around ${String(requestId)}:\n${listEvents(chain)}`,
        { requestId, causalChain: chain.map(asAgentEvent) }
      );
    }
  },
  {
    name: "explain_failure", title: "Explain a failure",
    description: "Explain the root cause and causal chain of a failed session or error. Use this when the user asks why something failed.",
    inputSchema: objectSchema({ sessionId: { type: "string", description: clamp("Failed debugging session ID", MAX_PARAM_DESCRIPTION) } }, ["sessionId"]),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async ({ sessionId }, options) => {
      if (sessionId !== "session_8291") throw new Error(`No failure found in ${String(sessionId)}`);
      checkAborted(options?.signal);
      focus(causalIds.slice(1), "explain_failure", "Agent isolated a 5-event causal chain");
      const summary = "The checkout WebMCP call reached the payment API, which timed out during token exchange and returned 500. The reducer stored an undefined paymentToken; CheckoutForm then attempted to read it and crashed.";
      return result(`Root cause: POST /api/checkout returned HTTP 500 (PAYMENT_PROVIDER_TIMEOUT).\n${summary}`, {
        sessionId,
        rootCause: { eventId: "req_checkout_42", cause: "POST /api/checkout returned HTTP 500", code: "PAYMENT_PROVIDER_TIMEOUT" },
        triggeredBy: { eventId: "call_checkout_01", tool: "webmcp.checkout", actor: "browser-agent" },
        downstream: [
          { eventId: "state_payment_07", effect: "paymentToken became undefined" },
          { eventId: "render_checkout_12", effect: "CheckoutForm rerendered with invalid state" },
          { eventId: "error_type_01", effect: "UI crashed while reading paymentToken.slice" }
        ],
        summary
      });
    }
  },
  {
    name: "get_causal_chain", title: "Get causal chain",
    description: "Get upstream causes and downstream effects for any trace event, preserving execution order.",
    inputSchema: objectSchema({ eventId: { type: "string" } }, ["eventId"]),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async ({ eventId }) => {
      const chain = chainFrom(requireEvent(eventId));
      focus(chain.map((event) => event.id), "get_causal_chain", `Causal chain for ${String(eventId)}`);
      return result(
        `${chain.length} events around ${String(eventId)}:\n${listEvents(chain)}`,
        { selectedEventId: eventId, chain: chain.map(asAgentEvent) }
      );
    }
  },
  {
    name: "filter_events", title: "Filter trace events",
    description: "Filter trace events by source type across the active session and focus the matching events in the UI.",
    inputSchema: objectSchema({
      type: { type: "string", enum: ["network", "console", "webmcp", "state", "render", "user"] },
      sessionId: { type: "string" }
    }, ["type"]),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async ({ type, sessionId = "session_8291" }) => {
      const matches = events.filter((event) => event.sessionId === sessionId && event.kind === type as EventKind);
      focus(matches.map((event) => event.id), "filter_events", `Filtered to ${String(type)} events`);
      return result(
        `${matches.length} ${String(type)} events:\n${listEvents(matches)}`,
        { type, count: matches.length, events: matches.map(asAgentEvent) }
      );
    }
  },
  {
    name: "inspect_webmcp_call", title: "Inspect a WebMCP call",
    description: "Inspect a WebMCP tool invocation, including its agent caller, structured inputs, resulting request, and downstream effects.",
    inputSchema: objectSchema({ callId: { type: "string" } }, ["callId"]),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async ({ callId }) => {
      const event = requireEvent(callId);
      if (event.kind !== "webmcp") throw new Error(`${String(callId)} is not a WebMCP call`);
      const chain = chainFrom(event);
      focus(chain.map((item) => item.id), "inspect_webmcp_call", `Inspecting ${event.title}`);
      return result(
        `${event.title} triggered ${chain.length - 1} downstream events:\n${listEvents(chain.slice(1))}`,
        { call: asAgentEvent(event), downstream: chain.slice(1).map(asAgentEvent) }
      );
    }
  }
];

/* -- write tools: they change what the developer is looking at, nothing more,
      so they carry readOnlyHint: false and an agent may confirm before use. -- */
const writeTools: ToolDefinition[] = [
  {
    name: "select_event", title: "Select a trace event",
    description: "Open a trace event in the Mantis inspector so the developer is looking at the same event as the agent.",
    inputSchema: objectSchema({ eventId: { type: "string", description: clamp("Event ID to open in the inspector", MAX_PARAM_DESCRIPTION) } }, ["eventId"]),
    annotations: { readOnlyHint: false },
    execute: async ({ eventId }) => {
      const event = requireEvent(eventId);
      command({ action: "select", eventId: event.id });
      return result(`Selected ${event.title} in the inspector.`, { selected: asAgentEvent(event) });
    }
  },
  {
    name: "set_source_filter", title: "Filter the capture sources",
    description: "Set or clear the capture-source filter in the Mantis sidebar. Pass 'all' to clear the filter.",
    inputSchema: objectSchema({
      type: { type: "string", enum: ["all", "network", "console", "webmcp", "state", "render", "user"], description: clamp("Source to isolate, or 'all' to clear", MAX_PARAM_DESCRIPTION) }
    }, ["type"]),
    annotations: { readOnlyHint: false },
    execute: async ({ type }) => {
      command({ action: "filter", filter: type });
      return result(`Capture filter set to ${String(type)}.`, { filter: type });
    }
  },
  {
    name: "frame_trace", title: "Frame the trace on the canvas",
    description: "Fit the whole causal graph into view on the Mantis canvas, or restore the authored node layout.",
    inputSchema: objectSchema({
      mode: { type: "string", enum: ["fit", "reset"], description: clamp("'fit' scales to view; 'reset' restores the layout", MAX_PARAM_DESCRIPTION) }
    }, ["mode"]),
    annotations: { readOnlyHint: false },
    execute: async ({ mode }) => {
      command({ action: "frame", mode });
      return result(`Canvas ${mode === "reset" ? "layout reset" : "fitted to view"}.`, { mode });
    }
  },
  {
    name: "replay_session", title: "Replay a trace session",
    description: "Step the Mantis canvas through a session's events in order so the developer can watch the failure unfold.",
    inputSchema: objectSchema({ sessionId: { type: "string" } }, ["sessionId"]),
    annotations: { readOnlyHint: false },
    execute: async ({ sessionId = "session_8291" }, options) => {
      checkAborted(options?.signal);
      command({ action: "replay", sessionId });
      return result(`Replaying ${String(sessionId)} across ${events.length} events.`, { sessionId, steps: events.length });
    }
  }
];

export const tools: ToolDefinition[] = [...readTools, ...writeTools];
export const toolNames = tools.map((tool) => tool.name);

const descriptorOf = (tool: ToolDefinition): DiscoveredTool => ({
  name: tool.name,
  description: clamp(tool.description, MAX_DESCRIPTION),
  inputSchema: tool.inputSchema,
  annotations: tool.annotations,
  origin: window.location.origin
});

const runLocal = async (name: string, input: Record<string, unknown> = {}, signal?: AbortSignal): Promise<ToolResult> => {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Unknown Mantis tool: ${name}`);
  try {
    return await tool.execute(input, { signal });
  } catch (error) {
    return { content: [{ type: "text", text: `${name} failed: ${(error as Error).message}` }], isError: true };
  }
};

/** Same surface as `document.modelContext`, served locally so the UI keeps
 *  working in browsers without the origin trial. */
const shim: Window["mantis"] = {
  tools,
  getTools: async () => tools.map(descriptorOf),
  executeTool: async (tool, input, options) =>
    runLocal(tool.name, (input ?? {}) as Record<string, unknown>, options?.signal),
  invoke: (name, input = {}) => runLocal(name, input)
};

export type RegistrationState = {
  supported: boolean;
  registered: number;
  /** Aborting this unregisters every tool this page put on the page. */
  controller: AbortController;
};

export async function registerMantisTools(): Promise<RegistrationState> {
  window.mantis = shim;
  const controller = new AbortController();

  if (!document.modelContext?.registerTool) {
    return { supported: false, registered: 0, controller };
  }

  const outcomes = await Promise.allSettled(
    tools.map((tool) => document.modelContext!.registerTool(
      {
        name: tool.name,
        description: clamp(tool.description, MAX_DESCRIPTION),
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
        execute: (input: Record<string, unknown>, options?: { signal?: AbortSignal }) =>
          tool.execute(input ?? {}, options)
      },
      { signal: controller.signal }
    ))
  );

  return {
    supported: true,
    registered: outcomes.filter((outcome) => outcome.status === "fulfilled").length,
    controller
  };
}

/** Prefer the browser's implementation; fall back to the shim. */
export const modelContext = (): ModelContextLike => {
  const native = document.modelContext;
  if (native?.getTools && native.executeTool) {
    return {
      getTools: () => native.getTools!(),
      // Verified against Chrome 152's origin-trial build: executeTool expects
      // the tool's arguments serialized as a JSON string, not a plain object
      // — passing an object throws "Failed to parse input arguments". Our own
      // shim takes a plain object, so this conversion belongs here, at the
      // single seam between the two, rather than leaking into every caller.
      executeTool: (tool, input, options) => native.executeTool!(tool, JSON.stringify(input ?? {}), options)
    };
  }
  return shim;
};
