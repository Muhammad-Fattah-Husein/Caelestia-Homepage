import { state, setState } from "../core/state.js";
import { addWidget } from "../widgets/widgets.js";
import { sfx, haptic } from "./feedback.js";

const HOLD_MS = 500;   // lama tekan-tahan
const TOLERANCE = 8;   // geser lebih dari ini sebelum waktunya = bukan tekan-tahan

export function holdToPlace(source, type, { ghost: makeGhost, onHold } = {}) {
  source.addEventListener("contextmenu", (e) => e.preventDefault());   // cegah menu bawaan di layar sentuh

  source.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || state.drag) return;

    const sx = e.clientX, sy = e.clientY;
    let x = sx, y = sy, ghost = null;

    source.classList.add("holding");
    const timer = setTimeout(start, HOLD_MS);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);

    function start() {
      source.classList.remove("holding");
      onHold?.();
      sfx("pick");      // widget "terangkat" dari daftar
      haptic("pick");
      ghost = makeGhost();
      document.body.append(ghost);
      moveGhost();
      setState("drag", true);                   // panel tidak menutup selama diseret
      document.body.classList.add("placing");   // panel memudar supaya halaman utama terlihat
    }
    function moveGhost() {
      ghost.style.left = x + "px";
      ghost.style.top = y + "px";
    }
    function onMove(ev) {
      x = ev.clientX;
      y = ev.clientY;
      if (!ghost) {
        if (Math.hypot(x - sx, y - sy) > TOLERANCE) end(false);   // digeser sebelum waktunya: batal
        return;
      }
      moveGhost();
    }
    function onUp() { end(Boolean(ghost)); }
    function onCancel() { end(false); }
    function onKey(ev) { if (ev.key === "Escape") end(false); }

    function end(drop) {
      clearTimeout(timer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      source.classList.remove("holding");
      if (!ghost) return;

      ghost.remove();
      document.body.classList.remove("placing");
      try {
        if (drop) {
          addWidget(type, x / innerWidth, y / innerHeight);
          sfx("drop");
          haptic("drop");
        }
      } finally {
        setState("drag", false);   // selalu dilepas; panel menutup sendiri kalau tidak di-hover
      }
    }
  });
}