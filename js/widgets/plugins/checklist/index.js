import { emit } from "../../../core/state.js";

function mountChecklist(body, ctx) {
  const MAXI = 5;
  const items = (Array.isArray(ctx.data?.items) ? ctx.data.items : [])
    .filter((i) => i && typeof i.t === "string")
    .slice(0, MAXI)
    .map((i) => ({ t: i.t.slice(0, 40), d: Boolean(i.d) }));

  const card = document.createElement("div");
  card.className = "ck";
  card.innerHTML = `<div class="ck-head"><span>Checklist</span><span class="ck-count"></span></div>
    <ul class="ck-list"></ul>
    <input class="ck-add" type="text" maxlength="40" placeholder="Add a task…" aria-label="Add a task">`;
  body.append(card);
  const list = card.querySelector(".ck-list");
  const count = card.querySelector(".ck-count");
  const add = card.querySelector(".ck-add");

  const allDone = () => items.length > 0 && items.every((i) => i.d);
  const persist = () => ctx.save({ items });

  function render() {
    list.replaceChildren(...items.map((it, i) => {
      const li = document.createElement("li");
      li.className = "ck-item" + (it.d ? " done" : "");
      const label = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = it.d;
      const text = document.createElement("span");
      text.className = "ck-text";
      text.textContent = it.t;
      label.append(cb, text);
      const del = document.createElement("button");
      del.type = "button";
      del.className = "ck-del";
      del.setAttribute("aria-label", `Delete ${it.t}`);
      del.textContent = "✕";
      cb.addEventListener("change", () => toggle(i, cb.checked));
      del.addEventListener("click", () => { items.splice(i, 1); persist(); render(); });
      li.append(label, del);
      return li;
    }));
    const done = items.filter((i) => i.d).length;
    count.textContent = items.length ? `${done}/${items.length}` : "";
    add.style.display = items.length >= MAXI ? "none" : "";
  }

  function toggle(i, checked) {
    const before = allDone();
    items[i].d = checked;
    persist();
    render();
    if (!before && allDone()) {
      const r = card.getBoundingClientRect();
      emit("confetti", { x: r.left + r.width / 2, y: r.top + r.height / 2 });
      emit("toast", { title: "Complete", message: "All tasks checked off.", duration: 3000 });
    }
  }

  add.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const t = add.value.trim();
    if (!t || items.length >= MAXI) return;
    items.push({ t, d: false });
    add.value = "";
    persist();
    render();
  });

  render();
}

export { mountChecklist as default };
