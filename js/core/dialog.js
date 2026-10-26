import { setState } from "./state.js";

let el, titleEl, fieldsEl, errEl;
let current = null, resolve = null, last = null;

function build() {
  el = document.createElement("div");
  el.className = "modal";
  el.inert = true;

  const form = document.createElement("form");
  form.className = "modal-box";
  form.noValidate = true;
  form.autocomplete = "off";

  titleEl = document.createElement("h2");
  fieldsEl = document.createElement("div");
  fieldsEl.className = "dlg-fields";
  errEl = document.createElement("div");
  errEl.className = "modal-error";
  errEl.setAttribute("role", "alert");

  const actions = document.createElement("div");
  actions.className = "modal-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  const ok = document.createElement("button");
  ok.type = "submit";
  ok.textContent = "OK";
  actions.append(cancel, ok);

  form.append(titleEl, fieldsEl, errEl, actions);
  el.append(form);
  document.body.append(el);

  cancel.addEventListener("click", () => finish(null));
  el.addEventListener("pointerdown", (e) => { if (e.target === el) finish(null); });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();   // Esc hanya menutup dialog, bukan panel di belakangnya
      finish(null);
    } else if (e.key === "Tab") {
      const f = [...el.querySelectorAll("input, select, button")];
      const first = f[0], end = f.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); end.focus(); }
      else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); first.focus(); }
    }
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const values = Object.fromEntries(
      [...fieldsEl.querySelectorAll("[name]")].map((i) => [i.name, i.value.trim()]),
    );
    const err = current?.validate?.(values);
    if (err) { errEl.textContent = err; return; }
    finish(values);
  });
}

function finish(result) {
  if (!resolve) return;
  const done = resolve;
  resolve = null;
  current = null;
  el.classList.remove("open");
  el.inert = true;
  setState("modal", false);
  if (last?.isConnected) last.focus();
  done(result);
}

// opts: { title, fields: [{ name, label, type, value, placeholder, maxlength, options }], validate(values) }
// hasilnya objek nilai, atau null kalau dibatalkan
export function openDialog(opts) {
  if (!el) build();
  if (resolve) finish(null);
  current = opts;
  titleEl.textContent = opts.title;
  errEl.textContent = "";

  fieldsEl.replaceChildren(...opts.fields.map((f) => {
    const label = document.createElement("label");
    label.append(f.label);
    let input;
    if (f.type === "select") {
      input = document.createElement("select");
      for (const [value, text] of f.options) {
        const o = document.createElement("option");
        o.value = value;
        o.textContent = text;
        input.append(o);
      }
    } else {
      input = document.createElement("input");
      input.type = f.type ?? "text";
      input.spellcheck = false;
      if (f.maxlength) input.maxLength = f.maxlength;
      if (f.placeholder) input.placeholder = f.placeholder;
    }
    input.name = f.name;
    input.value = f.value ?? "";
    label.append(input);
    return label;
  }));

  last = document.activeElement;
  el.inert = false;
  el.classList.add("open");
  setState("modal", true);
  fieldsEl.querySelector("[name]")?.focus();
  return new Promise((r) => { resolve = r; });
}