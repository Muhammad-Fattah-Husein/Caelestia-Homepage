import { state, on, off, emit } from "../../../core/state.js";
import { openDialog } from "../../../core/dialog.js";
import { every } from "../../runtime.js";

const SYM = {
  bitcoin: "BTC", ethereum: "ETH", solana: "SOL", dogecoin: "DOGE", ripple: "XRP", cardano: "ADA",
  binancecoin: "BNB", tether: "USDT", litecoin: "LTC", toncoin: "TON", tron: "TRX", polkadot: "DOT",
};

const REV = Object.fromEntries(Object.entries(SYM).map(([id, s]) => [s.toLowerCase(), id]));

const COIN_RE = /^[a-z0-9-]{1,40}$/;

function mountCrypto(body, ctx) {
  const d = ctx.data ?? {};
  let coins = Array.isArray(d.coins)
    ? d.coins.filter((x) => typeof x === "string" && COIN_RE.test(x)).slice(0, 4)
    : [];
  if (!coins.length) coins = ["bitcoin", "ethereum"];
  let cur = d.cur === "usd" ? "usd" : "idr";

  const card = document.createElement("div");
  card.className = "cx";
  card.title = "Click to change coins";
  card.innerHTML = `<div class="cx-head"><span>Crypto</span><span class="cx-time"></span></div><div class="cx-rows"></div>`;
  body.append(card);
  const rows = card.querySelector(".cx-rows");
  const timeEl = card.querySelector(".cx-time");

  let last = null, stamp = 0, failed = false, ac = null;
  const price = (v) =>
    new Intl.NumberFormat("en-US", {
      style: "currency", currency: cur.toUpperCase(),
      maximumFractionDigits: v < 1 ? 6 : cur === "idr" ? 0 : 2,
    }).format(v);

  function render() {
    timeEl.textContent = failed ? (last ? "Offline" : "") : stamp ? new Date(stamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "";
    if (!last) {
      rows.textContent = failed ? "Prices unavailable" : "Loading…";
      return;
    }
    rows.replaceChildren(...coins.map((id) => {
      const x = last[id];
      const row = document.createElement("div");
      row.className = "cx-row";
      const sym = document.createElement("span");
      sym.className = "cx-sym";
      sym.textContent = SYM[id] ?? id.slice(0, 8).toUpperCase();
      const pr = document.createElement("span");
      pr.className = "cx-price";
      const ch = document.createElement("span");
      const v = x?.[cur], c = x?.[`${cur}_24h_change`];
      pr.textContent = Number.isFinite(v) ? price(v) : "—";
      ch.className = "cx-ch" + (Number.isFinite(c) ? (c >= 0 ? " up" : " down") : "");
      ch.textContent = Number.isFinite(c) ? `${c >= 0 ? "+" : ""}${c.toFixed(2)}%` : "";
      row.append(sym, pr, ch);
      return row;
    }));
  }

  async function load() {
    ac?.abort();
    const mine = (ac = new AbortController());
    const t = setTimeout(() => mine.abort(), 8000);
    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coins.join(",")}&vs_currencies=${cur}&include_24hr_change=true`;
      const r = await fetch(url, { signal: mine.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      if (mine !== ac) return;
      last = j;
      stamp = Date.now();
      failed = false;
    } catch {
      if (mine === ac) failed = true;
    } finally {
      clearTimeout(t);
    }
    if (mine === ac) render();
  }

  async function edit() {
    const v = await openDialog({
      title: "Crypto prices",
      fields: [
        { name: "coins", label: "Coins (max. 4, comma-separated)", value: coins.join(", "), placeholder: "bitcoin, ethereum, sol", maxlength: 120 },
        { name: "cur", label: "Currency", type: "select", options: [["idr", "Indonesian Rupiah (IDR)"], ["usd", "US Dollar (USD)"]], value: cur },
      ],
      validate: (v) => {
        const list = v.coins.toLowerCase().split(/[,\s]+/).filter(Boolean).map((s) => REV[s] ?? s);
        if (!list.length || list.length > 4) return "Enter 1 to 4 coins";
        return list.every((s) => COIN_RE.test(s)) ? null : "Use a CoinGecko ID (e.g. bitcoin) or common symbol (e.g. btc)";
      },
    });
    if (!v) return;
    coins = [...new Set(v.coins.toLowerCase().split(/[,\s]+/).filter(Boolean).map((s) => REV[s] ?? s))].slice(0, 4);
    cur = v.cur === "usd" ? "usd" : "idr";
    last = null;
    ctx.save({ coins, cur });
    render();
    load();
  }

  render();
  load();
  const stop = every(90_000, load);   // CoinGecko membatasi permintaan gratis, jadi jangan terlalu sering
  return { onTap: edit, cleanup: () => { ac?.abort(); stop(); } };
}

export { mountCrypto as default };
