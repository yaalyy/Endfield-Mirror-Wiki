import { test, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import type { Catalog, Detail, Inline, Node } from "../../shared/types.ts";
import { convert } from "../../scripts/content.ts";
function inlineFragments(inlines: Inline[]): string[] {
  return inlines.flatMap((i) =>
    i.kind === "annotation"
      ? [...inlineFragments(i.inline || []), ...fragments(i.nodes || [])]
      : i.kind === "gameIcon"
        ? []
        : [
            i.kind === "entry"
              ? catalog.references[i.entryId!]?.name || `词条 ${i.entryId}`
              : i.text,
          ],
  );
}
function fragments(nodes: Node[]): string[] {
  return nodes
    .flatMap((n) => [
      n.description || "",
      ...inlineFragments(n.inline || []),
      ...fragments(n.children || []),
      ...(n.listItems || []).flatMap(fragments),
      ...(n.cells || []).flatMap((c) => fragments(c.nodes)),
    ])
    .filter(Boolean);
}
const catalog: Catalog = JSON.parse(
  await readFile("dist/data/catalog.json", "utf8"),
);
// Disable animated scrolling in automation so a pointer gesture stays on its target.
test.use({ trace: "retain-on-failure", reducedMotion: "reduce" });
test.beforeEach(async ({ page }) => {
  await page.route("https://**/*", (route) => route.abort("blockedbyclient"));
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus && info.title.startsWith("语音")) {
    const state = await page.evaluate(() => ({
      events: Reflect.get(window, "__mediaEvents"),
      elements: (Reflect.get(window, "__mediaElements") || []).map(
        (e: HTMLMediaElement) => ({
          src: e.src,
          paused: e.paused,
          connected: e.isConnected,
        }),
      ),
      buttons: [...document.querySelectorAll(".audio-row>button")]
        .slice(0, 2)
        .map((e) => e.getAttribute("aria-label")),
    }));
    await info.attach("media-state", {
      body: JSON.stringify(state, null, 2),
      contentType: "application/json",
    });
    console.log("Media failure state", state);
  }
});
test("全部词条、全部标签正文与基础渲染覆盖", async ({ page, browserName }) => {
  test.setTimeout(1200000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const missing: string[] = [];
  page.on("response", (r) => {
    if (r.url().startsWith("http://127.0.0.1") && r.status() >= 400)
      missing.push(r.url());
  });
  let entries = 0,
    tabs = 0,
    textFragments = 0;
  await page.goto("#/");
  for (const category of catalog.categories)
    for (const entry of category.items) {
      const detail: Detail = JSON.parse(
        await readFile(`dist/${entry.detailPath}`, "utf8"),
      );
      await page.goto(`#/${entry.category}/${entry.id}`);
      await expect(page.locator("[data-entry-id]")).toHaveAttribute(
        "data-entry-id",
        entry.id,
      );
      await expect(page.locator("h1")).toHaveText(entry.name);
      const brief = page.locator(".description");
      for (const fragment of fragments(detail.description))
        expect((await brief.innerText()).replace(/\s/g, "")).toContain(
          fragment.replace(/\s/g, ""),
        );
      for (const chapter of detail.chapters) {
        await expect(
          page.locator(`[data-chapter-id="${chapter.id}"]`),
        ).toBeAttached();
        for (const widget of chapter.widgets) {
          const el = page.locator(`[data-widget-id="${widget.id}"]`);
          await expect(el).toBeAttached();
          for (const tab of widget.tabs) {
            if (widget.tabs.length > 1)
              await el
                .locator(`[data-tab-id="${tab.id}"]`)
                .dispatchEvent("click");
            const panel = el.locator(`[data-active-tab="${tab.id}"]`);
            await expect(panel).toBeAttached();
            const actual = (await panel.innerText()).replace(/\s/g, "");
            const expected = [
              tab.intro?.name,
              tab.intro?.type,
              ...fragments(tab.intro?.nodes || []),
              ...fragments(tab.nodes),
              ...tab.audio.flatMap((a) => [a.title, a.profile]),
            ].filter(Boolean);
            for (const fragment of expected) {
              expect(actual, `${entry.id}/${widget.id}/${tab.id}`).toContain(
                fragment!.replace(/\s/g, ""),
              );
              textFragments++;
            }
            tabs++;
          }
        }
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 2,
      );
      expect(overflow, "页面整体横向溢出 " + entry.id).toBe(false);
      entries++;
      if (entries % 50 === 0)
        console.log(
          `${browserName}: ${entries} entries / ${tabs} tabs checked`,
        );
    }
  expect(errors).toEqual([]);
  expect(missing).toEqual([]);
  await mkdir("reports", { recursive: true });
  await writeFile(
    `reports/coverage-${browserName}.json`,
    JSON.stringify(
      {
        snapshotId: catalog.snapshotId,
        entries,
        tabs,
        textFragments,
        errors,
        missing,
      },
      null,
      2,
    ),
  );
});
test("真实注释可用键盘折叠，图标从本地加载，移动端无溢出", async ({ page }) => {
  const fixture = JSON.parse(
    await readFile("tests/fixtures/2925-annotation.json", "utf8"),
  );
  const entry = catalog.categories[0].items[0];
  const detail: Detail = JSON.parse(
    await readFile(`dist/${entry.detailPath}`, "utf8"),
  );
  const iconUrl = Object.values(catalog.references).find((r) => r.cover)?.cover;
  expect(iconUrl).toMatch(/^media\//);
  const converted = convert(
    {
      brief: { description: fixture.document },
      document: {},
    },
    entry,
    catalog.snapshotId,
    {},
    catalog.references,
    Object.fromEntries(
      fixture.icons.map((icon: { id: string; title: string }) => [
        icon.id,
        { url: iconUrl!, title: icon.title },
      ]),
    ),
  );
  await page.route(`**/${entry.detailPath}`, (route) =>
    route.fulfill({
      json: { ...detail, description: converted.detail.description },
    }),
  );
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`#/${entry.category}/${entry.id}`);
  const note = page.locator(".description .annotation-note");
  await expect(note).toHaveCount(1);
  await expect(note).toContainText("对敌人造成一定");
  const icon = note.locator("img.game-icon").first();
  await expect(icon).toHaveAttribute("alt", "自然附着");
  await expect
    .poll(() =>
      icon.evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
      ),
    )
    .toBe(true);
  const summary = note.locator("summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(note).not.toHaveAttribute("open");
  await page.keyboard.press("Enter");
  await expect(note).toHaveAttribute("open");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 2,
    ),
  ).toBe(true);
});

