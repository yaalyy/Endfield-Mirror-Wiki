import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { sourceLink } from "../shared/paths.ts";
await mkdir("docs/reference", { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
for (const width of [1440, 375]) {
  const context = await browser.newContext({
    viewport: { width, height: width === 375 ? 812 : 1000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const pages = [
    {
      name: "operators",
      url: "https://wiki.skland.com/endfield/catalog?typeMainId=1&typeSubId=1",
    },
    {
      name: "weapons",
      url: "https://wiki.skland.com/endfield/catalog?typeMainId=1&typeSubId=2",
    },
    {
      name: "equipment",
      url: "https://wiki.skland.com/endfield/catalog?typeMainId=1&typeSubId=4",
    },
    ...["2503", "2338", "2502", "2501", "2764", "2763"].map((id, i) => ({
      name: id,
      url: sourceLink(i < 2 ? "1" : i < 4 ? "2" : "4", id),
    })),
  ];
  for (const target of pages) {
    try {
      await page.goto(target.url, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      const expected =
        target.name === "operators"
          ? "明河"
          : target.name === "weapons"
            ? "聚合工业"
            : target.name === "equipment"
              ? "集成实训刃装短锯"
              : (
                  {
                    "2503": "明河",
                    "2338": "祀",
                    "2502": "聚合工业",
                    "2501": "唤月",
                    "2764": "集成实训刃装短锯",
                    "2763": "集成实训刃装护手",
                  } as Record<string, string>
                )[target.name];
      await page
        .getByText(expected, { exact: true })
        .filter({ visible: true })
        .first()
        .waitFor({ timeout: 30000 });
      await page.waitForTimeout(1000);
      const text = await page.locator("body").innerText();
      await page.screenshot({
        path: `docs/reference/${target.name}-${width}.png`,
        fullPage: false,
      });
      results.push({
        ...target,
        width,
        title: await page.title(),
        text: text.slice(0, 8000),
      });
    } catch (e) {
      results.push({ ...target, width, error: String(e) });
    }
  }
  await context.close();
}
await browser.close();
await writeFile(
  "docs/reference/capture.json",
  JSON.stringify({ time: new Date().toISOString(), results }, null, 2),
);
console.log(
  results.map((x) => ({
    name: x.name,
    width: x.width,
    error: "error" in x ? x.error : undefined,
    title: "title" in x ? x.title : undefined,
  })),
);
