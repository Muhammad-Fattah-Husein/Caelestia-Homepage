import { on } from "../core/state.js";

const root = document.getElementById("toasts");
const MAX = 4;

function dismiss(el) {
  if (!el.isConnected || el.classList.contains("out")) return;
  el.classList.add("out");
  setTimeout(() => el.remove(), 250);   // tunggu animasi keluar selesai
}

export function toast(message, { title = "", type = "info", duration = 4000 } = {}) {
  const el = document.createElement("div");
  el.className = `toast ${type}`;

  const body = document.createElement("div");
  body.className = "t-body";
  if (title) {
    const t = document.createElement("div");
    t.className = "t-title";
    t.textContent = title;
    body.append(t);
  }
  const msg = document.createElement("div");
  msg.className = "t-msg";
  msg.textContent = message;
  body.append(msg);

  const close = document.createElement("button");
  close.className = "t-close";
  close.setAttribute("aria-label", "Dismiss notification");
  close.textContent = "✕";
  close.addEventListener("click", () => dismiss(el));

  el.append(body, close);

  if (duration > 0) {   // duration: 0 = menetap sampai ditutup manual
    const bar = document.createElement("div");
    bar.className = "t-bar";
    bar.style.setProperty("--dur", duration + "ms");
    bar.addEventListener("animationend", () => dismiss(el));
    el.append(bar);
  }

  root.prepend(el);                                        // yang terbaru di atas
  while (root.children.length > MAX) root.lastElementChild.remove();
  return el;
}

on("toast", ({ message, ...opts }) => toast(message, opts));