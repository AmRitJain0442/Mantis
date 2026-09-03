import { expect, test, type Page } from "@playwright/test";

/* ============================================================================
   WebMCP tool evals.

   Chrome's guidance is to evaluate tools before shipping them: an agent only
   ever sees the descriptor and the result, so both are checked here through
   the model-context surface rather than by importing the module.
   ========================================================================= */

type Envelope = {
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/** Registration happens once the app mounts, so wait for the model context to
 *  exist rather than assuming it is there the moment the document loads. */
const ready = (page: Page) => page.waitForFunction(() => Boolean(window.mantis));

const discover = async (page: Page) => {
  await ready(page);
  return page.evaluate(async () => window.mantis!.getTools());
};

const run = async (page: Page, name: string, input: Record<string, unknown> = {}) => {
  await ready(page);
  return page.evaluate(
    async ([toolName, args]) =>
      window.mantis!.invoke(toolName as string, args as Record<string, unknown>) as Promise<Envelope>,
    [name, input] as const
  );
};

/** Every tool, with arguments an agent could plausibly derive from discovery. */
const CASES: { name: string; input: Record<string, unknown>; expect: string }[] = [
  { name: "list_sessions", input: {}, expect: "session_8291" },
  { name: "inspect_session", input: { sessionId: "session_8291" }, expect: "POST /api/checkout" },
  { name: "find_errors", input: { sessionId: "session_8291" }, expect: "TypeError" },
  { name: "trace_request", input: { requestId: "req_checkout_42" }, expect: "checkout" },
  { name: "explain_failure", input: { sessionId: "session_8291" }, expect: "PAYMENT_PROVIDER_TIMEOUT" },
  { name: "get_causal_chain", input: { eventId: "state_payment_07" }, expect: "paymentToken" },
  { name: "filter_events", input: { type: "network", sessionId: "session_8291" }, expect: "POST /api/checkout" },
  { name: "inspect_webmcp_call", input: { callId: "call_checkout_01" }, expect: "checkout()" },
  { name: "select_event", input: { eventId: "error_type_01" }, expect: "TypeError" },
  { name: "set_source_filter", input: { type: "all" }, expect: "all" },
  { name: "frame_trace", input: { mode: "fit" }, expect: "fitted" },
  { name: "replay_session", input: { sessionId: "session_8291" }, expect: "Replaying" }
];

test.describe("WebMCP tool evals", () => {
  test("every tool is discoverable with a usable descriptor", async ({ page }) => {
    await page.goto("/");
    const tools = await discover(page);

    expect(tools.length).toBe(CASES.length);
    for (const tool of tools) {
      expect(tool.name, "tool needs a name").toBeTruthy();
      // Chrome's guidance: descriptions carry a 500-character budget.
      expect(tool.description.length, `${tool.name} description`).toBeGreaterThan(20);
      expect(tool.description.length, `${tool.name} description budget`).toBeLessThanOrEqual(500);
      expect(tool.annotations, `${tool.name} must declare annotations`).toBeDefined();
      expect(typeof tool.annotations!.readOnlyHint).toBe("boolean");
      expect(tool.inputSchema, `${tool.name} needs a schema`).toMatchObject({ type: "object" });
    }
  });

  test("read and write tools are labelled honestly", async ({ page }) => {
    await page.goto("/");
    const tools = await discover(page);
    const readOnly = tools.filter((tool) => tool.annotations?.readOnlyHint).map((tool) => tool.name);
    const writes = tools.filter((tool) => !tool.annotations?.readOnlyHint).map((tool) => tool.name);

    // Anything that moves the developer's view is not read-only.
    expect(writes.sort()).toEqual(["frame_trace", "replay_session", "select_event", "set_source_filter"]);
    expect(readOnly).toContain("explain_failure");

    // Results built from captured console and network payloads are untrusted.
    const untrusted = tools.filter((tool) => tool.annotations?.untrustedContentHint).map((tool) => tool.name);
    expect(untrusted).toContain("find_errors");
    expect(untrusted).not.toContain("list_sessions");
  });

  for (const item of CASES) {
    test(`${item.name} returns a usable result`, async ({ page }) => {
      await page.goto("/");
      const envelope = await run(page, item.name, item.input);

      expect(envelope.isError, `${item.name} should not error`).toBeFalsy();
      expect(envelope.content?.[0]?.type).toBe("text");
      expect(envelope.content[0].text).toContain(item.expect);
      // Output budget: 1.5K per call keeps tools inside agent guardrails.
      expect(envelope.content[0].text.length).toBeLessThanOrEqual(1500);
    });
  }

  test("bad input fails as a tool error, not a crash", async ({ page }) => {
    await page.goto("/");
    const envelope = await run(page, "get_causal_chain", { eventId: "does_not_exist" });

    expect(envelope.isError).toBe(true);
    expect(envelope.content[0].text).toContain("Unknown event");
  });

  test("write tools actually move the interface", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(600);

    await run(page, "select_event", { eventId: "error_type_01" });
    await expect(page.locator(".inspector h2")).toHaveText("TypeError");

    await run(page, "set_source_filter", { type: "network" });
    await expect(page.locator(".source-row.on")).toContainText("Network");
  });

  test("the search form is exposed as a declarative tool", async ({ page }) => {
    await page.goto("/");
    const form = page.locator("form.search-box");

    await expect(form).toHaveAttribute("toolname", "search_traces");
    await expect(form).toHaveAttribute("tooldescription", /Search Mantis/);
    await expect(form.locator("[toolparamdescription]")).toHaveCount(1);
  });

  test("the registry panel reports what is actually registered", async ({ page }) => {
    await page.goto("/");
    await page.locator('.dock-tabs button:has-text("Tools")').click();

    await expect(page.locator(".tool-card")).toHaveCount(CASES.length);
    await expect(page.locator(".tool-card").first()).toContainText("list_sessions");
    await expect(page.locator(".hint.write").first()).toBeVisible();
  });
});
