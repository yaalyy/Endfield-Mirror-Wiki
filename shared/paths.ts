export const categories = [
  { id: "1", key: "operators", name: "干员" },
  { id: "2", key: "weapons", name: "武器" },
  { id: "4", key: "equipment", name: "装备" },
] as const;
export const sourceHome = "https://wiki.skland.com/endfield?header=0";
export function sourceLink(subId: string, id: string) {
  return `https://wiki.skland.com/endfield/detail?mainTypeId=1&subTypeId=${encodeURIComponent(subId)}&gameEntryId=${encodeURIComponent(id)}`;
}
export function localPath(path: string, base = "/Endfield-Mirror-Wiki/") {
  return `${base.replace(/\/?$/, "/")}${path.replace(/^\/+/, "")}`;
}
export function safeUrl(url: string) {
  return /^(https?:\/\/|media\/|#\/)/i.test(url) ? url : "";
}
export function detailRoute(
  category: string,
  id: string,
  position?: { chapterId?: string; widgetId?: string; tabId?: string },
) {
  const q = new URLSearchParams();
  if (position?.chapterId) q.set("chapter", position.chapterId);
  if (position?.widgetId) q.set("widget", position.widgetId);
  if (position?.tabId) q.set("tab", position.tabId);
  return `/${category}/${encodeURIComponent(id)}${q.size ? "?" + q : ""}`;
}
