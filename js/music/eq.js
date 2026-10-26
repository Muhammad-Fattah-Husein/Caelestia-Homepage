import { attachBolt } from "./eq-bolt.js";
import { on } from "../core/state.js";
import { EQ_BANDS, EQ_PRESETS, getEq, setEqBand, setEqGains } from "./audio.js";

const H = 110; // tinggi jalur slider (px)
const T = 14; // diameter pegangan (px), samakan dengan .eq-thumb di CSS
const MAX = 12; // batas ±dB
const LABELS = EQ_BANDS.map((f) => (f >= 1000 ? `${f / 1000}k` : String(f)));

const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const clamp = (v) => Math.min(MAX, Math.max(-MAX, Math.round(v)));

const player = document.querySelector(".player");
if (player) init(player);
else console.warn("eq.js: elemen .player tidak ditemukan");

function init(player) {
  const panel = h("section", "eq");

  // header: judul, chip "Saved", nama preset aktif
  const head = h("div", "eq-head");
  const saved = h("span", "eq-saved", "Saved");
  const name = h("span", "eq-name");
  head.append(h("span", "eq-title", "Equalizer"), saved, name);

  // slider vertikal
  const bands = h("div", "eq-bands");
  const cols = EQ_BANDS.map((_, i) => {
    const slider = h("div", "eq-vs");
    const fill = h("div", "eq-fill");
    const thumb = h("div", "eq-thumb");
    slider.style.height = `${H}px`;
    slider.tabIndex = 0;
    slider.setAttribute("role", "slider");
    slider.setAttribute("aria-orientation", "vertical");
    slider.setAttribute("aria-label", `${LABELS[i]} Hz`);
    slider.setAttribute("aria-valuemin", -MAX);
    slider.setAttribute("aria-valuemax", MAX);
    slider.append(fill, thumb);

    const fromY = (y) => {
      const r = slider.getBoundingClientRect();
      const p = 1 - (y - r.top - T / 2) / (H - T); // 0 = bawah, 1 = atas
      return clamp(p * 2 * MAX - MAX);
    };
    slider.addEventListener("pointerdown", (e) => {
      slider.setPointerCapture(e.pointerId);
      setEqBand(i, fromY(e.clientY));
    });
    slider.addEventListener("pointermove", (e) => {
      if (slider.hasPointerCapture(e.pointerId)) setEqBand(i, fromY(e.clientY));
    });
    slider.addEventListener("dblclick", () => setEqBand(i, 0)); // reset satu band
    slider.addEventListener("keydown", (e) => {
      const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 3, PageDown: -3 }[e.key];
      if (step) {
        e.preventDefault();
        setEqBand(i, getEq().gains[i] + step);
      } else if (e.key === "Home") {
        e.preventDefault();
        setEqBand(i, -MAX);
      } else if (e.key === "End") {
        e.preventDefault();
        setEqBand(i, MAX);
      } else if (e.key === "0") {
        e.preventDefault();
        setEqBand(i, 0);
      }
    });

    const col = h("div", "eq-col");
    col.append(slider, h("span", "eq-cap", LABELS[i]));
    bands.append(col);
    return { slider, fill, thumb };
  });

  // grid preset
  const presets = h("div", "eq-presets");
  const presetBtns = Object.keys(EQ_PRESETS).map((n) => {
    const b = h("button", "eq-preset", n);
    b.type = "button";
    b.addEventListener("click", () => {
      panel.classList.add("glide"); // pegangan meluncur halus ke posisi preset
      setEqGains(EQ_PRESETS[n]);
      setTimeout(() => panel.classList.remove("glide"), 450);
      bolt.replay();
    });
    presets.append(b);
    return [n, b];
  });

  panel.append(head, bands, presets);
  player.after(panel);
  const bolt = attachBolt({ bands, sliders: cols.map((c) => c.slider), H, T, MAX });

  function render() {
    const { gains } = getEq();
    gains.forEach((db, i) => {
      const c = cols[i];
      const centre = ((db + MAX) / (2 * MAX)) * (H - T) + T / 2; // titik tengah pegangan, dari bawah
      c.thumb.style.bottom = `${centre - T / 2}px`;
      c.fill.style.height = `${centre}px`; // isi dari dasar sampai pegangan
      const txt = `${db > 0 ? "+" : ""}${db} dB`;
      c.slider.setAttribute("aria-valuenow", db);
      c.slider.setAttribute("aria-valuetext", txt);
      c.slider.title = txt;
    });
    let current = "Custom";
    for (const [n, b] of presetBtns) {
      const hit = same(gains, EQ_PRESETS[n]);
      b.setAttribute("aria-pressed", hit);
      if (hit) current = n;
    }
    name.textContent = current;
    bolt.set(gains);
  }

  let timer = 0;
  on("audio:eq", () => {
    render();
    saved.classList.add("pulse"); // chip menyala sebentar setiap kali perubahan tersimpan
    clearTimeout(timer);
    timer = setTimeout(() => saved.classList.remove("pulse"), 900);
  });
  render();
}