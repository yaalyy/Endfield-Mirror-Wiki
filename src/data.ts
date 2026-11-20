import type { Catalog, Detail } from "../shared/types.ts";
import { localPath } from "../shared/paths.ts";
export const asset = (path: string) =>
  /^https?:\/\//.test(path) ? path : localPath(path, import.meta.env.BASE_URL);
export class SnapshotChanged extends Error {}
export async function load<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(asset(path), {
    signal,
    referrerPolicy: "no-referrer",
  });
  if (!response.ok)
    throw new Error(
      `数据读取失败 (${response.status})。网站可能已更新，请刷新页面。`,
    );
  return response.json();
}
export async function loadDetail(
  path: string,
  catalog: Catalog,
  signal?: AbortSignal,
) {
  const detail = await load<Detail>(path, signal);
  if (detail.snapshotId !== catalog.snapshotId)
    throw new SnapshotChanged("网站数据已更新，请刷新页面载入同一版本。");
  return detail;
}
