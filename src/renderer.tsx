import { Fragment, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Catalog, Inline, Node, Widget } from "../shared/types.ts";
import { safeUrl, sourceHome } from "../shared/paths.ts";
import { Picture, AudioPlayer } from "./media.tsx";
import { asset } from "./data.ts";
export const colors: Record<string, string> = {
  light_text_primary: "#303030",
  light_text_secondary: "#686868",
  light_text_tertiary: "#77776e",
  light_text_quaternary: "#89897c",
  light_function_blueness: "#177b9a",
  light_function_blue: "#177b9a",
  light_function_red: "#b83838",
  light_function_yellow: "#866600",
  light_function_green: "#267447",
  light_function_sandstone: "#997d49",
  light_function_turquoise: "#268a7b",
  light_function_orange: "#bb641c",
  light_function_brown: "#8c5842",
  light_rank_gray: "#767676",
  light_rank_yellow: "#a37b05",
  light_rank_blue: "#317da7",
  light_rank_green: "#468148",
  light_rank_orange: "#b26322",
  light_rank_purple: "#8564ae",
};
function color(value?: string) {
  return value
    ? colors[value] || (/^#[\da-f]{3,8}$/i.test(value) ? value : undefined)
    : undefined;
}
function InlineElement({
  element: i,
  catalog,
}: {
  element: Inline;
  catalog: Catalog;
}) {
  const style = {
    fontWeight: i.bold ? 700 : undefined,
    fontStyle: i.italic ? "italic" : undefined,
    textDecoration: i.underline ? "underline" : undefined,
    color: color(i.color),
  };
  if (i.kind === "text") return <span style={style}>{i.text}</span>;
  if (i.kind === "link")
    return (
      <a
        href={safeUrl(i.href || "") || undefined}
        style={style}
        target="_blank"
        rel="noreferrer"
      >
        {i.text}
      </a>
    );
  const ref = catalog.references[i.entryId || ""];
  const text = ref?.name || `词条 ${i.entryId}`;
  const content = (
    <>
      {(i.showType?.toLowerCase().includes("img") ||
        i.showType === "card-big") &&
        ref?.cover && (
          <img
            className="entry-thumbnail"
            src={asset(ref.cover)}
            alt=""
            loading="lazy"
          />
        )}
      {text}
      {i.count && i.count !== "0" ? ` ×${i.count}` : ""}
    </>
  );
  return ref?.route ? (
    <Link
      className={`entry-link ${i.showType === "card-big" ? "entry-card-inline" : ""}`}
      to={ref.route}
      style={style}
    >
      {content}
    </Link>
  ) : (
    <a
      className={`entry-link ${i.showType === "card-big" ? "entry-card-inline" : ""}`}
      href={ref?.source || sourceHome}
      target="_blank"
      rel="noreferrer"
      style={style}
    >
      {content} ↗
    </a>
  );
}
export function Nodes({
  nodes,
  catalog,
  source,
}: {
  nodes: Node[];
  catalog: Catalog;
  source: string;
}) {
  return (
    <>
      {nodes.map((n, index) => (
        <Block
          key={`${n.id}-${index}`}
          node={n}
          catalog={catalog}
          source={source}
        />
      ))}
    </>
  );
}
function Block({
  node: n,
  catalog,
  source,
}: {
  node: Node;
  catalog: Catalog;
  source: string;
}) {
  const children = (nodes: Node[]) => (
    <Nodes nodes={nodes} catalog={catalog} source={source} />
  );
  const style = { textAlign: n.align as React.CSSProperties["textAlign"] };
  switch (n.kind) {
    case "text": {
      const Tag = (n.level ? `h${Math.min(6, n.level + 1)}` : "p") as "p";
      return (
        <Tag className="rich-text" style={style}>
          {n.inline?.map((i, x) => (
            <InlineElement key={x} element={i} catalog={catalog} />
          ))}
        </Tag>
      );
    }
    case "horizontalLine":
      return <hr />;
    case "image":
      return (
        <figure style={style}>
          <Picture
            source={source}
            url={n.url || ""}
            description={n.description || ""}
            width={n.width}
          />
          {n.description && <figcaption>{n.description}</figcaption>}
        </figure>
      );
    case "quote":
      return <blockquote>{children(n.children || [])}</blockquote>;
    case "list": {
      const Tag = n.ordered ? "ol" : "ul";
      return (
        <Tag>
          {n.listItems?.map((items, i) => (
            <li key={i}>{children(items)}</li>
          ))}
        </Tag>
      );
    }
    case "table":
      return (
        <div className="table-scroll" tabIndex={0} aria-label="横向滚动表格">
          <table>
            {n.description && <caption>{n.description}</caption>}
            <colgroup>
              {n.columns?.map((w, i) => (
                <col key={i} style={w ? { width: w } : undefined} />
              ))}
            </colgroup>
            <tbody>
              {Array.from({ length: n.rows || 0 }, (_, r) => (
                <tr key={r}>
                  {n.cells
                    ?.filter((c) => c.row === r)
                    .map((c) => {
                      const Tag =
                        (n.rowHeader && r === 0) || (n.colHeader && c.col === 0)
                          ? "th"
                          : "td";
                      return (
                        <Tag
                          key={c.col}
                          colSpan={c.colSpan}
                          rowSpan={c.rowSpan}
                          style={{
                            backgroundColor: color(c.background),
                            verticalAlign: ["top", "middle", "bottom"].includes(
                              c.verticalAlign || "",
                            )
                              ? (c.verticalAlign as "top")
                              : undefined,
                          }}
                        >
                          {children(c.nodes)}
                        </Tag>
                      );
                    })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "externalVideo":
      return (
        <div className="video-card">
          {n.poster && (
            <Picture source={source} url={n.poster} description="视频封面" />
          )}
          <div>
            <strong>来源视频</strong>
            <p>在原站观看完整视频。</p>
            <a
              className="button"
              href={source}
              target="_blank"
              rel="noreferrer"
            >
              打开原站 ↗
            </a>
          </div>
        </div>
      );
  }
}
export function WidgetView({
  widget: w,
  catalog,
  source,
}: {
  widget: Widget;
  catalog: Catalog;
  source: string;
}) {
  const [params, setParams] = useSearchParams();
  const [local, setLocal] = useState(w.tabs[0]?.id || "");
  const selected =
    params.get("widget") === w.id
      ? w.tabs.find((t) => t.id === params.get("tab"))
      : undefined;
  const tab = selected || w.tabs.find((t) => t.id === local) || w.tabs[0];
  return (
    <section className="widget" id={`widget-${w.id}`} data-widget-id={w.id}>
      <h3>{w.title}</h3>
      {w.rows.length > 0 && (
        <dl className="facts">
          {w.rows.map((r, i) => (
            <Fragment key={i}>
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      {w.tabs.length > 1 && (
        <div className="tabs" role="tablist" aria-label={w.title}>
          {w.tabs.map((t, i) => (
            <button
              id={`tab-${w.id}-${t.id}`}
              key={t.id}
              role="tab"
              aria-selected={t.id === tab?.id}
              aria-controls={`panel-${w.id}`}
              tabIndex={t.id === tab?.id ? 0 : -1}
              data-tab-id={t.id}
              onKeyDown={(e) => {
                if (
                  ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
                ) {
                  e.preventDefault();
                  const idx =
                    e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? w.tabs.length - 1
                        : (i +
                            (e.key === "ArrowLeft" ? -1 : 1) +
                            w.tabs.length) %
                          w.tabs.length;
                  const next = w.tabs[idx];
                  setLocal(next.id);
                  const q = new URLSearchParams(params);
                  q.set("widget", w.id);
                  q.set("tab", next.id);
                  setParams(q, { replace: true, preventScrollReset: true });
                  document.getElementById(`tab-${w.id}-${next.id}`)?.focus();
                }
              }}
              onClick={() => {
                setLocal(t.id);
                const q = new URLSearchParams(params);
                q.set("widget", w.id);
                q.set("tab", t.id);
                setParams(q, { replace: true, preventScrollReset: true });
              }}
            >
              {t.icon && <img src={asset(t.icon)} alt="" loading="lazy" />}
              {t.title || `标签 ${i + 1}`}
            </button>
          ))}
        </div>
      )}
      {tab && (
        <div
          className="tab-panel"
          role={w.tabs.length > 1 ? "tabpanel" : undefined}
          aria-labelledby={
            w.tabs.length > 1 ? `tab-${w.id}-${tab.id}` : undefined
          }
          id={`panel-${w.id}`}
          data-active-tab={tab.id}
          key={tab.id}
        >
          {tab.intro && (
            <div className="intro">
              {tab.intro.image && (
                <Picture
                  source={source}
                  url={tab.intro.image}
                  description={tab.intro.name}
                />
              )}
              <h4>
                {tab.intro.name} <small>{tab.intro.type}</small>
              </h4>
              <Nodes
                nodes={tab.intro.nodes}
                catalog={catalog}
                source={source}
              />
            </div>
          )}
          <Nodes nodes={tab.nodes} catalog={catalog} source={source} />
          {tab.audio.map((a, i) => (
            <AudioPlayer key={`${a.id}-${i}`} audio={a} source={source} />
          ))}
        </div>
      )}
    </section>
  );
}
