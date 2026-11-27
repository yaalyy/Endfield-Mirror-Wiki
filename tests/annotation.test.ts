import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import MiniSearch from "minisearch";
import { Nodes } from "../src/renderer.tsx";
import {
  convert,
  gameIconIds,
  parseCatalog,
  collectUrls,
  textNodes,
} from "../scripts/content.ts";
import { processSnapshot } from "../scripts/sync.ts";
import { fixturePng } from "../scripts/fixtures.ts";
import { readJson, sha } from "../scripts/io.ts";
import { indexOptions, queryOptions } from "../shared/search.ts";
import type { Api } from "../scripts/api.ts";
import type { Catalog, GameIcons, Source } from "../shared/types.ts";

const fixture = await readJson("tests/fixtures/2925-annotation.json");
const raw = await readJson("tests/fixtures/catalog.json");
const entries = parseCatalog(raw).flatMap((c) => c.items);
const entry = { ...entries[0], id: "2925", name: "突击流星" };
const icons: GameIcons = Object.fromEntries(
  fixture.icons.map((i: Source) => [i.id, { url: i.url, title: i.title }]),
);
function item(document = structuredClone(fixture.document)): Source {
  return {
    brief: {},
    document: {
      chapterGroup: [
        {
          id: "chapter",
          title: "效果",
          widgets: [{ id: fixture.widgetId, title: "装备效果" }],
        },
      ],
      widgetCommonMap: {
        [fixture.widgetId]: {
          type: "common",
          tabDataMap: { default: { content: document.id } },
        },
      },
      documentMap: { [document.id]: document },
    },
  };
}
function convertItem(value = item(), gameIcons = icons) {
  return convert(value, entry, "test", {}, {}, gameIcons);
}
function annotation(value: Source) {
  return value.document.documentMap.D2jcMM36.blockMap.UBM34Vp8jfht.text
    .inlineElements[1].annotation;
}

describe("真实词条 2925 的注释与游戏图标", () => {
  it("递归保留术语样式、释义与图标，并将释义写入搜索", () => {
    const result = convertItem();
    const nodes = result.detail.chapters[0].widgets[0].tabs[0].nodes;
    const a = nodes[0].inline![1];
    expect(a.kind).toBe("annotation");
    expect(a.inline![0]).toMatchObject({
      text: "自然爆发",
      underline: true,
      color: "light_function_green",
    });
    expect(a.nodes![0].id).toBe("k2rweCtpqbZ3");
    expect(a.nodes![0].inline![0]).toMatchObject({
      kind: "gameIcon",
      iconId: fixture.icons[0].id,
      url: fixture.icons[0].url,
      text: "自然附着",
    });
    expect(textNodes(nodes, {})).toContain("对敌人造成一定");
    expect(result.records.some((r) => r.body.includes("对敌人造成一定"))).toBe(
      true,
    );
    const search = new MiniSearch(indexOptions);
    search.addAll(result.records);
    expect(search.search("自然附着", queryOptions)).toHaveLength(1);
    expect(gameIconIds(item())).toEqual([fixture.icons[0].id]);
    expect(collectUrls(result.detail).get(fixture.icons[0].url)).toBe("image");
  });

  it("术语和释义渲染为可折叠内容，图标具有文本替代", () => {
    const result = convertItem();
    const html = renderToStaticMarkup(
      createElement(Nodes, {
        nodes: result.detail.chapters[0].widgets[0].tabs[0].nodes,
        catalog: { references: {} } as Catalog,
        source: entry.source,
      }),
    );
    expect(html).toContain('class="annotation-label"');
    expect(html).toContain('class="annotation-note" open=""');
    expect(html).toContain("注释：");
    expect(html).toContain("对敌人造成一定");
    expect(html).toContain('alt="自然附着"');
    expect(html).toContain('</p><details class="annotation-note"');
  });

  it("注释内缺失与循环块引用仍然拒绝，并报告原位置", () => {
    const missing = item();
    annotation(missing).childIds = ["missing"];
    expect(() => convertItem(missing)).toThrow("块引用缺失");
    const cyclic = item();
    annotation(cyclic).childIds = ["UBM34Vp8jfht"];
    expect(() => convertItem(cyclic)).toThrow("循环块引用");
    const unknown = item();
    annotation(unknown).future = "不能丢失";
    expect(() => convertItem(unknown)).toThrow("inline/1/annotation/future");
    const malformed = item();
    annotation(malformed).childIds = "bad";
    expect(() => convertItem(malformed)).toThrow("无效注释");
    expect(() => convertItem(item(), {})).toThrow("游戏图标缺失");
  });

  it("注释中的嵌套行内内容和未知图标字段仍检查完整性", () => {
    const nested = item();
    annotation(nested).inlineElements = [
      { kind: "future", text: { text: "不能丢失" } },
    ];
    expect(() => convertItem(nested)).toThrow("annotation/inline/0");
    const unknown = item();
    unknown.document.documentMap.D2jcMM36.blockMap.k2rweCtpqbZ3.text.inlineElements[0].gameIcon.future =
      "不能丢失";
    expect(() => convertItem(unknown)).toThrow("gameIcon/future");
  });

  it("同步按需获取图标目录，静态图标本地化且释义进入最终搜索索引", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirror-annotation-"));
    try {
      const localPath = `media/${sha(fixturePng)}.png`;
      await mkdir(join(root, "media"));
      await writeFile(join(root, localPath), fixturePng);
      const values = new Map(
        entries.map((e) => [
          e.id,
          {
            brief: {},
            document: {
              chapterGroup: [],
              widgetCommonMap: {},
              documentMap: {},
            },
          } as Source,
        ]),
      );
      values.set(entries[0].id, item());
      const get = vi.fn(async () => ({
        data: { iconCategories: [{ icons: fixture.icons }] },
      }));
      const options = {
        fixture: true,
        oldRoot: root,
        api: { get } as unknown as Api,
        mediaLoader: vi.fn(async (url: string) => ({
          url,
          kind: "image" as const,
          localPath,
          sha256: sha(fixturePng),
          bytes: fixturePng.length,
        })),
      };
      const manifest = await processSnapshot(root, raw, values, options);
      expect(get).toHaveBeenCalledExactlyOnceWith(
        "/web/v1/wiki/icon-category/list",
      );
      expect(await readJson(join(root, "raw/game-icons.json"))).toEqual(icons);
      const detail = await readJson(
        join(root, `processed/data/details/${entries[0].id}.json`),
      );
      const a = detail.chapters[0].widgets[0].tabs[0].nodes[0].inline[1];
      expect(a.nodes[0].inline[0].url).toBe(localPath);
      expect(
        manifest.media.some(
          (m) => m.url === fixture.icons[0].url && m.localPath === localPath,
        ),
      ).toBe(true);
      const index = await readJson(join(root, "processed/data/search.json"));
      const search = MiniSearch.loadJS(index.index, indexOptions);
      expect(search.search("自然附着", queryOptions)).toHaveLength(1);
      get.mockClear();
      values.set(entries[0].id, { brief: {}, document: {} });
      await processSnapshot(root, raw, values, options);
      expect(get).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
