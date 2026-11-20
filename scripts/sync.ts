import { mkdir, rename, rm, readFile, appendFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import MiniSearch from "minisearch";
import type {
  Catalog,
  Detail,
  Manifest,
  Source,
  SearchRecord,
} from "../shared/types.ts";
import { tokenize } from "../shared/tokenize.ts";
import { Api } from "./api.ts";
import { json, readJson, exists, pool, sha } from "./io.ts";
import {
  parseCatalog,
  references,
  compareCatalog,
  idSet,
  convert,
  collectUrls,
  rewrite,
  videoIds,
} from "./content.ts";
import { fetchMedia } from "./media.ts";
import { validateSnapshot } from "./validate.ts";
export async function activateSnapshot(base: string, staging: string) {
  const current = join(base, "current"),
    previous = join(base, "previous");
  await rm(previous, { recursive: true, force: true });
  const had = await exists(current);
  if (had) await rename(current, previous);
  try {
    await rename(staging, current);
  } catch (e) {
    if (had) await rename(previous, current);
    throw e;
  }
}
export async function recoverSnapshot(base: string) {
  if (
    !(await exists(join(base, "current"))) &&
    (await exists(join(base, "previous")))
  )
    await rename(join(base, "previous"), join(base, "current"));
}
export async function processSnapshot(
  root: string,
  raw: Source,
  items: Map<string, Source>,
  options: {
    fixture?: boolean;
    force?: boolean;
    api?: Api;
    oldRoot?: string;
    allowRemovals?: boolean;
    mediaLoader?: typeof fetchMedia;
  } = {},
) {
  const oldRoot = options.oldRoot || join(".mirror", "current");
  const old = (await exists(join(oldRoot, "manifest.json")))
    ? await readJson<Manifest>(join(oldRoot, "manifest.json"))
    : undefined;
  const cats = parseCatalog(raw);
  const previous = (await exists(join(oldRoot, "processed/data/catalog.json")))
    ? await readJson<Catalog>(join(oldRoot, "processed/data/catalog.json"))
    : undefined;
  const changes = compareCatalog(
    previous?.fixture === !!options.fixture ? previous?.categories : undefined,
    cats,
    options.allowRemovals,
  );
  let codeVersion = "uncommitted";
  try {
    codeVersion = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {}
  const snapshotId = sha(
    JSON.stringify(raw) + JSON.stringify([...items.values()]),
  );
  const info = {
    schemaVersion: 1 as const,
    snapshotId,
    syncedAt: new Date().toISOString(),
    counts: Object.fromEntries(cats.map((c) => [c.key, c.items.length])),
    codeVersion,
    fixture: !!options.fixture,
  };
  const videos: Record<string, { cover: string }> = {};
  const ids = [...new Set([...items.values()].flatMap(videoIds))];
  if (options.api)
    for (let i = 0; i < ids.length; i += 20) {
      const result = await options.api.post("/web/v1/wiki/video-post/batch", {
        itemIds: ids.slice(i, i + 20),
      });
      for (const id of ids.slice(i, i + 20)) {
        const list = result.data?.items?.[id]?.videoList;
        if (!list?.[0]?.cover?.url) throw Error("视频封面元数据缺失 " + id);
        videos[id] = { cover: list[0].cover.url };
      }
    }
  else if (options.fixture) {
    for (const id of ids)
      videos[id] = { cover: "https://fixture.invalid/poster.png" };
  }
  await json(join(root, "raw/videos.json"), videos);
  const details: Detail[] = [];
  const records: SearchRecord[] = [];
  const structure: Record<string, number> = {};
  for (const c of cats)
    for (const entry of c.items) {
      const item = items.get(entry.id);
      if (!item) throw Error("详情缺失 " + entry.id);
      const result = convert(item, entry, snapshotId, videos, references(raw));
      details.push(result.detail);
      records.push(...result.records);
      for (const [k, v] of Object.entries(result.structure))
        structure[k] = (structure[k] || 0) + v;
    }
  const catalog: Catalog = {
    ...info,
    categories: cats,
    references: references(raw),
  };
  // Only in-scope covers are needed for associated cards. Other categories remain lightweight links.
  const urls = collectUrls({ catalog, details, videos });
  const oldMap = new Map(old?.media.map((m) => [m.url, m]) || []);
  let done = 0;
  const media = await pool([...urls], async ([url, hint]) => {
    const result = await (options.mediaLoader || fetchMedia)(
      url,
      hint,
      root,
      oldRoot,
      oldMap.get(url),
      options.force,
    );
    done++;
    if (done % 1000 === 0 || done === urls.size)
      console.log(`静态资源/外链记录 ${done}/${urls.size}`);
    return result;
  });
  const paths = new Map(
    media.filter((m) => m.localPath).map((m) => [m.url, m.localPath!]),
  );
  const rewritten = rewrite(catalog, paths);
  await json(join(root, "processed/data/catalog.json"), rewritten);
  for (const detail of details)
    await json(
      join(root, `processed/data/details/${detail.id}.json`),
      rewrite(detail, paths),
    );
  const index = new MiniSearch<SearchRecord>({
    fields: ["name", "tags", "body"],
    storeFields: [
      "itemId",
      "category",
      "name",
      "chapterId",
      "chapter",
      "widgetId",
      "widget",
      "tabId",
      "tab",
      "body",
    ],
    tokenize,
    processTerm: (t) => t,
  });
  index.addAll(records);
  await json(join(root, "processed/data/search.json"), {
    schemaVersion: 1,
    snapshotId,
    index: index.toJSON(),
  });
  await json(join(root, "processed/data/build-info.json"), info);
  await json(join(root, "processed/data/media.json"), {
    schemaVersion: 1,
    snapshotId,
    media,
  });
  const manifest: Manifest = {
    ...info,
    media,
    changes,
    structure,
    stats: {
      downloaded: media.filter((m) => m.cacheStatus === "downloaded").length,
      notModified: media.filter((m) => m.cacheStatus === "not-modified").length,
    },
  };
  await json(join(root, "manifest.json"), manifest);
  await validateSnapshot(root);
  return manifest;
}
export async function sync() {
  const base = resolve(".mirror");
  await mkdir(base, { recursive: true });
  await recoverSnapshot(base);
  const lock = join(base, "sync.lock");
  let handle;
  try {
    const { open } = await import("node:fs/promises");
    handle = await open(lock, "wx");
  } catch {
    throw Error("存在同步锁；确认无其他同步进程后删除 .mirror/sync.lock");
  }
  try {
    const api = new Api();
    for (let pass = 0; pass < 2; pass++) {
      const root = join(base, "staging", `${Date.now()}-${process.pid}`);
      await mkdir(join(root, "raw/details"), { recursive: true });
      try {
        const raw = await api.get("/web/v1/wiki/item/catalog", "typeMainId=1");
        const cat = parseCatalog(raw);
        await json(join(root, "raw/catalog.json"), raw);
        const entries = cat.flatMap((c) => c.items);
        const map = new Map<string, Source>();
        let n = 0;
        await pool(entries, async (entry) => {
          const result = await api.get(
            "/web/v1/wiki/item/info",
            "id=" + encodeURIComponent(entry.id),
          );
          if (String(result.data?.item?.itemId) !== entry.id)
            throw Error("详情 ID 不匹配 " + entry.id);
          map.set(entry.id, result.data.item);
          await json(join(root, "raw/details", entry.id + ".json"), result);
          if (++n % 50 === 0 || n === entries.length)
            console.log(`详情 ${n}/${entries.length}`);
        });
        // Stable ordering makes snapshot fingerprints independent of response completion order.
        const sorted = new Map(entries.map((e) => [e.id, map.get(e.id)!]));
        const manifest = await processSnapshot(root, raw, sorted, {
          api,
          force: process.argv.includes("--force"),
          allowRemovals: process.argv.includes("--allow-removals"),
          oldRoot: join(base, "current"),
        });
        const check = await api.get(
          "/web/v1/wiki/item/catalog",
          "typeMainId=1",
        );
        await json(join(root, "raw/catalog-final.json"), check);
        if (idSet(cat) !== idSet(parseCatalog(check))) {
          await rm(root, { recursive: true, force: true });
          if (pass === 0) {
            console.log("目录变化，重新同步一次");
            continue;
          }
          throw Error("目录连续变化，保留原成功快照");
        }
        await activateSnapshot(base, root);
        await rm(join(base, "staging"), { recursive: true, force: true });
        await mkdir("reports", { recursive: true });
        await json("reports/sync.json", manifest);
        const summary = `同步成功 ${manifest.syncedAt}\n\n数量 ${JSON.stringify(manifest.counts)}\n\n变化 ${JSON.stringify(manifest.changes)}\n\n静态图片 ${manifest.media.filter((m) => m.kind === "image").length} URL，${new Set(manifest.media.map((m) => m.sha256).filter(Boolean)).size} 个内容哈希\n\n缓存 ${JSON.stringify(manifest.stats)}\n`;
        if (process.env.GITHUB_STEP_SUMMARY)
          await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
        console.log(summary);
        return;
      } catch (error) {
        await mkdir("reports", { recursive: true });
        await json("reports/sync-error.json", {
          time: new Date().toISOString(),
          error: String(error),
          cause: error instanceof Error ? String(error.cause || "") : "",
        });
        throw error;
      }
    }
  } finally {
    await handle.close();
    await rm(lock, { force: true });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
)
  sync().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
