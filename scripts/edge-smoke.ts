import { chromium } from "playwright";
import { json, readJson } from "./io.ts";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.route("https://**/*", (r) => r.abort());
await page.goto("http://127.0.0.1:4173/Endfield-Mirror-Wiki/#/operators/2503");
await page.locator('[data-entry-id="2503"]').waitFor();
const heading = await page.locator("h1").innerText();
await page.screenshot({ path: "reports/screenshots/edge-2503-1440.png" });
await page.goto(
  "http://127.0.0.1:4173/Endfield-Mirror-Wiki/#/search?q=" +
    encodeURIComponent("若要动身"),
);
await page.locator(".search-result").first().waitFor({ timeout: 30000 });
await json("reports/edge-smoke.json", {
  snapshotId: (await readJson("dist/data/build-info.json")).snapshotId,
  time: new Date().toISOString(),
  browser: await browser.version(),
  heading,
  searchResults: await page.locator(".search-result").count(),
  errors,
});
await browser.close();
if (errors.length) throw Error(errors.join("\n"));
console.log({ heading, errors });