for (const width of [375, 768, 1440])
  test(`分类与代表详情响应式 ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 });
    for (const category of catalog.categories) {
      await page.goto(`#/${category.key}`);
      await expect(page.locator(".entry-card")).toHaveCount(
        category.items.length,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 2,
        ),
      ).toBe(true);
      const group = page.locator(".filter-group").first();
      await group.locator("summary").click();
      const checkbox = group.locator("input").first();
      await checkbox.check();
      const filtered = await page.locator(".entry-card").count();
      expect(filtered).toBeLessThanOrEqual(category.items.length);
      await page.reload();
      await expect(page.locator(".filter-group input").first()).toBeChecked();
      await page.getByRole("button", { name: "清除筛选" }).click();
      await expect(page.locator(".entry-card")).toHaveCount(
        category.items.length,
      );
      for (const entry of category.items.slice(0, 2)) {
        await page.goto(`#/${category.key}/${entry.id}`);
        await expect(page.locator("[data-entry-id]")).toHaveAttribute(
          "data-entry-id",
          entry.id,
        );
        await page.waitForTimeout(150);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 2,
          ),
        ).toBe(true);
        if (width === 375) {
          await page.locator(".chapter-nav summary").click();
          await expect(page.locator(".chapter-nav nav")).toBeVisible();
        }
        await page.screenshot({
          path: `reports/screenshots/${info.project.name}-${entry.id}-${width}.png`,
        });
      }
    }
  });
