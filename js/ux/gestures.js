import { state } from "../core/state.js";
import { openPanel, closePanel } from "../ui/panel.js";
import { openFilter, closeFilter } from "../appearance/filter.js";

// Gestur sentuh untuk dua panel. Hanya untuk sentuhan dan pena, bukan mouse.
const SWIPE = 24;      // piksel geseran yang dihitung sebagai gestur
const TAP_MS = 350;    // ketukan: lepas lebih cepat dari ini
const TAP_SLOP = 10;   // dan bergeser kurang dari ini

// el: area yang dipantau. dir: arah geser yang dihitung ("down", "up", "left", "right")
function gesture(el, { dir, onSwipe, onTap, ignore }) {
  if (!el) return;
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || e.button !== 0 || ignore?.(e)) return;
    const sx = e.clientX, sy = e.clientY, t0 = performance.now();
    let done = false;

    const move = (ev) => {
      if (done) return;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      const d = { down: dy, up: -dy, right: dx, left: -dx }[dir];
      if (d >= SWIPE) { done = true; onSwipe(); }
    };
    const stop = (ev) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      if (!done && ev.type === "pointerup" && onTap && performance.now() - t0 < TAP_MS &&
          Math.hypot(ev.clientX - sx, ev.clientY - sy) < TAP_SLOP) onTap();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  });
}

const $ = (s) => document.querySelector(s);

// buka: geser dari tepi atas ke bawah, atau dari tepi kanan ke kiri; mengetuk garisnya juga membuka atau menutup
gesture($("#edge"), {
  dir: "down",
  onSwipe: () => openPanel({ pin: true }),
  onTap: () => (state.panelOpen ? closePanel() : openPanel({ pin: true })),
});
gesture($("#edge-r"), {
  dir: "left",
  onSwipe: () => openFilter({ pin: true }),
  onTap: () => (state.menu ? closeFilter() : openFilter({ pin: true })),
});

// tutup: geser baris tab ke atas, atau geser panel filter ke kanan (di luar slider dan tombol)
gesture($(".tabs"), { dir: "up", onSwipe: () => closePanel() });
gesture($("#filter-panel"), {
  dir: "right",
  onSwipe: () => closeFilter(),
  ignore: (e) => e.target.closest(".vs, button"),
});