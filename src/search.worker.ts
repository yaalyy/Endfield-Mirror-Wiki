/// <reference lib="webworker" />
import MiniSearch from "minisearch";
import { indexOptions, queryOptions } from "../shared/search.ts";
import type { SearchRecord } from "../shared/types.ts";
let index: Promise<MiniSearch<SearchRecord>> | undefined;
self.onmessage = async (
  event: MessageEvent<{
    id: number;
    url: string;
    snapshotId: string;
    query: string;
    limit: number;
  }>,
) => {
  const { id, url, snapshotId, query, limit } = event.data;
  try {
    index ??= (async () => {
      const r = await fetch(url, { referrerPolicy: "no-referrer" });
      if (!r.ok) throw Error("搜索数据读取失败，请刷新页面。");
      const data = await r.json();
      if (data.snapshotId !== snapshotId)
        throw Error("搜索数据已更新，请刷新页面。");
      return MiniSearch.loadJS<SearchRecord>(data.index, indexOptions);
    })();
    const engine = await index;
    const all = query.trim() ? engine.search(query, queryOptions) : [];
    self.postMessage({
      id,
      total: all.length,
      results: all
        .slice(0, limit)
        .map((r) => ({ ...r, body: String(r.body).slice(0, 30000) })),
    });
  } catch (e) {
    index = undefined;
    self.postMessage({ id, error: String(e) });
  }
};
