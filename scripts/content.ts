import type {
  Catalog,
  Category,
  Detail,
  Inline,
  Node,
  SearchRecord,
  Source,
  Tab,
  Tag,
  Widget,
} from "../shared/types.ts";
import { categories, sourceHome, sourceLink } from "../shared/paths.ts";
export class StructureError extends Error {
  location: string;
  constructor(location: string, reason: string) {
    super(`${location}: ${reason}`);
    this.location = location;
  }
}
const nonempty = (v: unknown): boolean =>
  v !== null &&
  v !== undefined &&
  v !== "" &&
  v !== false &&
  (!Array.isArray(v) || v.length > 0) &&
  (typeof v !== "object" || Object.keys(v as object).length > 0);
export function allowed(value: Source, keys: string[], location: string) {
  for (const [key, v] of Object.entries(value))
    if (!keys.includes(key) && nonempty(v))
      throw new StructureError(`${location}/${key}`, "未知非空内容");
}
export function parseCatalog(raw: Source): Category[] {
  const subs = raw.data?.catalog?.flatMap((m: Source) => m.typeSub) || [];
  return categories.map((config) => {
    const s = subs.find((x: Source) => x.id === config.id);
    if (!s?.items?.length) throw Error(`栏目缺失或为空: ${config.name}`);
    const names = new Map<string, string>();
    const tags = (tree: Tag[]) => {
      for (const t of tree) {
        if (!t.name) throw Error(`标签缺少名称 ${t.id}`);
        names.set(t.id, t.name);
        tags(t.children || []);
      }
    };
    tags(s.filterTagTree || []);
    return {
      ...config,
      filterTagTree: s.filterTagTree || [],
      items: s.items.map((i: Source, order: number) => ({
        id: String(i.itemId),
        name: i.name,
        category: config.key,
        subId: config.id,
        cover: i.brief?.cover || "",
        tags: (i.tagIds || []).map((id: string) => {
          if (!names.has(id)) throw Error(`未知筛选标签 ${id}`);
          return names.get(id)!;
        }),
        tagIds: i.tagIds || [],
        order,
        detailPath: `data/details/${i.itemId}.json`,
        source: sourceLink(config.id, i.itemId),
      })),
    };
  });
}
export function references(raw: Source) {
  const refs: Catalog["references"] = {};
  for (const main of raw.data.catalog)
    for (const sub of main.typeSub)
      for (const i of sub.items) {
        const config = categories.find((c) => c.id === sub.id);
        refs[i.itemId] = {
          name: i.name,
          source: sourceLink(sub.id, i.itemId),
          ...(config
            ? {
                route: `/${config.key}/${i.itemId}`,
                cover: i.brief?.cover || "",
              }
            : {}),
        };
      }
  return refs;
}
export function compareCatalog(
  previous: Category[] | undefined,
  next: Category[],
  allow = false,
) {
  const changes: Record<string, { added: string[]; removed: string[] }> = {};
  for (const c of next) {
    const old = new Set(
      previous?.find((p) => p.id === c.id)?.items.map((i) => i.id) || [],
    );
    const current = new Set(c.items.map((i) => i.id));
    const removed = [...old].filter((id) => !current.has(id));
    if (old.size && removed.length / old.size > 0.1 && !allow)
      throw Error(
        `${c.name} 删除 ${removed.length}/${old.size}，超过 10%；确认后使用 --allow-removals`,
      );
    changes[c.key] = {
      added: [...current].filter((id) => !old.has(id)),
      removed,
    };
  }
  return changes;
}
export const idSet = (catalog: Category[]) =>
  catalog
    .flatMap((c) => c.items.map((i) => `${c.id}:${i.id}`))
    .sort()
    .join("|");
