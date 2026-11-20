import { readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Catalog, Detail, Manifest } from "../shared/types.ts";
import { exists, files, readJson, sha } from "./io.ts";
import { sniff } from "./media.ts";
import { collectUrls } from "./content.ts";
export function capacity(bytes: number) {
  if (bytes > 900_000_000)
    throw Error(`构建超过容量门禁: ${bytes} > 900000000`);
  return bytes >= 750_000_000 ? "warning" : "ok";
}
export async function validateSnapshot(root: string) {
  const manifest = await readJson<Manifest>(join(root, "manifest.json"));
  const publicRoot = join(root, "processed");
  const catalog = await readJson<Catalog>(
    join(publicRoot, "data/catalog.json"),
  );
  if (catalog.snapshotId !== manifest.snapshotId) throw Error("目录快照不一致");
  const expected = new Set<string>();
  for (const m of manifest.media) {
    if (m.kind === "image") {
      if (!m.localPath || !m.sha256) throw Error("静态图片没有本地路径");
      const b = await readFile(join(root, m.localPath));
      if (
        b.length !== m.bytes ||
        sha(b) !== m.sha256 ||
        sniff(b).kind !== "image"
      )
        throw Error("媒体校验失败 " + m.localPath);
      expected.add(m.localPath);
    } else if (m.localPath) throw Error("外链媒体被本地保存");
  }
  let detailCount = 0;
  for (const c of catalog.categories) {
    if (!c.items.length) throw Error("空栏目");
    for (const entry of c.items) {
      const detail = await readJson<Detail>(join(publicRoot, entry.detailPath));
      if (detail.snapshotId !== manifest.snapshotId || detail.id !== entry.id)
        throw Error("详情快照不一致 " + entry.id);
      detailCount++;
    }
  }
  for (const file of await files(publicRoot)) {
    if (!file.endsWith(".json")) continue;
    const data = await readJson(file);
    if (data.snapshotId !== manifest.snapshotId)
      throw Error("数据混合快照 " + file);
    const serialized = JSON.stringify(data);
    if (
      /auth_key=|"(?:token|sign|createdUser|lastUpdatedUser)"\s*:/.test(
        serialized,
      )
    )
      throw Error("公开数据含临时鉴权或用户字段 " + file);
    if (!file.endsWith("media.json"))
      for (const [url, kind] of collectUrls(data))
        if (
          kind === "image" &&
          !manifest.media.some((m) => m.url === url && m.kind !== "image")
        )
          throw Error("静态图片未改写 " + url);
    const visit = (v: unknown) => {
      if (typeof v === "string" && v.startsWith("media/")) {
        if (!expected.has(v)) throw Error("媒体引用缺失 " + v);
      } else if (v && typeof v === "object") Object.values(v).forEach(visit);
    };
    visit(data);
  }
  return {
    snapshotId: manifest.snapshotId,
    detailCount,
    images: expected.size,
  };
}
export async function validateDist(root = "dist") {
  if (!(await exists(join(root, "index.html")))) throw Error("缺少构建入口");
  const info = await readJson(join(root, "data/build-info.json"));
  const catalog = await readJson<Catalog>(join(root, "data/catalog.json"));
  for (const category of catalog.categories)
    for (const entry of category.items)
      if (!(await exists(join(root, entry.detailPath))))
        throw Error("构建详情缺失 " + entry.id);
  for (const required of ["data/media.json", "data/search.json"])
    if (!(await exists(join(root, required))))
      throw Error("构建数据缺失 " + required);
  const totals = { images: 0, details: 0, search: 0, code: 0, total: 0 };
  for (const file of await files(root)) {
    const rel = relative(root, file).replaceAll("\\", "/"),
      bytes = (await stat(file)).size;
    totals.total += bytes;
    if (rel.startsWith("media/")) {
      const b = await readFile(file);
      if (sniff(b).kind !== "image") throw Error("发布目录含非静态媒体 " + rel);
      totals.images += bytes;
    } else if (rel.startsWith("data/")) {
      if (rel.endsWith("search.json")) totals.search += bytes;
      else totals.details += bytes;
      const data = await readJson(file);
      if (data.snapshotId !== info.snapshotId)
        throw Error("构建数据混合快照 " + rel);
      const visit = (v: unknown) => {
        if (typeof v === "string" && v.startsWith("media/")) return v;
        return "";
      };
      const pending: string[] = [];
      function walk(v: unknown) {
        const p = visit(v);
        if (p) pending.push(p);
        else if (v && typeof v === "object") Object.values(v).forEach(walk);
      }
      walk(data);
      for (const p of pending)
        if (!(await exists(join(root, p)))) throw Error("构建资源缺失 " + p);
    } else totals.code += bytes;
    if (/\.(gif|wav|mp3|ogg|flac|aac|m4a|mp4|webm|m3u8|ts|mov)$/i.test(rel))
      throw Error("禁止发布媒体 " + rel);
    if (/(^|\/)(raw|fixtures|reports|node_modules)\//.test(rel))
      throw Error("构建含非公开文件 " + rel);
  }
  return {
    ...totals,
    status: capacity(totals.total),
    snapshotId: info.snapshotId,
  };
}
