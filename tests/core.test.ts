import { describe, it, expect, vi } from "vitest";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import MiniSearch from "minisearch";
import { Api, request, signedHeaders, BusinessError } from "../scripts/api.ts";
import {
  parseCatalog,
  compareCatalog,
  convert,
  collectUrls,
  idSet,
  textNodes,
  rewrite,
} from "../scripts/content.ts";
import { sniff, validCache, fetchMedia } from "../scripts/media.ts";
import {
  capacity,
  validateSnapshot,
  validateDist,
} from "../scripts/validate.ts";
import { activateSnapshot, recoverSnapshot } from "../scripts/sync.ts";
import { makeFixtures, fixturePng } from "../scripts/fixtures.ts";
import { readJson, sha, exists } from "../scripts/io.ts";
import { tokenize } from "../shared/tokenize.ts";
import { indexOptions, queryOptions } from "../shared/search.ts";
import { localPath, sourceLink } from "../shared/paths.ts";
import type { Source } from "../shared/types.ts";
const catalog = await readJson("tests/fixtures/catalog.json");
const categories = parseCatalog(catalog);
const entry = categories[0].items[0];
const sample = (await readJson("tests/fixtures/2503.json")).item;
const doc = (blockMap: Source, blockIds = Object.keys(blockMap)) => ({
  id: "document-id",
  blockMap,
  blockIds,
});
function minimal(description: Source) {
  return {
    ...sample,
    brief: { description },
    document: {
      chapterGroup: [],
      widgetCommonMap: {},
      documentMap: {},
      extraInfo: {},
    },
  };
}
describe("签名及 API 传输", () => {
  it("固定签名向量与字段顺序", () => {
    expect(
      signedHeaders(
        "/web/v1/wiki/item/catalog",
        "typeMainId=1",
        "test-token",
        "1700000000",
      ).sign,
    ).toBe("96c11a270a6b6ee78c721cf03ed2f52e");
    expect(Object.keys(signedHeaders("/", "", "", "1")).slice(0, 4)).toEqual([
      "platform",
      "timestamp",
      "dId",
      "vName",
    ]);
  });
  it("查询实际顺序参与签名", () => {
    expect(signedHeaders("/x", "a=1&b=2").sign).not.toBe(
      signedHeaders("/x", "b=2&a=1").sign,
    );
  });
  it("POST 使用发送的同一个 JSON 字符串", async () => {
    const calls: any[] = [];
    const fetcher = vi.fn(async (url: any, init: any) => {
      calls.push({ url, init });
      return Response.json({
        code: 0,
        data: String(url).endsWith("/refresh")
          ? { token: "memory-only" }
          : { ok: true },
      });
    });
    await new Api({ fetcher: fetcher as typeof fetch }).post(
      "/web/v1/wiki/video-post/batch",
      { itemIds: ["123"] },
    );
    const { init } = calls[1];
    expect(init.body).toBe('{"itemIds":["123"]}');
    expect(init.headers.sign).toBe(
      signedHeaders(
        "/web/v1/wiki/video-post/batch",
        init.body,
        "memory-only",
        init.headers.timestamp,
      ).sign,
    );
  });
  it("业务失败不会作为成功内容返回", async () => {
    const api = new Api({
      fetcher: vi
        .fn()
        .mockResolvedValueOnce(Response.json({ code: 0, data: { token: "t" } }))
        .mockResolvedValueOnce(Response.json({ code: 9, message: "no" })),
    });
    await expect(api.get("/x")).rejects.toBeInstanceOf(BusinessError);
  });
  it("明确失效刷新一次，第二次失败终止", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ code: 0, data: { token: "t" } }))
      .mockResolvedValueOnce(Response.json({ code: 10000 }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ code: 0, data: { token: "u" } }))
      .mockResolvedValueOnce(Response.json({ code: 10000 }, { status: 401 }));
    await expect(new Api({ fetcher }).get("/x")).rejects.toThrow("10000");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("其他鉴权错误和普通业务失败不会刷新匿名签名", async () => {
    for (const [code, status] of [
      [10001, 403],
      [10002, 401],
      [10000, 200],
    ]) {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ code: 0, data: { token: "t" } }))
        .mockResolvedValueOnce(
          Response.json({ code, message: "请求异常" }, { status }),
        );
      await expect(new Api({ fetcher }).get("/x")).rejects.toThrow(
        status === 403 ? "HTTP 403" : String(code),
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });
  it("429 遵守 Retry-After，5xx 重试", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", { status: 429, headers: { "Retry-After": "2" } }),
      )
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok"));
    const sleep = vi.fn(async () => {});
    expect(
      await (
        await request("https://example.test", {}, { fetcher, sleep })
      ).text(),
    ).toBe("ok");
    expect(sleep.mock.calls).toEqual([[2000], [1000]]);
  });
  it("超时最多重试三次且保留信号", async () => {
    const fetcher = vi.fn(async (_u: any, init: any) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      throw new DOMException("timeout", "TimeoutError");
    });
    await expect(
      request(
        "https://example.test",
        {},
        { fetcher: fetcher as typeof fetch, sleep: async () => {} },
      ),
    ).rejects.toThrow("网络请求失败");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("HTTP 404 不重试", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 404 }));
    await expect(
      request("https://example.test", {}, { fetcher }),
    ).rejects.toThrow("HTTP 404");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
