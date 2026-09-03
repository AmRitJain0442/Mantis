# FlowTrace

### A shared debugging environment for humans and agents

FlowTrace turns disconnected browser telemetry into one causal graph. Developers get a visual timeline; AI agents get structured, read-only WebMCP tools over the exact same trace.

![The FlowTrace canvas](preview-dark.png)

When an agent calls `explain_failure`, FlowTrace returns machine-readable causes and simultaneously focuses those events in the UI:

```text
WebMCP checkout() → POST /api/checkout → HTTP 500
                  → paymentToken undefined → CheckoutForm crash
```

## What is working

- Interactive causal graph spanning agent intent, WebMCP, network, state, render, and console events
- Synchronized agent/UI focus through stable event IDs and `flowtrace:focus` browser events
- Eight real WebMCP tools registered with `document.modelContext.registerTool`
- Built-in checkout-failure demo with replay, source filters, event inspection, and agent explanation
- Read-only tool annotations and strict JSON Schemas
- Browser-safe preview API for environments where experimental WebMCP is unavailable
- Light and dark themes that follow the OS until you pick one, then remember the choice
- An interface scale (Alt +, Alt −, Alt 0) that resizes the whole shell independently of the canvas's own zoom, and re-frames the trace when it changes
- A spatial canvas you can pan, zoom, and rearrange: runtime boundaries are drawn as enclosures, and dragging a node grows its boundary rather than escaping it
- Boundary ports — every hop that crosses a runtime boundary punches through the enclosure wall at a marked port, carrying the latency of that crossing
- Responsive, keyboard-focusable developer interface

## WebMCP tools

### Read-only (`readOnlyHint: true`)

| Tool | Purpose |
| --- | --- |
| `list_sessions` | Find available trace sessions |
| `inspect_session` | Return all ordered events in a session |
| `find_errors` | Find failures and their stable event IDs |
| `trace_request` | Trace a request from its trigger through downstream effects |
| `explain_failure` | Return a structured root-cause explanation |
| `get_causal_chain` | Get upstream causes and downstream effects for any event |
| `filter_events` | Filter by network, console, WebMCP, state, render, or user events |
| `inspect_webmcp_call` | Inspect an agent tool call and everything it triggered |

### Writes UI state (`readOnlyHint: false`)

| Tool | Purpose |
| --- | --- |
| `select_event` | Open an event in the inspector so human and agent look at the same thing |
| `set_source_filter` | Set or clear the capture-source filter |
| `frame_trace` | Fit the causal graph to view, or restore the authored layout |
| `replay_session` | Step the canvas through a session so the failure unfolds |

Every tool whose result is built from captured console or network payloads also
carries `untrustedContentHint` — that data is authored by the page under test,
not by FlowTrace, and downstream consumers should treat it accordingly.

A declarative tool is registered too: the trace search box carries `toolname`,
`tooldescription` and `toolparamdescription`, so the browser can drive the form
directly.


## How the integration works

The core lives in [`src/webmcp.ts`](src/webmcp.ts). Results come back in the MCP
envelope — a `content` array the model reads, plus `structuredContent` carrying
the payload:

```ts
return {
  content: [{ type: "text", text: "Root cause: POST /api/checkout returned HTTP 500…" }],
  structuredContent: { rootCause: { eventId: "req_checkout_42", code: "PAYMENT_PROVIDER_TIMEOUT" } }
};
```

Tools are registered with an `AbortController` so they unregister cleanly, and
`execute` receives a signal so long calls can be cancelled:

```ts
await document.modelContext.registerTool(tool, { signal: controller.signal });
```

The application is a client of its own tools. Nothing in the UI reaches into the
module directly — every action goes through discovery and execution, the same
path an agent takes:

```ts
const tool = (await modelContext().getTools()).find((t) => t.name === "explain_failure");
await modelContext().executeTool(tool, { sessionId: "session_8291" });
```

Tool execution emits a shared focus event:

```ts
window.dispatchEvent(new CustomEvent("flowtrace:focus", {
  detail: {
    ids: ["req_checkout_42", "state_payment_07", "error_type_01"],
    source: "explain_failure"
  }
}));
```

### Enabling WebMCP in the browser

WebMCP is behind an origin trial in Chrome 149. Register the deployed origin at
the [WebMCP origin trial](https://developer.chrome.com/origintrials/#/register_trial/4163014905550602241)
and paste the token into the commented `<meta http-equiv="origin-trial">` tag in
[`index.html`](index.html). The status chip then reads **WebMCP live** with the
registered tool count.

Without a token, FlowTrace serves the identical surface — `getTools`,
`executeTool`, annotations and all — through its own model-context shim, and the
chip reads **WebMCP preview**. The application behaves the same either way; only
the registration target changes.

The **Tools** tab in the right dock lists what is actually registered, reading
live from `getTools()` and refreshing on `toolchange`. Each tool shows its
annotations and can be run from the panel.

## Evals

`tests/webmcp-evals.spec.ts` follows Chrome's
[eval guidance](https://developer.chrome.com/docs/ai/webmcp/evals): every tool is
exercised through the model-context surface, and the suite checks descriptors are
usable, annotations are honest, the description and output budgets hold, and bad
input returns a tool error rather than crashing.

```bash
npm test
```

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

Then open `http://localhost:5173`.

For a production check:

```bash
npm run build
npm run preview
```

## Try the demo

1. Open the failed `Checkout · agent run` session.
2. Select events in the graph to inspect their structured metadata.
3. Choose **Ask agent to explain** or **Run investigation**.
4. FlowTrace invokes `explain_failure({ sessionId: "session_8291" })`.
5. Watch the agent response and causal graph focus on the same events.

In a browser without WebMCP support, the same tools are available from DevTools for development:

```js
await window.flowTrace.invoke("explain_failure", {
  sessionId: "session_8291"
});
```

For native testing, use ChatGPT's in-app browser or enable WebMCP testing in Chrome at `chrome://flags/#enable-webmcp-testing`, then ask the browser agent to list and inspect FlowTrace sessions.

## Architecture

```text
Application telemetry
        ↓
Normalized TraceEvent graph
        ├──→ React visual debugger (human view)
        └──→ document.modelContext tools (agent view)
                       ↓
                flowtrace:focus
                       ↓
             synchronized selection
```

The current hackathon slice uses a deterministic ecommerce trace so judges can reproduce the complete story. The data boundary is isolated in [`src/data.ts`](src/data.ts), ready to be replaced by a browser SDK or streamed capture source.

## Stack

React 19, TypeScript, Vite, Lucide icons, and the browser-native [WebMCP API](https://webmachinelearning.github.io/webmcp/).

## License

[MIT](LICENSE)
