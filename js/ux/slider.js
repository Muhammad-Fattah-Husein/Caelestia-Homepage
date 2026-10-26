export function createSlider({
  label, min, max, value, step = 1,
  origin = min,      // nilai tempat isian "berangkat" (suhu: 0 = tengah)
  reset = value,     // nilai saat diklik dua kali, diketuk dua kali, atau menekan Backspace
  onInput, onChange,
}) {
  const el = document.createElement("div");
  el.className = "vs";
  el.tabIndex = 0;
  el.setAttribute("role", "slider");
  el.setAttribute("aria-orientation", "vertical");
  el.setAttribute("aria-label", label);
  el.setAttribute("aria-valuemin", min);
  el.setAttribute("aria-valuemax", max);

  const fill = document.createElement("div");
  fill.className = "vs-fill";
  const thumb = document.createElement("div");
  thumb.className = "vs-thumb";
  el.append(fill, thumb);

  const ratio = v => (v - min) / (max - min);
  let current = value;
  let dragging = false;

  function render() {
    const r = ratio(current), o = ratio(origin);
    fill.style.bottom = Math.min(r, o) * 100 + "%";
    fill.style.height = Math.abs(r - o) * 100 + "%";
    thumb.style.bottom = `calc(${r} * (100% - 6px))`;
    el.setAttribute("aria-valuenow", current);
  }

  function set(v) {
    v = Math.round(Math.min(max, Math.max(min, v)) / step) * step;
    if (v === current) return;
    current = v;
    render();
    onInput?.(current);
  }

  const fromPointer = e => {
    const rect = el.getBoundingClientRect();
    set(min + (1 - (e.clientY - rect.top) / rect.height) * (max - min));
  };

  // ketuk dua kali di layar sentuh: dblclick tidak selalu terkirim, jadi dideteksi sendiri
  let startY = 0, moved = false, lastTap = 0, lastTapY = 0;

  el.addEventListener("pointerdown", e => {
    dragging = true;
    startY = e.clientY;
    moved = false;
    el.setPointerCapture(e.pointerId);   // tetap menerima gerakan walau kursor keluar dari slider
    fromPointer(e);
  });
  el.addEventListener("pointermove", e => {
    if (!dragging) return;
    if (Math.abs(e.clientY - startY) > 6) moved = true;
    fromPointer(e);
  });

  const end = e => {
    if (!dragging) return;
    dragging = false;
    if (!moved && e?.type === "pointerup") {
      const now = performance.now();
      if (now - lastTap < 350 && Math.abs(e.clientY - lastTapY) < 20) {
        lastTap = 0;
        set(reset);
      } else {
        lastTap = now;
        lastTapY = e.clientY;
      }
    }
    onChange?.(current);
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);

  el.addEventListener("dblclick", () => { set(reset); onChange?.(current); });

  el.addEventListener("keydown", e => {
    const big = (max - min) / 10;
    const delta = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step,
                    PageUp: big, PageDown: -big }[e.key];
    if (delta !== undefined) set(current + delta);
    else if (e.key === "Home") set(min);
    else if (e.key === "End") set(max);
    else if (e.key === "Backspace" || e.key === "Delete") set(reset);   // kembali ke nilai netral
    else return;
    e.preventDefault();
    onChange?.(current);
  });

  el.setValue = v => {   // dari luar: ubah tampilan tanpa memanggil onInput
    current = Math.round(Math.min(max, Math.max(min, v)) / step) * step;
    render();
  };

  render();
  return el;
}