export function cleanSource(v: any): any {
  if (Array.isArray(v)) return v.map(cleanSource);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v)
        .filter(
          ([k]) =>
            ![
              "authorMap",
              "lastUpdatedUser",
              "createdUser",
              "lastAuditPassedAt",
            ].includes(k),
        )
        .map(([k, x]) => [k, cleanSource(x)]),
    );
  return v;
}
export interface Conversion {
  detail: Detail;
  records: SearchRecord[];
  structure: Record<string, number>;
}
export function convert(
  item: Source,
  entry: Category["items"][number],
  snapshotId: string,
  videos: Record<string, { cover: string }> = {},
  refs: Catalog["references"] = {},
): Conversion {
  const loc = `词条 ${entry.id}`;
  const structure: Record<string, number> = {};
  const bump = (key: string) => (structure[key] = (structure[key] || 0) + 1);
  const document = item.document || {};
  allowed(
    document,
    ["chapterGroup", "widgetCommonMap", "documentMap", "extraInfo"],
    loc + "/document",
  );
  allowed(
    document.extraInfo || {},
    ["illustration", "showType", "composite"],
    loc + "/extraInfo",
  );
  if (
    nonempty(document.extraInfo?.composite) ||
    nonempty(document.extraInfo?.showType)
  )
    throw new StructureError(loc + "/extraInfo", "未支持的展示扩展");
  const documents = document.documentMap || {};
  const seenDocuments = new Set<string>();
  function inline(v: Source, p: string): Inline {
    bump("inline:" + v.kind);
    allowed(
      v,
      [
        "kind",
        "text",
        "entry",
        "link",
        "bold",
        "italic",
        "underline",
        "color",
        "annotation",
      ],
      p,
    );
    const common = {
      bold: v.bold,
      italic: v.italic,
      underline: v.underline,
      color: v.color,
    };
    if (v.kind === "text") {
      allowed(v.text || {}, ["text"], p + "/text");
      return { kind: "text", text: v.text?.text || "", ...common };
    }
    if (v.kind === "entry") {
      allowed(v.entry || {}, ["id", "showType", "count"], p + "/entry");
      if (!["link-imgText", "card-big", "link-text"].includes(v.entry.showType))
        throw new StructureError(p, "未知关联展示 " + v.entry.showType);
      return {
        kind: "entry",
        text: "",
        entryId: String(v.entry.id),
        showType: v.entry.showType,
        count: v.entry.count,
        ...common,
      };
    }
    if (v.kind === "link") {
      allowed(v.link || {}, ["link", "text"], p + "/link");
      return {
        kind: "link",
        text: v.link.text || v.link.link,
        href: v.link.link,
        ...common,
      };
    }
    throw new StructureError(p, `未知行内 ${v.kind}`);
  }
  function doc(value: any, p: string): Node[] {
    if (!value) return [];
    if (typeof value === "string") seenDocuments.add(value);
    const d = typeof value === "string" ? documents[value] : value;
    if (!d) throw new StructureError(p, `文档缺失 ${value}`);
    allowed(d, ["id", "blockIds", "blockMap", "version", "authorMap"], p);
    if (!Array.isArray(d.blockIds) || !d.blockMap)
      throw new StructureError(p, "无效文档");
    const visited = new Set<string>();
    function block(id: string, chain: Set<string>): Node {
      if (chain.has(id)) throw new StructureError(p + "/" + id, "循环块引用");
      const b = d.blockMap[id];
      if (!b) throw new StructureError(p + "/" + id, "块引用缺失");
      visited.add(id);
      const path = p + "/" + id;
      const next = new Set(chain).add(id);
      bump("block:" + b.kind);
      allowed(b, ["id", "parentId", "align", "kind", b.kind], path);
      const node: Node = { id, kind: b.kind, align: b.align };
      const payload = b[b.kind];
      switch (b.kind) {
        case "text":
          allowed(payload, ["inlineElements", "kind"], path);
          if (
            ![
              "body",
              "heading1",
              "heading2",
              "heading3",
              "heading4",
              "heading5",
              "heading6",
            ].includes(payload.kind)
          )
            throw new StructureError(path, "未知文本层级 " + payload.kind);
          node.level = payload.kind.startsWith("heading")
            ? Number(payload.kind.slice(-1))
            : 0;
          node.inline = (payload.inlineElements || []).map(
            (v: Source, i: number) => inline(v, path + "/inline/" + i),
          );
          break;
        case "image":
          allowed(
            payload,
            [
              "id",
              "url",
              "width",
              "height",
              "clientWidth",
              "size",
              "format",
              "kind",
              "description",
              "status",
              "infos",
              "isAIGC",
            ],
            path,
          );
          if (nonempty(payload.infos))
            throw new StructureError(path + "/infos", "未知图片扩展");
          node.url = payload.url;
          node.description = payload.description;
          node.width =
            Number(payload.clientWidth || payload.width) || undefined;
          node.height = Number(payload.height) || undefined;
          break;
        case "horizontalLine":
          break;
        case "externalVideo":
          allowed(payload, ["id", "kind"], path);
          node.videoId = String(payload.id);
          node.videoKind = payload.kind;
          node.poster = videos[payload.id]?.cover;
          break;
        case "quote":
          allowed(payload, ["childIds"], path);
          node.children = (payload.childIds || []).map((x: string) =>
            block(x, next),
          );
          break;
        case "list":
          allowed(payload, ["id", "itemIds", "itemMap", "kind"], path);
          if (!["ordered", "unordered"].includes(payload.kind))
            throw new StructureError(path, "未知列表类型");
          node.ordered = payload.kind === "ordered";
          node.listItems = payload.itemIds.map((x: string) => {
            const li = payload.itemMap[x];
            if (!li) throw new StructureError(path, "缺少列表项 " + x);
            allowed(li, ["id", "childIds"], path + "/" + x);
            return li.childIds.map((y: string) => block(y, next));
          });
          break;
        case "table": {
          allowed(
            payload,
            [
              "id",
              "rowIds",
              "columnIds",
              "rowMap",
              "columnMap",
              "cellMap",
              "description",
              "rowHeader",
              "colHeader",
              "horizontalBorders",
              "verticalBorders",
            ],
            path,
          );
          for (const border of [
            ...(payload.horizontalBorders || []),
            ...(payload.verticalBorders || []),
          ]) {
            allowed(border, ["kind"], path + "/borders");
            if (border.kind !== "normal")
              throw new StructureError(
                path + "/borders",
                "未知表格边框 " + border.kind,
              );
          }
          node.description = payload.description;
          node.rows = payload.rowIds.length;
          node.columns = payload.columnIds.map(
            (c: string) => Number(payload.columnMap[c]?.width) || 0,
          );
          node.rowHeader = payload.rowHeader;
          node.colHeader = payload.colHeader;
          node.cells = [];
          const occupied = new Set<string>();
          const seenCells = new Set<string>();
          payload.rowIds.forEach((r: string, ri: number) =>
            payload.columnIds.forEach((c: string, ci: number) => {
              const key = r + "_" + c;
              const cell = payload.cellMap[key];
              if (occupied.has(`${ri},${ci}`)) {
                if (cell) throw new StructureError(path, "重叠单元格 " + key);
                return;
              }
              if (!cell) throw new StructureError(path, "缺少单元格 " + key);
              seenCells.add(key);
              allowed(
                cell,
                [
                  "id",
                  "childIds",
                  "rowSpan",
                  "colSpan",
                  "backgroundColor",
                  "verticalAlign",
                ],
                path + "/" + key,
              );
              const rowSpan = Number(cell.rowSpan) || 1,
                colSpan = Number(cell.colSpan) || 1;
              if (
                rowSpan < 1 ||
                colSpan < 1 ||
                ri + rowSpan > payload.rowIds.length ||
                ci + colSpan > payload.columnIds.length
              )
                throw new StructureError(path, "表格合并范围错误");
              for (let y = ri; y < ri + rowSpan; y++)
                for (let x = ci; x < ci + colSpan; x++) {
                  if (occupied.has(`${y},${x}`))
                    throw new StructureError(path, "表格合并重叠");
                  occupied.add(`${y},${x}`);
                }
              node.cells!.push({
                row: ri,
                col: ci,
                rowSpan,
                colSpan,
                background: cell.backgroundColor,
                verticalAlign: cell.verticalAlign,
                nodes: cell.childIds.map((x: string) => block(x, next)),
              });
            }),
          );
          if (Object.keys(payload.cellMap).some((k) => !seenCells.has(k)))
            throw new StructureError(path, "未遍历单元格");
          break;
        }
        default:
          throw new StructureError(path, `未知块 ${b.kind}`);
      }
      return node;
    }
    const nodes = d.blockIds.map((id: string) => block(id, new Set()));
    for (const [id, b] of Object.entries(d.blockMap) as [string, Source][])
      if (!visited.has(id) && nonempty(b))
        throw new StructureError(p + "/" + id, "未引用的非空块");
    return nodes;
  }
  const records: SearchRecord[] = [];
  const description = doc(item.brief?.description, loc + "/brief.description");
  const record = (
    chapterId: string,
    chapter: string,
    widgetId: string,
    widget: string,
    tab: Tab,
  ) => {
    const body = [
      chapter,
      widget,
      tab.title,
      tab.intro?.name,
      tab.intro?.type,
      textNodes(tab.intro?.nodes || [], refs),
      textNodes(tab.nodes, refs),
      ...tab.audio.flatMap((a) => [a.title, a.profile]),
    ]
      .filter(Boolean)
      .join("\n");
    records.push({
      id: `${entry.id}:${chapterId}:${widgetId}:${tab.id}`,
      itemId: entry.id,
      category: entry.category,
      name: entry.name,
      tags: entry.tags.join(" "),
      chapterId,
      chapter,
      widgetId,
      widget,
      tabId: tab.id,
      tab: tab.title,
      body,
    });
  };
  records.push({
    id: entry.id + ":brief",
    itemId: entry.id,
    category: entry.category,
    name: entry.name,
    tags: entry.tags.join(" "),
    chapterId: "brief",
    chapter: "简介",
    widgetId: "",
    widget: "",
    tabId: "",
    tab: "",
    body: textNodes(description, refs),
  });
  const seenWidgets = new Set<string>();
  const chapters = (document.chapterGroup || []).map(
    (chapter: Source, index: number) => {
      allowed(chapter, ["id", "title", "widgets"], loc + "/chapter/" + index);
      const chapterId = String(chapter.id ?? `chapter-${index}`);
      return {
        id: chapterId,
        title: chapter.title || `章节 ${index + 1}`,
        widgets: (chapter.widgets || []).map((ref: Source) => {
          const p = loc + "/widget/" + ref.id;
          allowed(ref, ["id", "title", "size"], p + "/ref");
          const w = document.widgetCommonMap?.[ref.id];
          if (!w) throw new StructureError(p, "组件缺失");
          seenWidgets.add(ref.id);
          allowed(
            w,
            ["type", "tableList", "tabList", "tabDataMap", "dialogList"],
            p,
          );
          if (nonempty(w.dialogList))
            throw new StructureError(p + "/dialogList", "未支持的非空对话结构");
          if (!["common", "table", "audio"].includes(w.type))
            throw new StructureError(p, "未知组件 " + w.type);
          bump("widget:" + w.type);
          for (const tabRef of w.tabList || [])
            allowed(tabRef, ["tabId", "title", "icon"], p + "/tabList");
          const ids = w.tabList?.length
            ? w.tabList.map((t: Source) => t.tabId)
            : Object.keys(w.tabDataMap || {});
          if (Object.keys(w.tabDataMap || {}).some((x) => !ids.includes(x)))
            throw new StructureError(p, "未引用标签页");
          const tabs: Tab[] = ids.map((id: string) => {
            const t = w.tabDataMap[id];
            if (!t) throw new StructureError(p + "/" + id, "标签内容缺失");
            allowed(t, ["intro", "content", "audioList"], p + "/" + id);
            if (t.intro)
              allowed(
                t.intro,
                ["name", "type", "imgUrl", "description"],
                p + "/" + id + "/intro",
              );
            const title = w.tabList?.find((x: Source) => x.tabId === id);
            const tab: Tab = {
              id,
              title: title?.title || t.intro?.name || "",
              icon: title?.icon || "",
              nodes: doc(t.content, p + "/" + id + "/content"),
              audio: (t.audioList || []).map((a: Source) => {
                allowed(
                  a,
                  ["id", "title", "profile", "resourceUrl"],
                  p + "/" + id + "/audio",
                );
                return {
                  id: a.id,
                  title: a.title,
                  profile: a.profile,
                  resourceUrl: a.resourceUrl,
                };
              }),
              ...(t.intro
                ? {
                    intro: {
                      name: t.intro.name,
                      type: t.intro.type,
                      image: t.intro.imgUrl,
                      nodes: doc(t.intro.description, p + "/" + id + "/intro"),
                    },
                  }
                : {}),
            };
            record(chapterId, chapter.title, ref.id, ref.title, tab);
            return tab;
          });
          const widget: Widget = {
            id: ref.id,
            title: ref.title,
            type: w.type,
            tabs,
            rows: (w.tableList || []).map((r: Source) => {
              allowed(r, ["id", "label", "value"], p + "/tableList");
              return { label: r.label, value: r.value };
            }),
          };
          if (widget.rows.length)
            record(chapterId, chapter.title, ref.id, ref.title, {
              id: "",
              title: "",
              icon: "",
              nodes: [
                {
                  id: "rows",
                  kind: "text",
                  inline: [
                    {
                      kind: "text",
                      text: widget.rows
                        .map((r) => `${r.label} ${r.value}`)
                        .join("\n"),
                    },
                  ],
                },
              ],
              audio: [],
            });
          return widget;
        }),
      };
    },
  );
  for (const id of Object.keys(document.widgetCommonMap || {}))
    if (!seenWidgets.has(id))
      throw new StructureError(loc + "/widget/" + id, "未引用组件");
  for (const id of Object.keys(documents))
    if (!seenDocuments.has(id))
      throw new StructureError(loc + "/documentMap/" + id, "未引用文档");
  return {
    detail: {
      schemaVersion: 1,
      snapshotId,
      id: entry.id,
      name: entry.name,
      category: entry.category,
      source: entry.source,
      cover: entry.cover,
      illustration: document.extraInfo?.illustration || "",
      description,
      chapters,
      original: cleanSource({ brief: item.brief, document: item.document }),
    },
    records,
    structure,
  };
}
export function textNodes(nodes: Node[], refs: Catalog["references"]): string {
  return nodes
    .map((n) =>
      [
        n.description,
        ...(n.inline || []).map((i) =>
          i.kind === "entry" ? refs[i.entryId!]?.name || "" : i.text,
        ),
        textNodes(n.children || [], refs),
        ...(n.listItems || []).map((x) => textNodes(x, refs)),
        ...(n.cells || []).map((c) => textNodes(c.nodes, refs)),
      ]
        .filter(Boolean)
        .join(" "),
    )
    .filter(Boolean)
    .join("\n");
}
export function collectUrls(value: unknown): Map<string, string> {
  const urls = new Map<string, string>();
  function walk(v: unknown, key = "") {
    if (typeof v === "string" && /^https?:\/\//.test(v)) {
      const ext = new URL(v).pathname.toLowerCase();
      let kind = "";
      if (/\.(gif)$/.test(ext)) kind = "gif";
      else if (/\.(wav|mp3|ogg|flac|m4a|aac)$/.test(ext)) kind = "audio";
      else if (/\.(mp4|webm|m3u8|ts|mov)$/.test(ext)) kind = "video";
      else if (
        /\.(png|jpe?g|webp|avif|svg|bmp)$/.test(ext) ||
        /^(cover|icon|imgUrl|illustration|poster|url)$/.test(key)
      )
        kind = "image";
      if (kind) urls.set(v, kind);
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === "object")
      Object.entries(v).forEach(([k, x]) => walk(x, k));
  }
  walk(value);
  return urls;
}
export function rewrite<T>(value: T, paths: Map<string, string>): T {
  if (typeof value === "string") return (paths.get(value) || value) as T;
  if (Array.isArray(value)) return value.map((x) => rewrite(x, paths)) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, x]) => [k, rewrite(x, paths)]),
    ) as T;
  return value;
}
export function videoIds(value: unknown): string[] {
  const ids = new Set<string>();
  function walk(v: any) {
    if (!v || typeof v !== "object") return;
    if (v.kind === "externalVideo" && v.externalVideo?.kind === "skland")
      ids.add(String(v.externalVideo.id));
    Object.values(v).forEach(walk);
  }
  walk(value);
  return [...ids];
}
