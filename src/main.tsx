import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  HashRouter,
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useNavigationType,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type { Catalog, Category, Detail, Entry } from "../shared/types.ts";
import { sourceHome } from "../shared/paths.ts";
import { load, loadDetail, asset } from "./data.ts";
import { Picture, stopAudio } from "./media.tsx";
import { Nodes, WidgetView } from "./renderer.tsx";
import "./style.css";
const Search = lazy(() => import("./Search.tsx"));
function Failure({ message }: { message: string }) {
  return (
    <div className="error-panel" role="alert">
      <h1>暂时无法读取页面</h1>
      <p>{message}</p>
      <button onClick={() => location.reload()}>刷新页面</button>{" "}
      <a href={sourceHome} target="_blank" rel="noreferrer">
        打开原站 ↗
      </a>
    </div>
  );
}
const positions = new Map<string, number>();
function ScrollMemory() {
  const location = useLocation(),
    type = useNavigationType();
  const key = location.pathname + location.search;
  useEffect(() => {
    history.scrollRestoration = "manual";
    const save = (event?: Event) => {
      if (
        event?.type === "click" &&
        !(event.target as Element)?.closest('a[href^="#"]')
      )
        return;
      positions.set(key, window.scrollY);
    };
    document.addEventListener("click", save, true);
    window.addEventListener("popstate", save);
    const timer = setTimeout(() => {
      if (type === "POP" && positions.has(key))
        window.scrollTo({ top: positions.get(key) || 0, behavior: "instant" });
      else if (type !== "POP" && !location.search.includes("widget="))
        window.scrollTo({ top: 0, behavior: "instant" });
    }, 150);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", save, true);
      window.removeEventListener("popstate", save);
    };
  }, [key, type]);
  return null;
}
function App() {
  const [catalog, setCatalog] = useState<Catalog>(),
    [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const navigate = useNavigate(),
    location = useLocation();
  useEffect(() => {
    const abort = new AbortController();
    load<Catalog>("data/catalog.json", abort.signal)
      .then(setCatalog)
      .catch((e) => {
        if (e.name !== "AbortError") setError(String(e));
      });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    setQuery(new URLSearchParams(location.search).get("q") || "");
    stopAudio();
  }, [location.pathname]);
  if (error) return <Failure message={error} />;
  if (!catalog)
    return (
      <p className="loading" role="status">
        正在读取百科目录…
      </p>
    );
  const stale = Date.now() - Date.parse(catalog.syncedAt) > 10 * 86400_000;
  return (
    <>
      <ScrollMemory />
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">◈</span>
          <span>
            终末地百科<small>ENDFIELD / MIRROR</small>
          </span>
        </Link>
        <form
          className="search-box"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            navigate("/search?q=" + encodeURIComponent(query));
          }}
        >
          <input
            aria-label="搜索全部正文"
            placeholder="搜索名称、标签、档案与台词"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button aria-label="搜索" type="submit">
            ⌕
          </button>
        </form>
        <span className="mirror-label">非官方镜像</span>
      </header>
      <nav className="sidebar" aria-label="百科栏目">
        <NavLink to="/" end>
          ⌂ <span>首页</span>
        </NavLink>
        {catalog.categories.map((c) => (
          <NavLink key={c.key} to={"/" + c.key}>
            ◇ <span>{c.name}</span>
            <small>{c.items.length}</small>
          </NavLink>
        ))}
        <div className="sidebar-note">
          <p>公开资料 · 静态镜像</p>
          <a href={sourceHome} target="_blank" rel="noreferrer">
            森空岛原站 ↗
          </a>
          <p>
            最近成功同步
            <br />
            <time dateTime={catalog.syncedAt}>
              {new Date(catalog.syncedAt).toLocaleString("zh-CN", {
                timeZone: "UTC",
                hour12: false,
              })}{" "}
              UTC
            </time>
          </p>
        </div>
      </nav>
      <div className="workspace">
        {(stale || catalog.fixture) && (
          <div className="notice" role="status">
            {catalog.fixture
              ? "当前为固定样本预览，正式内容请运行完整同步。"
              : "数据距上次成功同步超过 10 天，可能已经过期。"}
          </div>
        )}
        <Suspense fallback={<p className="loading">正在加载…</p>}>
          <Routes>
            <Route path="/" element={<Home catalog={catalog} />} />
            {catalog.categories.map((c) => (
              <React.Fragment key={c.key}>
                <Route
                  path={"/" + c.key}
                  element={<CategoryPage category={c} />}
                />
                <Route
                  path={"/" + c.key + "/:id"}
                  element={<DetailPage catalog={catalog} category={c} />}
                />
              </React.Fragment>
            ))}
            <Route path="/search" element={<Search catalog={catalog} />} />
            <Route
              path="*"
              element={
                <main className="page">
                  <h1>没有找到页面</h1>
                  <Link to="/">返回首页</Link>
                </main>
              }
            />
          </Routes>
        </Suspense>
        <footer>
          本网站为非官方镜像。词条内容与素材来自森空岛终末地百科，权利归原作者及相应权利人所有。
          <a href={sourceHome} target="_blank" rel="noreferrer">
            查看来源 ↗
          </a>
          <br />
          同步：{catalog.syncedAt} · 数据版本 {catalog.snapshotId.slice(0, 10)}
        </footer>
      </div>
    </>
  );
}
function Home({ catalog }: { catalog: Catalog }) {
  return (
    <main className="page">
      <section className="home-hero">
        <p className="eyebrow">ARKNIGHTS: ENDFIELD / DATABASE</p>
        <div className="hero-index">01 — 03</div>
        <h1>
          开拓前路，
          <br />
          查阅塔卫二。
        </h1>
        <p>
          干员档案、武器资料与装备信息。
          <br />
          完整正文与静态图片，面向海外访问的百科镜像。
        </p>
        <div className="hero-rule" />
      </section>
      <div className="category-portals">
        {catalog.categories.map((c, i) => (
          <Link to={"/" + c.key} key={c.key}>
            <span className="portal-number">0{i + 1}</span>
            <img src={asset(c.items[0].cover)} alt="" />
            <div>
              <p className="eyebrow">{c.key.toUpperCase()}</p>
              <h2>{c.name}</h2>
              <span>{c.items.length} 个公开词条　↗</span>
            </div>
          </Link>
        ))}
      </div>
      <section className="home-about">
        <h2>资料同步记录</h2>
        <p>
          最近一次成功同步：
          <time dateTime={catalog.syncedAt}>{catalog.syncedAt}</time>
        </p>
        <p>
          支持完整正文检索，包含技能、档案、故事和多语言语音台词。动态图片、语音和视频通过来源外链提供。
        </p>
      </section>
    </main>
  );
}
function descendants(tag: { id: string; children?: any[] }): string[] {
  return [tag.id, ...(tag.children || []).flatMap(descendants)];
}
function CategoryPage({ category: c }: { category: Category }) {
  const [urlParams, setParams] = useSearchParams();
  const [params, setFilterParams] = useState(urlParams);
  useEffect(() => setFilterParams(urlParams), [urlParams.toString()]);
  const groups = c.filterTagTree.filter((g) => !g.hide);
  const selected = groups.map((g) => ({
    group: g,
    ids: (params.get(g.id) || "").split(",").filter(Boolean),
  }));
  const items = c.items.filter((e) =>
    selected.every(
      ({ group, ids }) =>
        !ids.length ||
        ids.some((id) => {
          const tag = group.children.find((t) => t.id === id);
          return !!tag && descendants(tag).some((x) => e.tagIds.includes(x));
        }),
    ),
  );
  const toggle = (groupId: string, id: string) => {
    const next = new URLSearchParams(params);
    const ids = new Set((next.get(groupId) || "").split(",").filter(Boolean));
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    if (ids.size) next.set(groupId, [...ids].join(","));
    else next.delete(groupId);
    setFilterParams(next);
    setParams(next, { preventScrollReset: true });
  };
  return (
    <main className={`page category-page ${c.key}`}>
      <p className="eyebrow">DATABASE / {c.key.toUpperCase()}</p>
      <div className="page-heading">
        <h1>{c.name}</h1>
        <span>
          {items.length} / {c.items.length} 个词条
        </span>
      </div>
      <div className="filters" aria-label="筛选词条">
        {groups.map((g) => (
          <details className="filter-group" key={g.id}>
            <summary>
              {g.name}
              {selected.find((s) => s.group.id === g.id)?.ids.length
                ? ` · ${selected.find((s) => s.group.id === g.id)!.ids.length}`
                : ""}
            </summary>
            <div>
              {g.children
                .filter((t) => !t.hide)
                .map((t) => (
                  <label key={t.id}>
                    <input
                      type="checkbox"
                      checked={(params.get(g.id) || "")
                        .split(",")
                        .includes(t.id)}
                      onChange={() => toggle(g.id, t.id)}
                    />
                    {t.name}
                  </label>
                ))}
            </div>
          </details>
        ))}
        {params.size > 0 && (
          <button
            className="clear-filters"
            onClick={() => {
              setFilterParams(new URLSearchParams());
              setParams({}, { preventScrollReset: true });
            }}
          >
            清除筛选
          </button>
        )}
      </div>
      <div className="entry-grid">
        {items.map((e) => (
          <EntryCard key={e.id} entry={e} />
        ))}
      </div>
      {!items.length && <p role="status">没有符合当前筛选的词条。</p>}
    </main>
  );
}
function EntryCard({ entry: e }: { entry: Entry }) {
  return (
    <Link className="entry-card" to={`/${e.category}/${e.id}`}>
      <div className="card-image">
        <img src={asset(e.cover)} alt="" loading="lazy" />
      </div>
      <div className="card-copy">
        <h2>{e.name}</h2>
        <p>{e.tags.join(" / ")}</p>
        <span className="card-arrow">↗</span>
      </div>
    </Link>
  );
}
function DetailPage({
  catalog,
  category,
}: {
  catalog: Catalog;
  category: Category;
}) {
  const { id } = useParams();
  const [params] = useSearchParams();
  const [detail, setDetail] = useState<Detail>(),
    [error, setError] = useState("");
  const entry = category.items.find((i) => i.id === id);
  const navigation = useNavigationType();
  const location = useLocation();
  const navRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    setError("");
    setDetail(undefined);
    if (!entry) return;
    const abort = new AbortController();
    loadDetail(entry.detailPath, catalog, abort.signal)
      .then(setDetail)
      .catch((e) => {
        if (e.name !== "AbortError") setError(String(e));
      });
    return () => {
      abort.abort();
      stopAudio();
    };
  }, [id, catalog.snapshotId]);
  useEffect(() => {
    if (!detail) return;
    document.title = `${detail.name} · 终末地百科镜像`;
    // Tab changes replace the URL for sharing while preserving the user's focus.
    if (navigation === "REPLACE") return;
    const timer = setTimeout(() => {
      const widget = params.get("widget"),
        chapter = params.get("chapter");
      const el = widget
        ? document.getElementById("widget-" + widget)
        : chapter
          ? document.getElementById("chapter-" + chapter)
          : null;
      if (el) el.scrollIntoView({ block: "start" });
      else if (
        navigation === "POP" &&
        positions.has(location.pathname + location.search)
      )
        window.scrollTo(
          0,
          positions.get(location.pathname + location.search) || 0,
        );
    }, 100);
    return () => clearTimeout(timer);
  }, [detail, params.get("chapter"), params.get("widget")]);
  if (!entry) return <Failure message="当前目录中没有此词条。" />;
  if (error) return <Failure message={error} />;
  if (!detail)
    return (
      <p className="loading" role="status">
        正在读取 {entry.name}…
      </p>
    );
  const q = (chapter: string) => {
    const next = new URLSearchParams();
    next.set("chapter", chapter);
    return "?" + next;
  };
  return (
    <main className={`detail-page ${category.key}`} data-entry-id={detail.id}>
      <div className="detail-breadcrumb">
        <Link to={"/" + category.key}>{category.name}</Link> / {detail.name}
        <a href={detail.source} target="_blank" rel="noreferrer">
          原站词条 ↗
        </a>
      </div>
      <section className="detail-hero" id="chapter-brief">
        {(detail.illustration || detail.cover) && (
          <img
            className="illustration"
            src={asset(detail.illustration || detail.cover)}
            alt=""
          />
        )}
        <div className="detail-heading">
          <p className="eyebrow">
            ARKNIGHTS: ENDFIELD / {category.key.toUpperCase()}
          </p>
          <h1>{detail.name}</h1>
          <div className="tag-line">
            {entry.tags.map((tag, i) => (
              <span key={i}>{tag}</span>
            ))}
          </div>
          <div className="description">
            <Nodes
              nodes={detail.description}
              catalog={catalog}
              source={detail.source}
            />
          </div>
        </div>
      </section>
      <details
        className="chapter-nav"
        ref={navRef}
        open={innerWidth > 1100 || undefined}
      >
        <summary>章节导航</summary>
        <nav aria-label="词条章节">
          <Link
            to={q("brief")}
            onClick={() => {
              if (innerWidth < 1000) navRef.current!.open = false;
            }}
          >
            词条简介
          </Link>
          {detail.chapters.map((c) => (
            <Link
              to={q(c.id)}
              key={c.id}
              onClick={() => {
                if (innerWidth < 1000) navRef.current!.open = false;
              }}
            >
              {c.title}
            </Link>
          ))}
        </nav>
      </details>
      <div className="chapters">
        {detail.chapters.map((chapter) => (
          <section
            className="chapter"
            id={"chapter-" + chapter.id}
            key={chapter.id}
            data-chapter-id={chapter.id}
          >
            <h2>
              <span>[</span> {chapter.title} <span>]</span>
            </h2>
            {chapter.widgets.map((widget) => (
              <WidgetView
                key={widget.id}
                widget={widget}
                catalog={catalog}
                source={detail.source}
              />
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <HashRouter>
    <App />
  </HashRouter>,
);
