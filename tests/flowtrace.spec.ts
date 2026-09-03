import { expect, test } from "@playwright/test";

test("renders the complete checkout failure trace", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/FlowTrace/);
  await expect(page.getByRole("heading", { name: "One failure. Every cause." })).toBeVisible();
  await expect(page.locator(".trace-node")).toHaveCount(6);
  await expect(page.getByText("checkout()", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("POST /api/checkout", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("TypeError", { exact: true }).first()).toBeVisible();

  const zoom = page.locator(".zoom-level");
  const before = Number((await zoom.innerText()).replace("%", ""));
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoom).toHaveText(`${before + 10}%`);
});

test("agent explanation and graph focus stay synchronized", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Run investigation/i }).click();

  await expect(page.getByText("Missing failure guard after token exchange")).toBeVisible();
  await expect(page.locator(".trace-node.active")).toHaveCount(5);
  await expect(page.locator(".trace-node.muted")).toHaveCount(1);
});

test("development API returns the same structured causal graph", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    return window.flowTrace?.invoke("explain_failure", { sessionId: "session_8291" });
  });

  expect(result).toMatchObject({
    sessionId: "session_8291",
    rootCause: {
      eventId: "req_checkout_42",
      code: "PAYMENT_PROVIDER_TIMEOUT"
    },
    triggeredBy: { tool: "webmcp.checkout" }
  });
});

test("the theme switch flips the workspace and survives a reload", async ({ page }) => {
  await page.goto("/");
  const root = page.locator("html");
  const startedDark = (await root.getAttribute("data-theme")) === "dark";

  await page.getByRole("button", { name: /Switch to (light|dark) theme/ }).click();
  await expect(root).toHaveAttribute("data-theme", startedDark ? "light" : "dark");

  await page.reload();
  await expect(root).toHaveAttribute("data-theme", startedDark ? "light" : "dark");
});

test("nodes can be dragged and the canvas can be reframed", async ({ page }) => {
  await page.goto("/");
  const node = page.locator(".trace-node").first();
  // Nodes animate in; measure once they have settled.
  await page.waitForTimeout(700);
  const before = (await node.boundingBox())!;

  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 - 60, before.y + before.height / 2 + 150, { steps: 10 });
  await page.mouse.up();

  const after = (await node.boundingBox())!;
  expect(Math.abs(after.y - before.y)).toBeGreaterThan(80);

  // Reset restores the authored layout.
  await page.getByRole("button", { name: "Reset layout" }).click();
  const restored = (await node.boundingBox())!;
  expect(Math.abs(restored.y - before.y)).toBeLessThan(4);
});

test("the interface scale resizes the whole shell and persists", async ({ page }) => {
  await page.goto("/");
  const level = page.locator(".ui-scale-level");
  await expect(level).toHaveText("100%");

  await page.getByRole("button", { name: "Enlarge interface" }).click();
  await expect(level).toHaveText("110%");
  await expect(page.locator("html")).toHaveAttribute("style", /zoom:\s*1\.1/);

  // Scaling the shell must not leave the page scrolling behind the viewport.
  const fits = await page.evaluate(() =>
    document.documentElement.scrollHeight <= document.documentElement.clientHeight + 1);
  expect(fits).toBe(true);

  await page.reload();
  await expect(page.locator(".ui-scale-level")).toHaveText("110%");
});