test("搜索全文与结果深链接、直接刷新和失效定位", async ({ page }) => {
  // Each reload deliberately recreates the Worker and the complete search index.
  // Allow six cold starts, each with a 60s search budget, plus navigation.
  test.setTimeout(420000);
  for (const query of [
    "明河",
    "星移",
    "此身为剑",
    "若要动身",
    "物理伤害加成",
    "重蹈覆辙",
  ]) {
    await page.goto("#/search?q=" + encodeURIComponent(query));
    const searchPage = page.locator(".search-page");
    await expect(
      searchPage.getByRole("status"),
      `搜索「${query}」应结束加载`,
    ).toHaveText(/^(找到 \d+ 条结果|搜索失败)$/, { timeout: 60000 });
    await expect(searchPage.getByRole("alert")).toHaveCount(0);
    await expect(searchPage.locator(".search-result").first()).toBeVisible();
    // This phrase also occurs in other operators' voice lines in the full index.
    const result =
      query === "重蹈覆辙"
        ? page
            .locator(".search-result")
            .filter({ hasText: "档案资料·四" })
            .first()
        : page.locator(".search-result").first();
    const href = await result.getAttribute("href");
    await result.click();
    await expect(page.locator("[data-entry-id]")).toBeVisible();
    expect(page.url()).toContain(href!.slice(1));
    const url = new URL(page.url().split("#")[1], "https://mirror.test");
    const widget = url.searchParams.get("widget"),
      tab = url.searchParams.get("tab");
    if (query === "重蹈覆辙")
      await expect(
        page.getByRole("tab", { name: "档案资料·四", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
    if (widget && tab)
      await expect(
        page.locator(`[data-widget-id="${widget}"] [data-active-tab="${tab}"]`),
      ).toBeVisible();
    await page.reload();
    await expect(page.locator("[data-entry-id]")).toBeVisible();
  }
  await page.goto(
    "#/operators/2503?chapter=missing&widget=missing&tab=missing",
  );
  await expect(page.locator("h1")).toHaveText("明河");
});
test("搜索线程异常显示错误并结束加载", async ({ page }) => {
  await page.route("**/assets/search.worker-*.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'throw new Error("Search worker startup failed");',
    }),
  );
  await page.goto("#/search?q=" + encodeURIComponent("明河"));
  const searchPage = page.locator(".search-page");
  await expect(searchPage.getByRole("alert")).toContainText("搜索线程");
  await expect(searchPage.getByRole("status")).toHaveText("搜索失败");
  await expect(
    searchPage.getByRole("button", { name: "刷新", exact: true }),
  ).toBeVisible();
});
test("图片放大、键盘关闭、媒体失败与懒加载", async ({ page }) => {
  await page.goto("#/operators/2503");
  await expect(page.locator("[data-entry-id]")).toBeVisible();
  expect(await page.locator("audio[src]").count()).toBe(0);
  await page.locator(".image-button").first().click();
  await expect(page.locator("dialog[open]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  const button = page.locator(".audio-row>button").first();
  await button.click();
  await expect(page.locator(".audio-row .media-error").first()).toBeVisible();
  await expect(
    page.locator(".audio-row .media-error a").first(),
  ).toHaveAttribute("href", /wiki\.skland\.com/);
  await expect(page.locator(".video-card a").first()).toBeVisible();
});
test("全部本地静态图可解码且不依赖原图 CDN", async ({ page, browserName }) => {
  test.setTimeout(120000);
  await page.goto("#/");
  const data = JSON.parse(await readFile("dist/data/media.json", "utf8"));
  const paths = [
    ...new Set<string>(data.media.map((m: any) => m.localPath).filter(Boolean)),
  ];
  const failures = await page.evaluate(async (paths) => {
    const failures: string[] = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        while (next < paths.length) {
          const path = paths[next++];
          const image = new Image();
          image.referrerPolicy = "no-referrer";
          image.src = new URL(path, location.href.split("#")[0]).href;
          try {
            await image.decode();
            if (!image.naturalWidth) failures.push(path);
          } catch {
            failures.push(path);
          }
        }
      }),
    );
    return failures;
  }, paths);
  expect(failures).toEqual([]);
  await writeFile(
    `reports/images-${browserName}.json`,
    JSON.stringify(
      { snapshotId: catalog.snapshotId, decoded: paths.length, failures },
      null,
      2,
    ),
  );
});
test("后退恢复筛选及滚动位置", async ({ page }) => {
  await page.goto("#/equipment");
  await page.locator(".filter-group summary").nth(2).click();
  const boxes = page.locator(".filter-group").nth(2).locator("input");
  await boxes.first().check();
  await boxes.nth(1).check();
  const count = await page.locator(".entry-card").count();
  expect(count).toBeGreaterThan(0);
  await page.locator(".filter-group summary").nth(2).click();
  await page.locator(".entry-card").last().scrollIntoViewIfNeeded();
  await page
    .locator(".entry-card")
    .last()
    .evaluate((el) =>
      el.addEventListener(
        "click",
        () => sessionStorage.setItem("test-click-scroll", String(scrollY)),
        { once: true },
      ),
    );
  await page.locator(".entry-card").last().click();
  const y = await page.evaluate(() =>
    Number(sessionStorage.getItem("test-click-scroll")),
  );
  await expect(page.locator("[data-entry-id]")).toBeVisible();
  await page.goBack();
  await expect(page.locator(".entry-card")).toHaveCount(count);
  await expect
    .poll(() => page.evaluate(() => scrollY))
    .toBeGreaterThanOrEqual(Math.max(0, y - 10));
});
test("语音单段播放、切换标签与词条停止", async ({ page }) => {
  // Exercise lifecycle behavior without depending on the host's audio decoder.
  // Retain detached elements so unmount assertions also verify actual pause calls.
  await page.addInitScript(() => {
    const elements: HTMLMediaElement[] = [];
    const playing = new WeakSet<HTMLMediaElement>();
    const urls = new WeakMap<HTMLMediaElement, string>();
    const events: unknown[] = [];
    Reflect.set(window, "__mediaElements", elements);
    Reflect.set(window, "__mediaEvents", events);
    for (const type of ["pointerdown", "pointerup", "click", "focusin"])
      document.addEventListener(
        type,
        (event) => {
          const element = event.target as Element;
          events.push({
            type,
            target: element.outerHTML.slice(0, 300),
            scroll: scrollY,
            rect: element.getBoundingClientRect().toJSON(),
            y: (event as MouseEvent).clientY,
            behavior: getComputedStyle(document.documentElement).scrollBehavior,
          });
        },
        true,
      );
    Object.defineProperties(HTMLMediaElement.prototype, {
      src: {
        configurable: true,
        get() {
          return urls.get(this) || "";
        },
        set(value: string) {
          urls.set(this, value);
        },
      },
      paused: {
        configurable: true,
        get() {
          return !playing.has(this);
        },
      },
      play: {
        configurable: true,
        value: function (this: HTMLMediaElement) {
          if (!elements.includes(this)) elements.push(this);
          playing.add(this);
          events.push({ type: "play", src: this.src });
          this.dispatchEvent(new Event("playing"));
          return Promise.resolve();
        },
      },
      pause: {
        configurable: true,
        value: function (this: HTMLMediaElement) {
          if (playing.has(this))
            events.push({ type: "pause", stack: new Error().stack });
          if (playing.delete(this)) this.dispatchEvent(new Event("pause"));
        },
      },
    });
  });
  const playingCount = () =>
    page.evaluate(
      () =>
        (Reflect.get(window, "__mediaElements") as HTMLMediaElement[]).filter(
          (element) => !element.paused,
        ).length,
    );
  await page.goto("#/operators/2503");
  await expect(page.locator("[data-entry-id]")).toBeVisible();
  const widget = page.locator(".widget").filter({
    has: page.getByRole("heading", { name: "干员语音", exact: true }),
  });
  // Firefox may scroll on native focus; settle focus before the pointer gesture.
  await widget.locator(".audio-row>button").first().focus();
  await widget.locator(".audio-row>button").first().click();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluateAll(
          (es) => es.filter((e) => !(e as HTMLAudioElement).paused).length,
        ),
    )
    .toBe(1);
  await widget.locator(".audio-row>button").nth(1).click();
  expect(
    await widget
      .locator("audio")
      .first()
      .evaluate((e) => (e as HTMLAudioElement).paused),
  ).toBe(true);
  expect(
    await page
      .locator("audio")
      .evaluateAll(
        (es) => es.filter((e) => !(e as HTMLAudioElement).paused).length,
      ),
  ).toBe(1);
  await widget.getByRole("tab").nth(1).click();
  await expect.poll(playingCount).toBe(0);
  await widget.locator(".audio-row>button").first().click();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluateAll(
          (es) => es.filter((e) => !(e as HTMLAudioElement).paused).length,
        ),
    )
    .toBe(1);
  await page.locator(".sidebar").getByRole("link", { name: /武器/ }).click();
  await expect(page.locator(".entry-card").first()).toBeVisible();
  expect(await page.locator("audio").count()).toBe(0);
  await expect.poll(playingCount).toBe(0);
});
