export type EventKind = "webmcp" | "network" | "state" | "render" | "console" | "user";

export type TraceEvent = {
  id: string;
  sessionId: string;
  kind: EventKind;
  title: string;
  detail: string;
  timestamp: string;
  duration?: string;
  status: "ok" | "error" | "warning";
  parentId?: string;
  meta: Record<string, unknown>;
};

export type Session = {
  id: string;
  label: string;
  startedAt: string;
  duration: string;
  status: "failed" | "passed";
  errorCount: number;
};

export const sessions: Session[] = [
  { id: "session_8291", label: "Checkout · agent run", startedAt: "10:42:17", duration: "1.84s", status: "failed", errorCount: 2 },
  { id: "session_8289", label: "Product search", startedAt: "10:39:02", duration: "642ms", status: "passed", errorCount: 0 },
  { id: "session_8287", label: "Add to cart", startedAt: "10:36:44", duration: "911ms", status: "passed", errorCount: 0 },
];

export const events: TraceEvent[] = [
  {
    id: "evt_001", sessionId: "session_8291", kind: "user", title: "Buy now", detail: "Agent initiated checkout", timestamp: "10:42:17.082", duration: "0ms", status: "ok",
    meta: { actor: "ChatGPT", intent: "Complete checkout for cart_483" }
  },
  {
    id: "call_checkout_01", sessionId: "session_8291", kind: "webmcp", title: "checkout()", detail: "WebMCP tool call", timestamp: "10:42:17.086", duration: "1.21s", status: "error", parentId: "evt_001",
    meta: { tool: "checkout", input: { cartId: "cart_483", paymentMethod: "saved_card" }, caller: "browser-agent" }
  },
  {
    id: "req_checkout_42", sessionId: "session_8291", kind: "network", title: "POST /api/checkout", detail: "500 Internal Server Error", timestamp: "10:42:17.114", duration: "1.18s", status: "error", parentId: "call_checkout_01",
    meta: { method: "POST", status: 500, requestId: "req_checkout_42", response: { code: "PAYMENT_PROVIDER_TIMEOUT", message: "Token exchange timed out" } }
  },
  {
    id: "state_payment_07", sessionId: "session_8291", kind: "state", title: "paymentToken", detail: "resolved to undefined", timestamp: "10:42:18.301", duration: "2ms", status: "warning", parentId: "req_checkout_42",
    meta: { path: "checkout.paymentToken", previous: "pending", next: "undefined", source: "checkoutReducer" }
  },
  {
    id: "render_checkout_12", sessionId: "session_8291", kind: "render", title: "CheckoutForm", detail: "render #12", timestamp: "10:42:18.306", duration: "8ms", status: "warning", parentId: "state_payment_07",
    meta: { component: "CheckoutForm", render: 12, changedProps: ["paymentToken", "isSubmitting"] }
  },
  {
    id: "error_type_01", sessionId: "session_8291", kind: "console", title: "TypeError", detail: "Cannot read properties of undefined", timestamp: "10:42:18.314", duration: "—", status: "error", parentId: "render_checkout_12",
    meta: { message: "Cannot read properties of undefined (reading 'slice')", file: "CheckoutForm.tsx", line: 87, column: 31 }
  }
];

export const causalIds = events.map((event) => event.id);

export const kindLabel: Record<EventKind, string> = {
  webmcp: "MCP", network: "NET", state: "STATE", render: "RENDER", console: "ERROR", user: "INTENT"
};

export const toolNames = [
  "list_sessions", "inspect_session", "find_errors", "trace_request",
  "explain_failure", "get_causal_chain", "filter_events", "inspect_webmcp_call"
] as const;