describe("目录与快照", () => {
  it("解析三个栏目及来源标签名称", () => {
    expect(categories.map((c) => c.key)).toEqual([
      "operators",
      "weapons",
      "equipment",
    ]);
    expect(entry.tags).toContain("近卫");
    expect(entry.source).toContain("subTypeId=1&gameEntryId=2503");
  });
  it("首次同步、增加、改名和删除基于 ID 而非固定配额", () => {
    expect(compareCatalog(undefined, categories).operators.added.length).toBe(
      2,
    );
    const next = structuredClone(categories);
    next[0].items[0].name = "changed";
    expect(compareCatalog(categories, next).operators.added).toEqual([]);
    next[0].items.pop();
    expect(() => compareCatalog(categories, next)).toThrow("超过 10%");
    expect(compareCatalog(categories, next, true).operators.removed).toEqual([
      "2338",
    ]);
    expect(idSet(next)).not.toBe(idSet(categories));
  });
  it("空栏目和无名称标签立即失败", () => {
    const c = structuredClone(catalog);
    c.data.catalog[0].typeSub[0].items = [];
    expect(() => parseCatalog(c)).toThrow("为空");
    const d = structuredClone(catalog);
    d.data.catalog[0].typeSub[0].filterTagTree[0].name = "";
    expect(() => parseCatalog(d)).toThrow("缺少名称");
  });
  it("同步未激活时旧数据保留，激活后留上一份，恢复中断切换", async () => {
    const base = await mkdtemp(join(tmpdir(), "mirror-atomic-"));
    try {
      await mkdir(join(base, "current"));
      await writeFile(join(base, "current/value"), "old");
      await mkdir(join(base, "staging"));
      await writeFile(join(base, "staging/value"), "new");
      expect(await readFile(join(base, "current/value"), "utf8")).toBe("old");
      await activateSnapshot(base, join(base, "staging"));
      expect(await readFile(join(base, "current/value"), "utf8")).toBe("new");
      expect(await readFile(join(base, "previous/value"), "utf8")).toBe("old");
      await rm(join(base, "current"), { recursive: true });
      await recoverSnapshot(base);
      expect(await readFile(join(base, "current/value"), "utf8")).toBe("old");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
  it("路径在子目录下生成", () => {
    expect(localPath("/data/catalog.json")).toBe(
      "/Endfield-Mirror-Wiki/data/catalog.json",
    );
    expect(sourceLink("4", "2764")).toContain("gameEntryId=2764");
  });
});
describe("内容完整性与搜索", () => {
  it("全部固定真实样本转换成功，非默认标签与语音台词进入索引", async () => {
    for (const c of categories)
      for (const e of c.items) {
        const d = (await readJson("tests/fixtures/" + e.id + ".json")).item;
        const result = convert(d, e, "test");
        expect(result.records.length).toBeGreaterThan(1);
        if (e.id === "2503") {
          expect(result.records.some((r) => r.tab === "档案资料·四")).toBe(
            true,
          );
          expect(
            result.records.some((r) => r.body.includes("若要动身，发令便是")),
          ).toBe(true);
          expect(result.records.some((r) => r.body.includes("此身为剑"))).toBe(
            true,
          );
        }
      }
  });
  it("简介和非当前 tab 资源提取、完整查询参数保留", () => {
    const urls = collectUrls({
      brief: {
        description: doc({
          i: { kind: "image", image: { url: "https://x/a.png?v=1" } },
        }),
      },
      tabs: { hidden: { icon: "https://x/noextension" } },
    });
    expect([...urls.keys()]).toEqual([
      "https://x/a.png?v=1",
      "https://x/noextension",
    ]);
    expect(
      rewrite(
        { url: "https://x/a.png?v=1" },
        new Map([["https://x/a.png?v=1", "media/a.png"]]),
      ),
    ).toEqual({ url: "media/a.png" });
  });
  it("缺少文档与组件阻止转换", () => {
    const i = structuredClone(sample);
    delete i.document.documentMap[
      Object.values<any>(i.document.widgetCommonMap).find(
        (w) => w.tabDataMap.default?.content,
      )?.tabDataMap.default.content
    ];
    expect(() => convert(i, entry, "test")).toThrow("文档缺失");
    const j = structuredClone(sample);
    delete j.document.widgetCommonMap[j.document.chapterGroup[0].widgets[0].id];
    expect(() => convert(j, entry, "test")).toThrow("组件缺失");
  });
  it("循环块、未知块与未知行内拒绝通过", () => {
    expect(() =>
      convert(
        minimal(doc({ a: { kind: "quote", quote: { childIds: ["a"] } } })),
        entry,
        "x",
      ),
    ).toThrow("循环");
    expect(() =>
      convert(
        minimal(doc({ a: { kind: "future", future: { text: "不能忽略" } } })),
        entry,
        "x",
      ),
    ).toThrow("未知块");
    expect(() =>
      convert(
        minimal(
          doc({
            a: {
              kind: "text",
              text: { kind: "body", inlineElements: [{ kind: "future" }] },
            },
          }),
        ),
        entry,
        "x",
      ),
    ).toThrow("未知行内");
  });
  it("未知组件和非空扩展生成带位置诊断", () => {
    const i = structuredClone(sample);
    i.document.widgetCommonMap[i.document.chapterGroup[0].widgets[0].id].type =
      "future";
    expect(() => convert(i, entry, "x")).toThrow("未知组件");
    const j = structuredClone(sample);
    j.document.widgetCommonMap[
      j.document.chapterGroup[0].widgets[0].id
    ].dialogList = [{ content: "future branch" }];
    expect(() => convert(j, entry, "x")).toThrow("dialogList");
  });
  it("顺序由 blockIds 控制，引用与列表递归提取", () => {
    const d = doc(
      {
        a: {
          kind: "text",
          text: {
            kind: "body",
            inlineElements: [{ kind: "text", text: { text: "first" } }],
          },
        },
        b: {
          kind: "text",
          text: {
            kind: "body",
            inlineElements: [{ kind: "text", text: { text: "second" } }],
          },
        },
      },
      ["b", "a"],
    );
    expect(
      textNodes(convert(minimal(d), entry, "x").detail.description, {}),
    ).toBe("second\nfirst");
  });
  it("合并表格与嵌套列表最小覆盖", () => {
    const blocks: Source = {
      table: {
        kind: "table",
        table: {
          rowIds: ["r1", "r2"],
          columnIds: ["c1", "c2"],
          columnMap: { c1: { width: 80 }, c2: { width: 120 } },
          rowMap: {},
          cellMap: {
            r1_c1: { childIds: ["list"], rowSpan: "2", colSpan: "1" },
            r1_c2: { childIds: ["text"], rowSpan: "1", colSpan: "1" },
            r2_c2: { childIds: [], rowSpan: "1", colSpan: "1" },
          },
        },
      },
      list: {
        kind: "list",
        list: {
          kind: "unordered",
          itemIds: ["li"],
          itemMap: { li: { childIds: ["nested"] } },
        },
      },
      nested: {
        kind: "list",
        list: {
          kind: "ordered",
          itemIds: ["li2"],
          itemMap: { li2: { childIds: ["quote"] } },
        },
      },
      quote: { kind: "quote", quote: { childIds: ["text"] } },
      text: {
        kind: "text",
        text: {
          kind: "body",
          inlineElements: [{ kind: "text", text: { text: "嵌套内容" } }],
        },
      },
    };
    const result = convert(minimal(doc(blocks, ["table"])), entry, "x");
    expect(result.detail.description[0].cells![0].rowSpan).toBe(2);
    expect(textNodes(result.detail.description, {})).toContain("嵌套内容");
  });
  it("中文片段、英文数字共用分词，名称权重与正文检索", () => {
    expect(tokenize("终末地 Skill 123")).toEqual(
      expect.arrayContaining(["终末地", "终末", "末地", "skill", "123"]),
    );
    const search = new MiniSearch<any>(indexOptions);
    search.addAll([
      { id: "a", name: "明河", tags: "", body: "" },
      { id: "b", name: "其他", tags: "", body: "明河的档案台词" },
    ]);
    expect(search.search("明河", queryOptions)[0].id).toBe("a");
    expect(
      search.search("档案台词", queryOptions).some((r) => r.id === "b"),
    ).toBe(true);
    // Round-trip through JSON as the site does: sync writes, worker loads.
    const loaded = MiniSearch.loadJS<any>(
      JSON.parse(JSON.stringify(search)),
      indexOptions,
    );
    expect(loaded.search("明河", queryOptions)[0].id).toBe("a");
  });
});
describe("资源与构建门禁", () => {
  it("文件头识别无后缀 PNG，GIF 不会被 PNG 扩展名欺骗", () => {
    expect(sniff(fixturePng).extension).toBe("png");
    expect(sniff(Buffer.from("GIF89a"), "image/png").kind).toBe("gif");
    expect(() => sniff(Buffer.from("<!DOCTYPE html><html>error"))).toThrow(
      "HTML",
    );
    expect(() => sniff(Buffer.from("nonsense"), "image/png")).toThrow(
      "无法识别",
    );
  });
  it("缓存损坏重取，URL 不去除查询参数，同内容哈希去重", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirror-media-"));
    const original = globalThis.fetch;
    try {
      const fetcher = vi.fn(
        async (_url: string | URL | Request) =>
          new Response(fixturePng, {
            headers: { "Content-Type": "image/png", ETag: "v1" },
          }),
      );
      globalThis.fetch = fetcher;
      const a = await fetchMedia(
        "https://x/a?full=1",
        "image",
        root,
        root,
        undefined,
      );
      const b = await fetchMedia(
        "https://x/b?full=2",
        "image",
        root,
        root,
        undefined,
      );
      expect(a.localPath).toBe(b.localPath);
      expect(fetcher.mock.calls[0][0]).toBe("https://x/a?full=1");
      expect(await validCache(a, root)).toBe(true);
      await writeFile(join(root, a.localPath!), "broken");
      expect(await validCache(a, root)).toBe(false);
      await fetchMedia(a.url, "image", root, root, a);
      expect(await validCache(a, root)).toBe(true);
    } finally {
      globalThis.fetch = original;
      await rm(root, { recursive: true, force: true });
    }
  });
  it("合格缓存使用条件请求和 304；无校验信息仍下载", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirror-304-"));
    const original = globalThis.fetch;
    try {
      globalThis.fetch = vi.fn(
        async () => new Response(fixturePng, { headers: { ETag: "tag" } }),
      );
      const a = await fetchMedia("https://x/a", "image", root, root, undefined);
      const conditional = vi.fn(async (_url: any, init: any) => {
        expect(init.headers["If-None-Match"]).toBe("tag");
        return new Response(null, { status: 304 });
      });
      globalThis.fetch = conditional as typeof fetch;
      expect((await fetchMedia(a.url, "image", root, root, a)).sha256).toBe(
        a.sha256,
      );
      globalThis.fetch = vi.fn(async () => new Response(fixturePng));
      await fetchMedia(a.url, "image", root, root, {
        ...a,
        etag: undefined,
        lastModified: undefined,
      });
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = original;
      await rm(root, { recursive: true, force: true });
    }
  });
  it("媒体失败阻止成功数据，外链 GIF 不写本地", async () => {
    const original = globalThis.fetch;
    try {
      globalThis.fetch = vi.fn(
        async () =>
          new Response("<html>no", {
            headers: { "Content-Type": "image/png" },
          }),
      );
      await expect(
        fetchMedia(
          "https://x/a",
          "image",
          ".mirror/test",
          ".mirror/test",
          undefined,
        ),
      ).rejects.toThrow("HTML");
      expect(
        await fetchMedia(
          "https://x/a.gif",
          "gif",
          ".mirror/test",
          ".mirror/test",
          undefined,
        ),
      ).toEqual({ url: "https://x/a.gif", kind: "gif", bytes: 0 });
    } finally {
      globalThis.fetch = original;
    }
  });
  it("容量阈值精确", () => {
    expect(capacity(749999999)).toBe("ok");
    expect(capacity(750000000)).toBe("warning");
    expect(capacity(900000000)).toBe("warning");
    expect(() => capacity(900000001)).toThrow("容量");
  });
  it("完全无缓存可离线重建完整固定快照，缺资源则失败", async () => {
    const base = await mkdtemp(join(tmpdir(), "mirror-fixtures-"));
    const root = join(base, "snapshot");
    try {
      await makeFixtures(root);
      expect((await validateSnapshot(root)).detailCount).toBe(6);
      const manifest = await readJson(join(root, "manifest.json"));
      const path = manifest.media.find((m: any) => m.localPath).localPath;
      await rm(join(root, path));
      await expect(validateSnapshot(root)).rejects.toThrow();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
