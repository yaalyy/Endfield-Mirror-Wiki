import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Catalog, SearchRecord } from "../shared/types.ts";
import { detailRoute } from "../shared/paths.ts";
import { asset } from "./data.ts";
function excerpt(body: string, query: string) {
  const terms = query.trim().split(/\s+/);
  const at = Math.max(0, ...terms.map((t) => body.indexOf(t)));
  const start = Math.max(0, at - 45);
  return (
    (start ? "…" : "") +
    body.slice(start, start + 180) +
    (body.length > start + 180 ? "…" : "")
  );
}
export default function Search({ catalog }: { catalog: Catalog }) {
  const [params] = useSearchParams(),
    query = params.get("q") || "";
  const [limit, setLimit] = useState(50);
  const [result, setResult] = useState<{
    results: SearchRecord[];
    total: number;
    error?: string;
  }>({ results: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const worker = useRef<Worker | null>(null),
    sequence = useRef(0);
  useEffect(() => {
    worker.current = new Worker(
      new URL("./search.worker.ts", import.meta.url),
      { type: "module" },
    );
    return () => worker.current?.terminate();
  }, []);
  useEffect(() => {
    setLimit(50);
  }, [query]);
  useEffect(() => {
    const w = worker.current!;
    const id = ++sequence.current;
    setLoading(true);
    const receive = (event: MessageEvent) => {
      if (event.data.id !== sequence.current) return;
      setResult(event.data);
      setLoading(false);
    };
    w.addEventListener("message", receive);
    w.postMessage({
      id,
      url: asset("data/search.json"),
      snapshotId: catalog.snapshotId,
      query,
      limit,
    });
    return () => w.removeEventListener("message", receive);
  }, [query, limit, catalog.snapshotId]);
  return (
    <main className="page search-page">
      <p className="eyebrow">FULL TEXT SEARCH / 全文检索</p>
      <h1>搜索「{query}」</h1>
      <p role="status">
        {loading ? "正在检索全部正文…" : `找到 ${result.total} 条结果`}
      </p>
      {result.error && (
        <div role="alert">
          {result.error}
          <button onClick={() => location.reload()}>刷新</button>
        </div>
      )}
      <div className="search-results">
        {result.results?.map((r) => (
          <Link
            key={r.id}
            className="search-result"
            to={detailRoute(r.category, r.itemId, r)}
          >
            <div>
              <span className="pill">
                {catalog.categories.find((c) => c.key === r.category)?.name}
              </span>
              <h2>{r.name}</h2>
            </div>
            <p className="result-path">
              {[r.chapter, r.widget, r.tab].filter(Boolean).join(" / ")}
            </p>
            <p>{excerpt(r.body, query)}</p>
          </Link>
        ))}
      </div>
      {result.total > limit && (
        <button className="button" onClick={() => setLimit((x) => x + 50)}>
          继续加载 50 条
        </button>
      )}
    </main>
  );
}
