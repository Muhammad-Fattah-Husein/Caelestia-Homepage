// Seret-dan-lepas lagu di jendela perpustakaan (mouse dan sentuh), plus gaya untuk
// kotak centang / baris terpilih. Modul ini hanya mengurus tampilan seretan; apa yang
// terjadi saat dilepas dikerjakan oleh callback dari libwin.js.
import { getTrack } from "./library.js";
import { haptic } from "../ux/feedback.js";

const MOUSE_SLOP = 6; // px sebelum seretan mouse dimulai
const TOUCH_SLOP = 10; // jari bergeser lebih jauh dari ini = pengguna menggulir, bukan menyeret
const HOLD_MS = 500; // tekan-tahan untuk sentuhan
const EDGE = 48; // jarak dari tepi daftar yang memicu gulir otomatis
const MAX_SCROLL = 18; // px per frame

const CSS = `
.lib-row{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.lib-row.sel{background:color-mix(in srgb,var(--accent,#8ab4ff) 18%,transparent)}
.lib-row.drag-src{opacity:.45}

/* kotak centang menempati kolom nomor */
.lib-num{position:relative}
.lib-chk{display:none;position:absolute;inset:0;margin:auto;width:16px;height:16px;cursor:pointer;accent-color:var(--accent,#8ab4ff)}
.lib-row:hover .lib-chk,.lib-row.sel .lib-chk,.lib-list.selecting .lib-chk{display:block}
.lib-row:hover .lib-num>:not(.lib-chk),.lib-row.sel .lib-num>:not(.lib-chk),.lib-list.selecting .lib-num>:not(.lib-chk){visibility:hidden}
@media (hover:none){
  .lib-chk{display:block;width:20px;height:20px}
  .lib-num>:not(.lib-chk){visibility:hidden}
}
.lib-selcount{font-size:12px;opacity:.85;padding:0 6px;white-space:nowrap;align-self:center}

/* saat menyeret */
.lib-dragging,.lib-dragging *{cursor:grabbing!important;-webkit-user-select:none;user-select:none}
.lib-dragging .lib-bar>*{visibility:hidden}
.lib-zones{display:none;position:absolute;z-index:6;box-sizing:border-box;gap:10px;padding:8px 12px}
.lib-dragging .lib-zones{display:flex}
.lib-zone{flex:1;display:flex;align-items:center;justify-content:center;box-sizing:border-box;border:2px dashed currentColor;border-radius:10px;opacity:.65;font-size:13px;font-weight:600;transition:opacity .12s,background .12s}
.lib-zone.drop-on{opacity:1;border-style:solid;border-color:var(--accent,#8ab4ff);background:color-mix(in srgb,var(--accent,#8ab4ff) 22%,transparent)}
.lib-nav.drop-on{outline:2px solid var(--accent,#8ab4ff);outline-offset:-2px;background:color-mix(in srgb,var(--accent,#8ab4ff) 22%,transparent)}
.lib-ghost{position:fixed;left:0;top:0;z-index:2147483600;pointer-events:none;display:flex;align-items:center;gap:8px;max-width:240px;padding:8px 12px;border-radius:10px;background:rgba(30,32,40,.96);color:#fff;font:600 13px/1.2 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4);will-change:transform}
.lib-ghost span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lib-ghost b{flex:none;min-width:20px;height:20px;padding:0 6px;box-sizing:border-box;border-radius:10px;background:var(--accent,#8ab4ff);color:#111;font-size:12px;display:grid;place-items:center}
.lib-dropline{position:fixed;z-index:2147483500;height:2px;border-radius:1px;background:var(--accent,#8ab4ff);pointer-events:none;display:none}
`;

