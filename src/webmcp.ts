import { causalIds, events, sessions, type EventKind, type TraceEvent } from "./data";

type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean };
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};

declare global {
  interface Document {
    modelContext?: {
      registerTool: (tool: ToolDefinition) => Promise<void> | void;
    };
  }
  interface Window {
    flowTrace?: {
      tools: ToolDefinition[];
      invoke: (name: string, input?: Record<string, unknown>) => Promise<unknown>;
    };
  }
}

const objectSchema = (properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: "object", properties, required, additionalProperties: false
});

const focus = (ids: string[], source: string, summary: string) => {
  window.dispatchEvent(new CustomEvent("flowtrace:focus", { detail: { ids, source, summary } }));
};

const getEvent = (id: unknown) => events.find((event) => event.id === id);
const requireEvent = (id: unknown) => {
  const event = getEvent(id);
  if (!event) throw new Error(`Unknown event: ${String(id)}`);
  return event;
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
  while (true) {
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

const tools: ToolDefinition[] = [
  {
    name: "list_sessions", title: "List trace sessions",
    description: "List available FlowTrace debugging sessions with status and error counts. Use this to find the session to investigate.",
    inputSchema: objectSchema(), annotations: { readOnlyHint: true },
    execute: async () => ({ sessions })
  },
  {
    name: "inspect_session", title: "Inspect a trace session",
    description: "Return the ordered application events in a debugging session and focus that session in the FlowTrace UI.",
    inputSchema: objectSchema({ sessionId: { type: "string", description: "Session ID returned by list_sessions" } }, ["sessionId"]), annotations: { readOnlyHint: true },
    execute: async ({ sessionId }) => {
      const matches = events.filter((event) => event.sessionId === sessionId);
      if (!matches.length) throw new Error(`Unknown session: ${String(sessionId)}`);
      focus(matches.map((event) => event.id), "inspect_session", `Inspecting ${String(sessionId)}`);
      return { session: sessions.find((session) => session.id === sessionId), events: matches.map(asAgentEvent) };
    }
  },
  {
    name: "find_errors", title: "Find errors",
    description: "Find console, network, state, and rendering failures in a trace session. Returns stable event IDs for deeper inspection.",
    inputSchema: objectSchema({ sessionId: { type: "string" } }, ["sessionId"]), annotations: { readOnlyHint: true },
    execute: async ({ sessionId }) => {
      const matches = events.filter((event) => event.sessionId === sessionId && event.status === "error");
      focus(matches.map((event) => event.id), "find_errors", `${matches.length} errors found`);
      return { sessionId, errorCount: matches.length, errors: matches.map(asAgentEvent) };
    }
  },
  {
    name: "trace_request", title: "Trace a network request",
    description: "Trace what triggered a network request and every downstream application effect caused by its result.",
    inputSchema: objectSchema({ requestId: { type: "string", description: "Network request event ID" } }, ["requestId"]), annotations: { readOnlyHint: true },
    execute: async ({ requestId }) => {
      const chain = chainFrom(requireEvent(requestId));
      focus(chain.map((event) => event.id), "trace_request", `Traced request ${String(requestId)}`);
      return { requestId, causalChain: chain.map(asAgentEvent) };
    }
  },
  {
    name: "explain_failure", title: "Explain a failure",
    description: "Explain the root cause and causal chain of a failed session or error. Use this when the user asks why something failed.",
    inputSchema: objectSchema({ sessionId: { type: "string", description: "Failed debugging session ID" } }, ["sessionId"]), annotations: { readOnlyHint: true },
    execute: async ({ sessionId }) => {
      if (sessionId !== "session_8291") throw new Error(`No failure found in ${String(sessionId)}`);
      focus(causalIds.slice(1), "explain_failure", "Agent isolated a 5-event causal chain");
      return {
        sessionId,
        rootCause: { eventId: "req_checkout_42", cause: "POST /api/checkout returned HTTP 500", code: "PAYMENT_PROVIDER_TIMEOUT" },
        triggeredBy: { eventId: "call_checkout_01", tool: "webmcp.checkout", actor: "browser-agent" },
        downstream: [
          { eventId: "state_payment_07", effect: "paymentToken became undefined" },
          { eventId: "render_checkout_12", effect: "CheckoutForm rerendered with invalid state" },
          { eventId: "error_type_01", effect: "UI crashed while reading paymentToken.slice" }
        ],
        summary: "The checkout WebMCP call reached the payment API, which timed out during token exchange and returned 500. The reducer stored an undefined paymentToken; CheckoutForm then attempted to read it and crashed."
      };
    }
  },
  {
    name: "get_causal_chain", title: "Get causal chain",
    description: "Get upstream causes and downstream effects for any trace event, preserving execution order.",
    inputSchema: objectSchema({ eventId: { type: "string" } }, ["eventId"]), annotations: { readOnlyHint: true },
    execute: async ({ eventId }) => {
      const chain = chainFrom(requireEvent(eventId));
      focus(chain.map((event) => event.id), "get_causal_chain", `Causal chain for ${String(eventId)}`);
      return { selectedEventId: eventId, chain: chain.map(asAgentEvent) };
    }
  },
  {
    name: "filter_events", title: "Filter trace events",
    description: "Filter trace events by source type across the active session and focus the matching events in the UI.",
    inputSchema: objectSchema({ type: { type: "string", enum: ["network", "console", "webmcp", "state", "render", "user"] }, sessionId: { type: "string" } }, ["type"]), annotations: { readOnlyHint: true },
    execute: async ({ type, sessionId = "session_8291" }) => {
      const matches = events.filter((event) => event.sessionId === sessionId && event.kind === type as EventKind);
      focus(matches.map((event) => event.id), "filter_events", `Filtered to ${String(type)} events`);
      return { type, count: matches.length, events: matches.map(asAgentEvent) };
    }
  },
  {
    name: "inspect_webmcp_call", title: "Inspect a WebMCP call",
    description: "Inspect a WebMCP tool invocation, including its agent caller, structured inputs, resulting request, and downstream effects.",
    inputSchema: objectSchema({ callId: { type: "string" } }, ["callId"]), annotations: { readOnlyHint: true },
    execute: async ({ callId }) => {
      const event = requireEvent(callId);
      if (event.kind !== "webmcp") throw new Error(`${String(callId)} is not a WebMCP call`);
      const chain = chainFrom(event);
      focus(chain.map((item) => item.id), "inspect_webmcp_call", `Inspecting ${event.title}`);
      return { call: asAgentEvent(event), downstream: chain.slice(1).map(asAgentEvent) };
    }
  }
];

export const registerFlowTraceTools = async () => {
  window.flowTrace = {
    tools,
    invoke: async (name, input = {}) => {
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`Unknown FlowTrace tool: ${name}`);
      return tool.execute(input);
    }
  };

  if (!document.modelContext?.registerTool) return { supported: false, registered: 0 };
  const results = await Promise.allSettled(tools.map((tool) => document.modelContext!.registerTool(tool)));
  return { supported: true, registered: results.filter((result) => result.status === "fulfilled").length };
};
