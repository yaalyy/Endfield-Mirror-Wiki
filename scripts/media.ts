import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
import type { Media } from "../shared/types.ts";
import { request } from "./api.ts";
import { sha, exists } from "./io.ts";
export function sniff(
  bytes: Uint8Array,
  contentType = "",
): { kind: Media["kind"]; extension: string } {
  const b = Buffer.from(bytes),
    head = b.subarray(0, 500).toString("utf8").trimStart();
  if (/^<(?:!doctype\s+html|html|head|body)/i.test(head))
    throw Error("资源返回 HTML");
  if (
    b
      .subarray(0, 6)
      .toString()
      .match(/^GIF8[79]a$/)
  )
    return { kind: "gif", extension: "gif" };
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return { kind: "image", extension: "png" };
  if (b[0] === 255 && b[1] === 216 && b[2] === 255)
    return { kind: "image", extension: "jpg" };
  if (
    b.subarray(0, 4).toString() === "RIFF" &&
    b.subarray(8, 12).toString() === "WEBP"
  )
    return { kind: "image", extension: "webp" };
  if (
    b.subarray(4, 8).toString() === "ftyp" &&
    /avif|avis/.test(b.subarray(8, 40).toString())
  )
    return { kind: "image", extension: "avif" };
  if (/^(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(head)) {
    const full = b.toString("utf8");
    if (
      /<script|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|javascript:|data:text\/html)/i.test(
        full,
      )
    )
      throw Error("SVG 含主动或外部内容");
    return { kind: "image", extension: "svg" };
  }
  if (contentType.startsWith("audio/"))
    return { kind: "audio", extension: "audio" };
  if (contentType.startsWith("video/") || head.startsWith("#EXTM3U"))
    return { kind: "video", extension: "video" };
  throw Error("无法识别媒体格式 " + contentType);
}
export async function validCache(record: Media | undefined, root: string) {
  if (!record?.localPath || !record.sha256) return false;
  try {
    const b = await readFile(join(root, record.localPath));
    return (
      b.length === record.bytes &&
      sha(b) === record.sha256 &&
      sniff(b).kind === "image"
    );
  } catch {
    return false;
  }
}
export async function fetchMedia(
  url: string,
  hint: string,
  root: string,
  oldRoot: string,
  old: Media | undefined,
  force = false,
): Promise<Media> {
  if (hint !== "image") return { url, kind: hint as Media["kind"], bytes: 0 };
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0",
    Accept: "image/*",
    "Accept-Encoding": "identity",
  };
  const cached = !force && (await validCache(old, oldRoot));
  if (cached) {
    if (old?.etag) headers["If-None-Match"] = old.etag;
    else if (old?.lastModified) headers["If-Modified-Since"] = old.lastModified;
  }
  const r = await request(url, { headers });
  if (r.status === 304) {
    if (!cached || !old?.localPath) throw Error("无可用缓存却收到 304");
    await mkdir(join(root, "media"), { recursive: true });
    if (!(await exists(join(root, old.localPath))))
      await copyFile(join(oldRoot, old.localPath), join(root, old.localPath));
    return { ...old, cacheStatus: "not-modified" };
  }
  const b = Buffer.from(await r.arrayBuffer());
  const kind = sniff(b, r.headers.get("content-type") || "");
  if (kind.kind === "gif") return { url, kind: "gif", bytes: 0 };
  if (kind.kind !== "image") throw Error("图片请求返回非图片媒体 " + kind.kind);
  const hash = sha(b),
    localPath = `media/${hash}.${kind.extension}`;
  await mkdir(join(root, "media"), { recursive: true });
  await writeFile(join(root, localPath), b);
  return {
    url,
    kind: "image",
    bytes: b.length,
    sha256: hash,
    localPath,
    cacheStatus: "downloaded",
    etag: r.headers.get("etag") || undefined,
    lastModified: r.headers.get("last-modified") || undefined,
  };
}
