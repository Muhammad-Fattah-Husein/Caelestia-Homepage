import { state, on, off } from "../../../core/state.js";
import { openDialog } from "../../../core/dialog.js";
import { every, isHttp } from "../../runtime.js";

const USE_PROXY = true;

const PROXY = "https://api.rss2json.com/v1/api.json?rss_url=";

const decode = (s) => new DOMParser().parseFromString(String(s ?? ""), "text/html").documentElement.textContent.trim();

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, "text/xml");
  if (doc.querySelector("parsererror")) throw new Error("Not valid XML");
  const title = doc.querySelector("channel > title, feed > title")?.textContent?.trim() ?? "";
  const items = [...doc.querySelectorAll("item, entry")]
    .map((n) => {
      const l = n.querySelector("link");
      const link = l?.getAttribute("href") || l?.textContent?.trim() || "";
      const date = Date.parse(n.querySelector("pubDate, published, updated")?.textContent ?? "");
      return { title: n.querySelector("title")?.textContent?.trim() ?? "", link, date: Number.isFinite(date) ? date : null };
    })
    .filter((i) => i.title && isHttp(i.link));
  return { title, items };
}

function ago(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} hr` : `${Math.round(h / 24)} days`;
}

function mountRss(body, ctx) {
  let url = isHttp(ctx.data?.url, 600) ? ctx.data.url : "";

  const card = document.createElement("div");
  card.className = "rss";
  card.innerHTML = `<div class="rss-head"><b class="rss-title">RSS</b>
      <button type="button" class="rss-edit" aria-label="Edit feed" title="Edit feed">✎</button></div>
    <ul class="rss-list"></ul><div class="rss-note"></div>`;
  body.append(card);
  const titleEl = card.querySelector(".rss-title");
  const list = card.querySelector(".rss-list");
  const note = card.querySelector(".rss-note");

  let items = [], feedTitle = "", failed = false, loading = false, ac = null;

  function render() {
    titleEl.textContent = feedTitle || "RSS";
    list.replaceChildren(...items.map((it) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = it.link;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = it.title;
      li.append(a);
      if (it.date) {
        const t = document.createElement("div");
        t.className = "rss-ago";
        t.textContent = ago(it.date);
        li.append(t);
      }
      return li;
    }));
    note.textContent = !url ? "Click ✎ to choose an RSS feed"
      : failed ? (items.length ? "Offline · showing cached items" : "Could not load feed")
      : loading && !items.length ? "Loading…" : "";
  }

  async function load() {
    if (!url) return render();
    ac?.abort();
    const mine = (ac = new AbortController());
    const t = setTimeout(() => mine.abort(), 10000);
    loading = true;
    render();
    try {
      let feed;
      try {
        const r = await fetch(url, { signal: mine.signal });
        if (!r.ok) throw new Error("HTTP " + r.status);
        feed = parseXml(await r.text());
      } catch (e) {
        if (mine.signal.aborted || !USE_PROXY) throw e;
        const r = await fetch(PROXY + encodeURIComponent(url), { signal: mine.signal });
        const j = await r.json();
        if (j.status !== "ok") throw new Error("proxy");
        feed = {
          title: decode(j.feed?.title),
          items: (j.items ?? [])
            .map((i) => {
              const date = Date.parse(String(i.pubDate ?? "").replace(" ", "T") + "Z");   // rss2json memberi waktu UTC
              return { title: decode(i.title), link: i.link, date: Number.isFinite(date) ? date : null };
            })
            .filter((i) => i.title && isHttp(i.link)),
        };
      }
      if (mine !== ac) return;
      items = feed.items.slice(0, 8);
      feedTitle = feed.title;
      failed = false;
    } catch {
      if (mine === ac) failed = true;
    } finally {
      clearTimeout(t);
      if (mine === ac) { loading = false; render(); }
    }
  }

  async function edit() {
    const v = await openDialog({
      title: "RSS feed",
      fields: [{ name: "url", label: "Feed URL (RSS or Atom)", value: url, placeholder: "https://example.com/feed.xml", maxlength: 600 }],
      validate: (v) => (isHttp(v.url, 600) ? null : "URL must start with http:// or https://"),
    });
    if (!v) return;
    url = v.url;
    items = [];
    feedTitle = "";
    ctx.save({ url });
    load();
  }

  card.querySelector(".rss-edit").addEventListener("click", edit);
  render();
  if (ctx.isNew && !url) edit();
  else load();
  const stop = every(15 * 60_000, load);
  return () => { ac?.abort(); stop(); };
}

export { mountRss as default };