function scrollParent(el) {
  for (let p = el; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return el;
}

/**
 * ctx:
 *  win, list, side, bar        elemen jendela
 *  view()                      view aktif ("all" | "fav" | "queue" | "pl:<id>" | "wall")
 *  canReorder()                true kalau mengurutkan ulang di playlist ini masuk akal (sort default, tanpa pencarian)
 *  idsFor(rowId)               id lagu yang ikut terseret kalau baris ini yang dipegang
 *  onAdd(plId, ids)            pustaka/favorit/antrean -> playlist (menyalin)
 *  onTransfer(src, dst, ids, x, y)   playlist -> playlist lain (tampilkan menu Salin/Pindahkan)
 *  onNewPlaylist(ids), onPlayNext(ids)
 *  onReorder(plId, ids, beforeId), onBlockedReorder()
 */
export function initLibDnd(ctx) {
  const { win, list, side, bar } = ctx;

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);

  const zones = document.createElement("div");
  zones.className = "lib-zones";
  zones.innerHTML = `<div class="lib-zone" data-zone="new">＋ New playlist</div><div class="lib-zone" data-zone="next"><img class="asset-icon" src="assets/transparent_ui_icons/07_play.png" alt="" aria-hidden="true" /> Play next</div>`;
  win.append(zones);

  let pend = null; // menunggu: belum jadi seretan
  let drag = null; // seretan aktif
  let swallow = false; // telanjur menyeret: jangan biarkan "click" susulan memutar lagu

  // ---- memulai ----
  function onDown(e) {
    if (drag) return;
    endPend(); // sisa dari sentuhan sebelumnya yang pointerup-nya tidak sampai
    if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    const row = e.target.closest?.(".lib-row");
    if (!row || e.target.closest(".lib-fav, .lib-rowmenu, .lib-chk")) return;
    const touch = e.pointerType === "touch";
    pend = { rowId: row.dataset.id, pid: e.pointerId, touch, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, timer: 0 };
    if (touch) pend.timer = setTimeout(() => pend && begin(), HOLD_MS);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }
  list.addEventListener("pointerdown", onDown);
  window.addEventListener("pointerdown", () => (swallow = false), true);
  win.addEventListener(
    "click",
    (e) => {
      if (!swallow) return;
      swallow = false;
      e.stopPropagation();
      e.preventDefault();
    },
    true,
  );
  window.addEventListener("contextmenu", (e) => (drag || pend?.touch) && e.preventDefault(), true);
  const stopTouchScroll = (e) => drag && e.preventDefault();

  function detach() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
  }
  function endPend() {
    if (pend) clearTimeout(pend.timer);
    pend = null;
    if (!drag) detach();
  }

  function onMove(e) {
    if (drag) {
      if (e.pointerId !== drag.pid) return;
      drag.x = e.clientX;
      drag.y = e.clientY;
      moveGhost();
      return;
    }
    if (!pend || e.pointerId !== pend.pid) return;
    pend.lx = e.clientX;
    pend.ly = e.clientY;
    const d = Math.hypot(e.clientX - pend.x, e.clientY - pend.y);
    if (pend.touch) {
      if (d > TOUCH_SLOP) endPend(); // jari bergerak sebelum 0,5 detik: biarkan jadi gulir
    } else if (d >= MOUSE_SLOP) begin();
  }
  function onUp(e) {
    if (drag) {
      if (e.pointerId === drag.pid) finish(true);
    } else if (pend && e.pointerId === pend.pid) endPend(); // hanya klik biasa
  }
  function onCancel(e) {
    if (drag) {
      if (e.pointerId === drag.pid) finish(false);
    } else if (pend && e.pointerId === pend.pid) endPend();
  }

  function begin() {
    const { rowId, pid, touch, lx, ly } = pend;
    clearTimeout(pend.timer);
    pend = null;
    const ids = ctx.idsFor(rowId);
    if (!ids.length) return detach();

    const ghost = document.createElement("div");
    ghost.className = "lib-ghost";
    const title = document.createElement("span");
    title.textContent = getTrack(ids[0])?.title || "Track";
    ghost.append(title);
    if (ids.length > 1) {
      const n = document.createElement("b");
      n.textContent = String(ids.length);
      ghost.append(n);
    }
    const line = document.createElement("div");
    line.className = "lib-dropline";
    document.body.append(ghost, line);

    drag = { pid, touch, ids, x: lx, y: ly, ghost, line, target: null, srcView: ctx.view(), scroller: scrollParent(list), raf: 0 };

    // zona lepas menutupi bar judul selama menyeret
    const w = win.getBoundingClientRect(),
      b = bar.getBoundingClientRect();
    Object.assign(zones.style, {
      left: b.left - w.left - win.clientLeft + "px",
      top: b.top - w.top - win.clientTop + "px",
      width: b.width + "px",
      height: b.height + "px",
    });
    win.classList.add("lib-dragging");
    for (const r of list.querySelectorAll(".lib-row")) if (ids.includes(r.dataset.id)) r.classList.add("drag-src");
    try {
      list.setPointerCapture(pid); // pointerup tetap sampai walau kursor keluar dari jendela
    } catch {}
    window.addEventListener("touchmove", stopTouchScroll, { passive: false });
    haptic("pick");
    moveGhost();
    drag.raf = requestAnimationFrame(tick);
  }

  // ---- selama menyeret ----
  function moveGhost() {
    drag.ghost.style.transform = `translate(${drag.x + 14}px, ${drag.y + (drag.touch ? -52 : 14)}px)`;
  }

  function tick() {
    if (!drag) return;
    autoscroll();
    setTarget(findTarget());
    drag.raf = requestAnimationFrame(tick);
  }

  function autoscroll() {
    const r = drag.scroller.getBoundingClientRect();
    if (drag.x < r.left || drag.x > r.right || drag.y < r.top || drag.y > r.bottom) return;
    let v = 0;
    if (drag.y < r.top + EDGE) v = -Math.min(1, (r.top + EDGE - drag.y) / EDGE);
    else if (drag.y > r.bottom - EDGE) v = Math.min(1, (drag.y - (r.bottom - EDGE)) / EDGE);
    if (v) drag.scroller.scrollTop += Math.round(v * MAX_SCROLL) || Math.sign(v);
  }

  function findTarget() {
    const hit = document.elementFromPoint(drag.x, drag.y);
    if (!hit) return null;
    const zone = hit.closest(".lib-zone");
    if (zone && win.contains(zone)) return { type: "zone", zone: zone.dataset.zone, el: zone };

    const srcPl = drag.srcView.startsWith("pl:") ? drag.srcView.slice(3) : null;
    const nav = hit.closest(".lib-nav");
    if (nav && side.contains(nav)) {
      const v = nav.dataset.view || "";
      if (v.startsWith("pl:") && v.slice(3) !== srcPl) return { type: "playlist", id: v.slice(3), el: nav };
      return null;
    }

    // di dalam playlist yang sama: mengurutkan ulang
    if (srcPl && ctx.view() === drag.srcView && (hit === list || list.contains(hit))) {
      if (!ctx.canReorder()) return { type: "blocked" };
      const rows = [...list.querySelectorAll(".lib-row")];
      const lr = list.getBoundingClientRect();
      let k = rows.length;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect();
        if (drag.y < r.top + r.height / 2) {
          k = i;
          break;
        }
      }
      // lagu yang ikut terseret tidak bisa jadi patokan: cari baris berikutnya yang diam
      let b = k;
      while (b < rows.length && drag.ids.includes(rows[b].dataset.id)) b++;
      const beforeId = b < rows.length ? rows[b].dataset.id : null;
      const y = !rows.length ? lr.top : k < rows.length ? rows[k].getBoundingClientRect().top : rows[rows.length - 1].getBoundingClientRect().bottom;
      return { type: "reorder", plId: srcPl, beforeId, lineY: Math.min(Math.max(y, lr.top), lr.bottom), lineL: lr.left, lineW: lr.width };
    }
    return null;
  }

  function setTarget(t) {
    const prev = drag.target;
    if (prev?.el && prev.el !== t?.el) prev.el.classList.remove("drop-on");
    if (t?.el && t.el !== prev?.el) t.el.classList.add("drop-on");
    drag.target = t;
    const line = drag.line;
    if (t?.type === "reorder") {
      line.style.left = t.lineL + "px";
      line.style.width = t.lineW + "px";
      line.style.top = t.lineY - 1 + "px";
      line.style.display = "block";
    } else line.style.display = "none";
  }

  // ---- selesai ----
  function teardown() {
    const d = drag;
    cancelAnimationFrame(d.raf);
    d.ghost.remove();
    d.line.remove();
    win.classList.remove("lib-dragging");
    for (const r of list.querySelectorAll(".drag-src")) r.classList.remove("drag-src");
    for (const r of win.querySelectorAll(".drop-on")) r.classList.remove("drop-on");
    try {
      list.releasePointerCapture(d.pid);
    } catch {}
    window.removeEventListener("touchmove", stopTouchScroll);
    detach();
    drag = null;
    return d;
  }

  function finish(drop) {
    const d = teardown();
    swallow = true;
    const t = d.target;
    if (!drop || !t) return;
    const srcPl = d.srcView.startsWith("pl:") ? d.srcView.slice(3) : null;
    if (t.type === "zone") (t.zone === "new" ? ctx.onNewPlaylist : ctx.onPlayNext)(d.ids);
    else if (t.type === "playlist") (srcPl ? ctx.onTransfer(srcPl, t.id, d.ids, d.x, d.y) : ctx.onAdd(t.id, d.ids));
    else if (t.type === "reorder") ctx.onReorder(t.plId, d.ids, t.beforeId);
    else if (t.type === "blocked") ctx.onBlockedReorder();
  }

  // Esc membatalkan seretan (fase capture, supaya Esc tidak ikut menutup jendela)
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || !drag) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      finish(false);
    },
    true,
  );
}