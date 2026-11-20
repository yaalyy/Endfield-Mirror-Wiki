// Source values are untrusted: conversion validates every content discriminator and reference.
export type Source = Record<string, any>;
export type CategoryKey = "operators" | "weapons" | "equipment";
export interface Tag {
  id: string;
  name: string;
  children: Tag[];
  hide?: boolean;
}
export interface Entry {
  id: string;
  name: string;
  category: CategoryKey;
  subId: string;
  cover: string;
  tags: string[];
  tagIds: string[];
  order: number;
  detailPath: string;
  source: string;
}
export interface Category {
  id: string;
  key: CategoryKey;
  name: string;
  filterTagTree: Tag[];
  items: Entry[];
}
export interface BuildInfo {
  schemaVersion: 1;
  snapshotId: string;
  syncedAt: string;
  counts: Record<string, number>;
  codeVersion: string;
  fixture: boolean;
}
export interface Catalog extends BuildInfo {
  categories: Category[];
  references: Record<
    string,
    { name: string; source: string; route?: string; cover?: string }
  >;
}
export interface Inline {
  kind: "text" | "entry" | "link";
  text: string;
  href?: string;
  entryId?: string;
  showType?: string;
  count?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
}
export interface Cell {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  nodes: Node[];
  background?: string;
  verticalAlign?: string;
}
export interface Node {
  id: string;
  kind:
    | "text"
    | "image"
    | "table"
    | "quote"
    | "list"
    | "horizontalLine"
    | "externalVideo";
  align?: string;
  level?: number;
  inline?: Inline[];
  url?: string;
  description?: string;
  width?: number;
  height?: number;
  rows?: number;
  columns?: number[];
  cells?: Cell[];
  rowHeader?: boolean;
  colHeader?: boolean;
  children?: Node[];
  listItems?: Node[][];
  ordered?: boolean;
  videoId?: string;
  videoKind?: string;
  poster?: string;
}
export interface Audio {
  id: string;
  title: string;
  profile: string;
  resourceUrl: string;
}
export interface Tab {
  id: string;
  title: string;
  icon: string;
  intro?: { name: string; type: string; image: string; nodes: Node[] };
  nodes: Node[];
  audio: Audio[];
}
export interface Widget {
  id: string;
  title: string;
  type: "common" | "table" | "audio";
  tabs: Tab[];
  rows: { label: string; value: string }[];
}
export interface Chapter {
  id: string;
  title: string;
  widgets: Widget[];
}
export interface Detail {
  schemaVersion: 1;
  snapshotId: string;
  id: string;
  name: string;
  category: CategoryKey;
  source: string;
  cover: string;
  illustration: string;
  description: Node[];
  chapters: Chapter[];
  original: Source;
}
export interface SearchRecord {
  id: string;
  itemId: string;
  category: CategoryKey;
  name: string;
  tags: string;
  chapterId: string;
  chapter: string;
  widgetId: string;
  widget: string;
  tabId: string;
  tab: string;
  body: string;
}
export interface Media {
  url: string;
  kind: "image" | "gif" | "audio" | "video";
  localPath?: string;
  bytes: number;
  sha256?: string;
  etag?: string;
  lastModified?: string;
  cacheStatus?: "downloaded" | "not-modified";
}
export interface Manifest extends BuildInfo {
  media: Media[];
  changes: Record<string, { added: string[]; removed: string[] }>;
  structure: Record<string, number>;
  stats?: Record<string, number>;
}
