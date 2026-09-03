import { chromium } from "@playwright/test";
const D = "C:/Users/amrit/AppData/Local/Temp/claude/C--Users-amrit-hackathons-Webmcp/bacb5166-a9ea-4bc5-ba3f-7722358aaf2b/scratchpad";
const out = process.env.OUT || "c";
const browser = await chromium.launch({ channel: "chrome" });
for (const theme of ["dark", "light"]) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(t => localStorage.setItem("flowtrace:theme", t), theme);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
  await page.goto("http://127.0.0.1:5200/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${D}/${out}-${theme}.png` });
  if (errs.length) console.log(theme, "ERRORS:", errs.slice(0, 5));
  await ctx.close();
}
await browser.close();
console.log("done");
