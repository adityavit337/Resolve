"use client";

import { useEffect, useState, type FormEvent } from "react";

type Summary = { id: number; title: string; status: "DRAFT" | "PUBLISHED"; updatedAt: string };
type Article = Summary & { body: string; version: number; publishedAt: string | null };

export default function ArticleManager({ workspaceId }: { workspaceId: number }) {
  const endpoint = `/api/workspaces/${workspaceId}/articles`;
  const [articles, setArticles] = useState<Summary[]>([]);
  const [selected, setSelected] = useState<Article | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"DRAFT" | "PUBLISHED">("DRAFT");
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setListError("");
    async function load() {
      try {
        const url = query ? `${endpoint}?q=${encodeURIComponent(query)}` : endpoint;
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (response.status === 401) { window.location.replace("/sign-in"); return; }
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message ?? "Could not load articles.");
        if (!controller.signal.aborted) setArticles(data.articles);
      } catch (error) {
        if (!controller.signal.aborted) setListError(error instanceof Error ? error.message : "Could not load articles.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [endpoint, refresh, query]);

  function fill(article: Article | null) {
    setSelected(article);
    setTitle(article?.title ?? "");
    setBody(article?.body ?? "");
    setStatus(article?.status ?? "DRAFT");
  }

  async function open(id: number) {
    setPending(true); setFeedback(""); setFailed(false);
    try {
      const response = await fetch(`${endpoint}/${id}`, { cache: "no-store" });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Could not open article.");
      fill(data.article);
    } catch (error) {
      setFailed(true); setFeedback(error instanceof Error ? error.message : "Could not open article.");
    } finally { setPending(false); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true); setFeedback(""); setFailed(false);
    try {
      const response = await fetch(selected ? `${endpoint}/${selected.id}` : endpoint, {
        method: selected ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, ...(selected ? { status, version: selected.version } : {}) }),
      });
      if (response.status === 401) { window.location.replace("/sign-in"); return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Could not save article.");
      fill(data.article);
      setFeedback(data.article.status === "PUBLISHED" ? "Article published." : "Draft saved.");
      setRefresh((value) => value + 1);
    } catch (error) {
      setFailed(true); setFeedback(error instanceof Error ? error.message : "Could not save article.");
    } finally { setPending(false); }
  }

  return <>
    <section className="panel"><h2>Workspace articles</h2>
      <form onSubmit={(event) => { event.preventDefault(); setQuery(search.trim()); setRefresh((value) => value + 1); }}>
        <label htmlFor="article-search">Search published articles</label>{" "}
        <input id="article-search" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={200} required disabled={pending} />{" "}
        <button disabled={pending || !search.trim()}>Search</button>{" "}
        <button type="button" disabled={pending} onClick={() => { setSearch(""); setQuery(""); }}>Show all articles</button>
      </form>
      {query && <p>Up to 20 published matches for “{query}”, most relevant first. Try specific words; short or common words may not match.</p>}
      <button disabled={loading || pending} onClick={() => setRefresh((value) => value + 1)}>Refresh articles</button>
      {loading ? <p role="status">Loading articles...</p> : listError ? <p role="alert">{listError}</p> : articles.length ? <ul>
        {articles.map((article) => <li key={article.id}><button disabled={pending} onClick={() => void open(article.id)}>{article.title}</button> — {article.status}</li>)}
      </ul> : <p>{query ? "No published articles match this search. Try different words or show all articles." : "No help articles yet. Create your first draft below."}</p>}
    </section>
    <section className="panel"><h2>{selected ? "Edit article" : "New article"}</h2>
      <p role={failed ? "alert" : "status"}>{feedback}</p>
      <button disabled={pending} onClick={() => { fill(null); setFeedback(""); setFailed(false); }}>New draft</button>
      {selected && <button disabled={pending} onClick={() => void open(selected.id)}>Reload saved article</button>}
      <p>Opening another article or reloading replaces unsaved changes.</p>
      <form onSubmit={save}>
        <p><label htmlFor="article-title">Title</label><br /><input id="article-title" required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} disabled={pending} /></p>
        <p><label htmlFor="article-body">Article body</label><br /><textarea id="article-body" required maxLength={50000} rows={12} value={body} onChange={(event) => setBody(event.target.value)} disabled={pending} /></p>
        {selected && <p><label htmlFor="article-status">Publication status</label>{" "}<select id="article-status" value={status} onChange={(event) => setStatus(event.target.value as "DRAFT" | "PUBLISHED")} disabled={pending}>
          <option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option>
        </select></p>}
        <p>New articles start as drafts. Saving as published makes the current text ready for staff use. Saving as draft withdraws it from publication.</p>
        <button disabled={pending}>{pending ? "Saving..." : selected ? "Save article" : "Create draft"}</button>
      </form>
      {selected && <article><h3>Saved article: {selected.title}</h3><p>{selected.status}</p><p style={{ whiteSpace: "pre-wrap" }}>{selected.body}</p></article>}
    </section>
  </>;
}
