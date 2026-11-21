import type { Options, SearchOptions } from "minisearch";
import { tokenize } from "./tokenize.ts";
import type { SearchRecord } from "./types.ts";
// Index build (sync) and index load (worker) must use identical options,
// otherwise MiniSearch.loadJS silently returns wrong results.
export const indexOptions: Options<SearchRecord> = {
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
};
export const queryOptions: SearchOptions = {
  boost: { name: 8, tags: 3, body: 1 },
  combineWith: "AND",
  prefix: (term) => /^[a-z0-9]+$/.test(term),
};
